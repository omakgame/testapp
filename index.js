const express = require('express');
const app = express();

// 使用 Heroku 會提供 process.env.PORT，本地則預設 3000
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Hello World');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
