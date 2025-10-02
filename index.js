const express = require('express');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// 健康檢查
app.get('/', (req, res) => res.send('OK'));

// 列出所有 Post
app.get('/posts', async (req, res) => {
  const posts = await prisma.post.findMany({ orderBy: { id: 'desc' } });
  res.json(posts);
});

// 新增一筆 Post
app.post('/posts', async (req, res) => {
  const { title, content } = req.body;
  const post = await prisma.post.create({ data: { title, content } });
  res.json(post);
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));