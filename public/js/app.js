import { watchCategories, watchProducts } from './firestore-db.js';
import { initBackToTop } from './ui.js';

const productListEl = document.getElementById('productList');
const searchEl = document.getElementById('search');
const quickNavEl = document.getElementById('quickNav');

let categoriesCache = [];
let productsCache = [];

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatPrice(n) {
  return Number(n).toLocaleString('zh-Hant', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function priceCellHtml(price, justChanged) {
  const priceText = price === null || price === undefined ? '--' : `$${formatPrice(price)}`;
  return justChanged ? `${priceText} <span class="badge-changed">調整</span>` : priceText;
}

// 若所有規格名稱都是「規格 / 等級」格式，且規格與等級各有多種取值，
// 就攤開成矩陣（左邊規格、上面等級、右下價錢），否則回傳 null 改用一般清單。
function buildGrid(specs) {
  const rows = [];
  const cols = [];
  const matrix = {};
  for (const s of specs) {
    const parts = s.spec_name.split(' / ');
    if (parts.length !== 2) return null;
    const [row, col] = parts;
    if (!rows.includes(row)) rows.push(row);
    if (!cols.includes(col)) cols.push(col);
    matrix[row + ' ' + col] = s;
  }
  if (rows.length < 2 || cols.length < 2) return null;
  return { rows, cols, matrix };
}

function gridTableHtml(grid) {
  return `
    <table>
      <thead>
        <tr><th></th>${grid.cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${grid.rows.map(r => `
          <tr>
            <th class="row-head">${escapeHtml(r)}</th>
            ${grid.cols.map(c => {
              const s = grid.matrix[r + ' ' + c];
              return `<td class="price-cell">${s ? priceCellHtml(s.price, s.justChanged) : '--'}</td>`;
            }).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function flatTableHtml(specs) {
  return `
    <table>
      <thead><tr><th>規格</th><th>價格</th></tr></thead>
      <tbody>
        ${specs.map(s => `
          <tr>
            <td>${escapeHtml(s.spec_name)}</td>
            <td class="price-cell">${priceCellHtml(s.price, s.justChanged)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function productCardHtml(p) {
  const grid = p.specs.length ? buildGrid(p.specs) : null;
  return `
    <div class="card" id="prod-${p.id}">
      <div class="card-head">
        <div>
          <div class="product-name">${escapeHtml(p.name)} ${p.isNew ? '<span class="badge-new">NEW</span>' : ''}</div>
          ${p.note ? `<div class="note">${escapeHtml(p.note)}</div>` : ''}
        </div>
      </div>
      ${p.specs.length ? `<div class="table-scroll">${grid ? gridTableHtml(grid) : flatTableHtml(p.specs)}</div>` : '<div class="note">尚未設定規格</div>'}
    </div>
  `;
}

function applyFiltersAndRender() {
  const q = searchEl.value.trim().toLowerCase();

  let products = productsCache;
  if (q) {
    products = products.filter((p) =>
      p.name.toLowerCase().includes(q) || p.specs.some((s) => s.spec_name.toLowerCase().includes(q))
    );
  }

  renderProducts(products);
}

function renderProducts(products) {
  if (!products.length) {
    productListEl.innerHTML = '<div class="empty-state">找不到符合的產品</div>';
    quickNavEl.innerHTML = '';
    return;
  }

  const groups = new Map();
  for (const p of products) {
    const key = p.categoryId || 'none';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const sections = [];
  for (const c of categoriesCache) {
    if (groups.has(c.id)) sections.push({ id: c.id, name: c.name, items: groups.get(c.id) });
  }
  if (groups.has('none')) sections.push({ id: 'none', name: '未分類', items: groups.get('none') });

  productListEl.innerHTML = sections.map(sec => `
    <h2 class="category-heading" id="cat-${sec.id}">${escapeHtml(sec.name)}</h2>
    ${sec.items.map(productCardHtml).join('')}
  `).join('');

  quickNavEl.innerHTML = sections.flatMap(sec => sec.items).map(p =>
    `<a href="#prod-${p.id}">${escapeHtml(p.name)}</a>`
  ).join('');
}

searchEl.addEventListener('input', applyFiltersAndRender);

watchCategories((categories) => {
  categoriesCache = categories;
  applyFiltersAndRender();
});

watchProducts((products) => {
  productsCache = products;
  applyFiltersAndRender();
});

initBackToTop();
