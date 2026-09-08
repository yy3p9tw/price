// 純靜態檔案伺服器，僅供本機預覽用。
// 實際資料存取都在瀏覽器端直接透過 Firestore 完成（見 public/js/firestore-db.js）。
const express = require('express');
const path = require('node:path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`本機預覽已啟動: http://localhost:${PORT}`);
  console.log(`前台頁面: http://localhost:${PORT}/`);
  console.log(`後台管理: http://localhost:${PORT}/admin.html`);
});
