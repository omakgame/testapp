const express = require('express');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// 使用者建立/更新（LINE userId 為唯一鍵）
app.post('/api/auth/ensure', async (req, res) => {
  const { userId, displayName } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const user = await prisma.user.upsert({
    where: { lineUserId: userId },
    update: { displayName },
    create: { lineUserId: userId, displayName }
  });
  res.json(user);
});

// 首頁狀態（繼續修練是否可用）
app.get('/api/home', async (req, res) => {
  const lid = req.headers['x-user-id'];
  if (!lid) return res.json({ canContinue: false });
  const user = await prisma.user.findUnique({ where: { lineUserId: lid } });
  if (!user) return res.json({ canContinue: false });
  const last = await prisma.progress.findFirst({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' }
  });
  res.json({ canContinue: !!last, lastChapterId: last?.chapterId, lastParagraph: last?.currentParagraph ?? 1 });
});

// 藏經閣：書與篇章
app.get('/api/works', async (_req, res) => {
  const works = await prisma.work.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, name: true, chapters: { select: { id: true, title: true, order: true }, orderBy: { order: 'asc' } } }
  });
  res.json(works);
});

// 章的段落
app.get('/api/chapters/:id/paragraphs', async (req, res) => {
  const id = Number(req.params.id);
  const paras = await prisma.paragraph.findMany({ where: { chapterId: id }, orderBy: { order: 'asc' } });
  res.json(paras);
});

// 更新進度 + 累計背書秒數
app.post('/api/progress', async (req, res) => {
  const lid = req.headers['x-user-id'];
  const { chapterId, currentParagraph, practiceSeconds = 0, markCompleted = false } = req.body;
  if (!lid) return res.status(400).json({ error: 'x-user-id required' });
  const user = await prisma.user.findUnique({ where: { lineUserId: lid } });
  if (!user) return res.status(404).json({ error: 'user not found' });

  const prog = await prisma.progress.upsert({
    where: { userId_chapterId: { userId: user.id, chapterId } },
    update: { currentParagraph, isCompleted: markCompleted || undefined },
    create: { userId: user.id, chapterId, currentParagraph }
  });

  if (practiceSeconds > 0) {
    await prisma.stat.upsert({
      where: { userId: user.id },
      update: { totalPracticeSeconds: { increment: practiceSeconds } },
      create: { userId: user.id, totalPracticeSeconds: practiceSeconds, totalUsageSeconds: 0 }
    });
  }
  res.json(prog);
});

// 錯誤回報
app.post('/api/report', async (req, res) => {
  const lid = req.headers['x-user-id'];
  const user = lid ? await prisma.user.findUnique({ where: { lineUserId: lid } }) : null;
  const { chapterId, paragraph, message } = req.body;
  const r = await prisma.errorReport.create({
    data: { userId: user?.id, chapterId, paragraph, message }
  });
  res.json(r);
});

// 登入紀錄 + 使用時數
app.post('/api/ping', async (req, res) => {
  const lid = req.headers['x-user-id'];
  const { usageSeconds = 0 } = req.body;
  if (!lid) return res.json({ ok: true });
  const user = await prisma.user.upsert({
    where: { lineUserId: lid }, update: {}, create: { lineUserId: lid }
  });
  const d = new Date(); d.setHours(0,0,0,0);
  await prisma.loginRecord.upsert({
    where: { userId_date: { userId: user.id, date: d } },
    update: {}, create: { userId: user.id, date: d }
  });
  if (usageSeconds > 0) {
    await prisma.stat.upsert({
      where: { userId: user.id },
      update: { totalUsageSeconds: { increment: usageSeconds } },
      create: { userId: user.id, totalUsageSeconds: usageSeconds, totalPracticeSeconds: 0 }
    });
  }
  res.json({ ok: true });
});

// 管理：匯入經典（名稱+全文→建立章與段）
app.post('/api/admin/import', async (req, res) => {
  const { workName, chapterTitle = '第一篇', fulltext } = req.body;
  if (!workName || !fulltext) return res.status(400).json({ error: 'workName, fulltext required' });
  const work = await prisma.work.upsert({ where: { name: workName }, update: {}, create: { name: workName } });
  const ch = await prisma.chapter.create({ data: { workId: work.id, title: chapterTitle, order: 1 } });
  const parts = fulltext.replace(/\s+/g,'')
    .split(/([。！？!?；;])/).reduce((a,cur)=>{ if(/[。！？!?；;]/.test(cur)) a[a.length-1]+=cur; else if(cur) a.push(cur); return a; },[]);
  const data = parts.map((t,i)=>({ chapterId: ch.id, order: i+1, text: t }));
  await prisma.paragraph.createMany({ data });
  res.json({ workId: work.id, chapterId: ch.id, paragraphs: data.length });
});

// 統計
app.get('/api/stats', async (req, res) => {
  const lid = req.headers['x-user-id'];
  const user = lid ? await prisma.user.findUnique({ where: { lineUserId: lid } }) : null;
  const mine = user ? await prisma.stat.findUnique({ where: { userId: user.id } }) : null;
  const agg = await prisma.stat.aggregate({ _avg: { totalUsageSeconds: true, totalPracticeSeconds: true } });
  const dMine = mine ? (mine.totalPracticeSeconds / Math.max(1, mine.totalUsageSeconds)) : 0;
  const dAvg = (agg._avg.totalPracticeSeconds || 0) / Math.max(1, agg._avg.totalUsageSeconds || 0);
  res.json({
    personal: { totalUsageSeconds: mine?.totalUsageSeconds || 0, totalPracticeSeconds: mine?.totalPracticeSeconds || 0, diligence: dMine },
    overall: { avgUsageSeconds: Math.round(agg._avg.totalUsageSeconds || 0), avgPracticeSeconds: Math.round(agg._avg.totalPracticeSeconds || 0), avgDiligence: Number.isFinite(dAvg)? dAvg: 0 }
  });
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));


