const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');

const authPath = fs.existsSync(path.join(__dirname, 'auth.json'))
  ? './auth.json'
  : './auth.json.example';
if (authPath === './auth.json.example') {
  console.warn('警告：找不到 auth.json，暫用 auth.json.example 的預設帳密，請盡快複製一份 auth.json 並修改密碼。');
}
const auth = require(authPath);

const app = express();
app.use(express.json());

const REALM = 'Admin';
function basicAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    if (user === auth.username && pass === auth.password) return next();
  }
  res.set('WWW-Authenticate', `Basic realm="${REALM}"`);
  res.status(401).send('需要登入才能存取後台');
}

// 後台頁面本身需要登入；其餘靜態檔案（前台頁面、共用 css/js）維持公開
app.get('/admin.html', basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 前台查詢（GET）維持公開，後台的新增/修改/刪除（非 GET）需要登入
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') return next();
  return basicAuth(req, res, next);
});

app.use(express.static(path.join(__dirname, 'public')));

function now() {
  return new Date().toISOString();
}

// 空白、null 或 "--" 代表尚未提供價格
const PRICE_ERROR = Symbol('price_error');
function parsePrice(raw) {
  if (raw === undefined || raw === null || raw === '' || raw === '--') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return PRICE_ERROR;
  return n;
}

// ---------- categories ----------

app.get('/api/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
  res.json(rows);
});

app.post('/api/categories', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '分類名稱不可為空' });
  try {
    const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM categories').get().n;
    const info = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)').run(name, nextOrder);
    res.json({ id: Number(info.lastInsertRowid), name });
  } catch (e) {
    res.status(400).json({ error: '分類名稱已存在' });
  }
});

app.put('/api/categories/:id', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '分類名稱不可為空' });
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- products (with nested specs) ----------

function loadProducts({ categoryId, q } = {}) {
  let sql = `SELECT p.*, c.name AS category_name FROM products p
             LEFT JOIN categories c ON c.id = p.category_id`;
  const where = [];
  const params = [];

  if (categoryId) {
    where.push('p.category_id = ?');
    params.push(categoryId);
  }
  if (q) {
    where.push(`(p.name LIKE ? OR p.id IN (SELECT product_id FROM specs WHERE spec_name LIKE ?))`);
    params.push(`%${q}%`, `%${q}%`);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY p.id ASC';

  const products = db.prepare(sql).all(...params);
  const specStmt = db.prepare('SELECT * FROM specs WHERE product_id = ? ORDER BY id');
  for (const p of products) {
    p.specs = specStmt.all(p.id);
  }
  return products;
}

app.get('/api/products', (req, res) => {
  const { category_id, q } = req.query;
  res.json(loadProducts({ categoryId: category_id, q }));
});

app.get('/api/products/:id', (req, res) => {
  const product = db.prepare(`SELECT p.*, c.name AS category_name FROM products p
    LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`).get(req.params.id);
  if (!product) return res.status(404).json({ error: '找不到產品' });
  product.specs = db.prepare('SELECT * FROM specs WHERE product_id = ? ORDER BY id').all(product.id);
  res.json(product);
});

app.post('/api/products', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '產品名稱不可為空' });
  const categoryId = req.body.category_id || null;
  const note = req.body.note || null;
  const info = db.prepare(
    'INSERT INTO products (name, category_id, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(name, categoryId, note, now(), now());
  res.json({ id: Number(info.lastInsertRowid) });
});

app.put('/api/products/:id', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '產品名稱不可為空' });
  const categoryId = req.body.category_id || null;
  const note = req.body.note || null;
  db.prepare('UPDATE products SET name = ?, category_id = ?, note = ?, updated_at = ? WHERE id = ?')
    .run(name, categoryId, note, now(), req.params.id);
  res.json({ ok: true });
});

app.delete('/api/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- specs ----------

app.post('/api/products/:id/specs', (req, res) => {
  const specName = (req.body.spec_name || '').trim();
  if (!specName) return res.status(400).json({ error: '規格名稱不可為空' });
  const price = parsePrice(req.body.price);
  if (price === PRICE_ERROR) return res.status(400).json({ error: '價格格式錯誤' });
  const note = req.body.note || null;

  const info = db.prepare(
    'INSERT INTO specs (product_id, spec_name, price, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.params.id, specName, price, note, now(), now());
  if (price !== null) {
    db.prepare('INSERT INTO price_history (spec_id, old_price, new_price, changed_at) VALUES (?, NULL, ?, ?)')
      .run(Number(info.lastInsertRowid), price, now());
  }
  db.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run(now(), req.params.id);

  res.json({ id: Number(info.lastInsertRowid) });
});

app.put('/api/specs/:id', (req, res) => {
  const spec = db.prepare('SELECT * FROM specs WHERE id = ?').get(req.params.id);
  if (!spec) return res.status(404).json({ error: '找不到規格' });

  const specName = (req.body.spec_name || '').trim();
  if (!specName) return res.status(400).json({ error: '規格名稱不可為空' });
  const price = parsePrice(req.body.price);
  if (price === PRICE_ERROR) return res.status(400).json({ error: '價格格式錯誤' });
  const note = req.body.note || null;

  db.prepare('UPDATE specs SET spec_name = ?, price = ?, note = ?, updated_at = ? WHERE id = ?')
    .run(specName, price, note, now(), req.params.id);

  if (price !== null && price !== spec.price) {
    db.prepare('INSERT INTO price_history (spec_id, old_price, new_price, changed_at) VALUES (?, ?, ?, ?)')
      .run(req.params.id, spec.price, price, now());
  }
  db.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run(now(), spec.product_id);

  res.json({ ok: true });
});

app.delete('/api/specs/:id', (req, res) => {
  const spec = db.prepare('SELECT * FROM specs WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM specs WHERE id = ?').run(req.params.id);
  if (spec) db.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run(now(), spec.product_id);
  res.json({ ok: true });
});

app.get('/api/specs/:id/history', (req, res) => {
  const rows = db.prepare('SELECT * FROM price_history WHERE spec_id = ? ORDER BY changed_at DESC, id DESC')
    .all(req.params.id);
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`價格管理系統已啟動: http://localhost:${PORT}`);
  console.log(`前台頁面: http://localhost:${PORT}/`);
  console.log(`後台管理: http://localhost:${PORT}/admin.html`);
});
