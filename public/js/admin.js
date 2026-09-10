import {
  watchAuth, login, logout, watchCategories, watchProducts,
  createCategory, deleteCategory, createProduct, updateProduct, deleteProduct,
  addSpec, updateSpec, deleteSpec, getSpecHistory, setProductNew, setSpecChanged,
  watchAllHistory,
} from './firestore-db.js';
import { initBackToTop } from './ui.js';

const productListEl = document.getElementById('productList');
const searchEl = document.getElementById('search');
const categoryFilterEl = document.getElementById('categoryFilter');
const categoryListEl = document.getElementById('categoryList');
const loginCard = document.getElementById('loginCard');
const adminArea = document.getElementById('adminArea');
const logoutBtn = document.getElementById('logoutBtn');

let categories = [];
let products = [];
let allHistory = [];
let stopWatchCategories = null;
let stopWatchProducts = null;
let stopWatchAllHistory = null;

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatPrice(n) {
  return Number(n).toLocaleString('zh-Hant', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function priceCellHtml(price) {
  return price === null || price === undefined ? '--' : `$${formatPrice(price)}`;
}

function formatDate(ts) {
  if (!ts || !ts.seconds) return '';
  return new Date(ts.seconds * 1000).toLocaleString('zh-Hant', { hour12: false });
}

// ---------- auth ----------

watchAuth((user) => {
  if (user) {
    loginCard.hidden = true;
    adminArea.hidden = false;
    logoutBtn.hidden = false;
    if (!stopWatchCategories) stopWatchCategories = watchCategories(onCategories);
    if (!stopWatchProducts) stopWatchProducts = watchProducts(onProducts);
    if (!stopWatchAllHistory) stopWatchAllHistory = watchAllHistory(onAllHistory);
  } else {
    loginCard.hidden = false;
    adminArea.hidden = true;
    logoutBtn.hidden = true;
    if (stopWatchCategories) { stopWatchCategories(); stopWatchCategories = null; }
    if (stopWatchProducts) { stopWatchProducts(); stopWatchProducts = null; }
    if (stopWatchAllHistory) { stopWatchAllHistory(); stopWatchAllHistory = null; }
    categories = [];
    products = [];
    allHistory = [];
  }
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';
  try {
    await login(email, password);
  } catch (e) {
    errorEl.textContent = '登入失敗，請確認帳號密碼。';
  }
});

logoutBtn.addEventListener('click', () => logout());

// ---------- categories ----------

function onCategories(list) {
  categories = list;

  categoryListEl.innerHTML = categories.map(c => `
    <span class="category-chip">
      ${escapeHtml(c.name)}
      <button data-id="${c.id}" class="del-category-btn" title="刪除分類">✕</button>
    </span>
  `).join('') || '<span class="note">尚無分類</span>';

  const options = categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  categoryFilterEl.innerHTML = '<option value="">全部分類</option>' + options;
  document.getElementById('productCategory').innerHTML = '<option value="">（無分類）</option>' + options;

  categoryListEl.querySelectorAll('.del-category-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('刪除此分類？（底下的產品會變成無分類，不會被刪除）')) return;
      await deleteCategory(btn.dataset.id);
    });
  });

  renderProducts();
}

document.getElementById('addCategoryBtn').addEventListener('click', async () => {
  const input = document.getElementById('newCategoryName');
  const name = input.value.trim();
  if (!name) return;
  try {
    const nextOrder = categories.reduce((max, c) => Math.max(max, c.sortOrder ?? 0), 0) + 1;
    await createCategory(name, nextOrder);
    input.value = '';
  } catch (e) {
    alert(e.message);
  }
});

// ---------- products ----------

function onProducts(list) {
  products = list;
  renderProducts();
}

function filteredProducts() {
  const q = searchEl.value.trim().toLowerCase();
  const categoryId = categoryFilterEl.value;
  let list = products;
  if (categoryId) list = list.filter((p) => p.categoryId === categoryId);
  if (q) {
    list = list.filter((p) =>
      p.name.toLowerCase().includes(q) || p.specs.some((s) => s.spec_name.toLowerCase().includes(q))
    );
  }
  return list;
}

function categoryName(id) {
  const c = categories.find((c) => c.id === id);
  return c ? c.name : '';
}

function renderProducts() {
  const list = filteredProducts();

  if (!list.length) {
    productListEl.innerHTML = '<div class="empty-state">尚無產品，點選「＋ 新增產品」開始建立</div>';
    return;
  }

  productListEl.innerHTML = list.map(p => `
    <div class="card" data-product-id="${p.id}">
      <div class="card-head">
        <div>
          <div class="product-name">${escapeHtml(p.name)} ${p.isNew ? '<span class="badge-new">NEW</span>' : ''}</div>
          ${p.categoryId ? `<span class="tag">${escapeHtml(categoryName(p.categoryId))}</span>` : ''}
          ${p.note ? `<div class="note">${escapeHtml(p.note)}</div>` : ''}
        </div>
        <div class="card-actions">
          <button class="btn-secondary btn-sm toggle-new-btn" data-id="${p.id}" data-value="${p.isNew ? '0' : '1'}">${p.isNew ? '取消新品標記' : '標記新品'}</button>
          <button class="btn-secondary btn-sm edit-product-btn" data-id="${p.id}">編輯</button>
          <button class="btn-danger btn-sm del-product-btn" data-id="${p.id}">刪除</button>
        </div>
      </div>

      ${p.specs.length ? `
        <div class="table-scroll">
        <table>
          <thead><tr><th>規格</th><th>價格</th><th></th></tr></thead>
          <tbody>
            ${p.specs.map(s => `
              <tr data-spec-id="${s.id}">
                <td>${escapeHtml(s.spec_name)}</td>
                <td class="price-cell">${priceCellHtml(s.price)} ${s.justChanged ? '<span class="badge-changed">調整</span>' : ''}</td>
                <td>
                  <div class="spec-row-actions">
                    <span class="muted-link history-spec-btn" data-id="${s.id}">歷史</span>
                    <span class="muted-link toggle-changed-btn" data-id="${s.id}" data-value="${s.justChanged ? '0' : '1'}">${s.justChanged ? '取消標記' : '標記調整'}</span>
                    <button class="btn-secondary btn-sm edit-spec-btn" data-id="${s.id}">編輯</button>
                    <button class="btn-danger btn-sm del-spec-btn" data-id="${s.id}">刪除</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        </div>
      ` : '<div class="note">尚未設定規格</div>'}

      <div class="spec-add-row">
        <input type="text" class="new-spec-name" placeholder="新規格名稱，例如：紅色 / L">
        <input type="number" class="new-spec-price price-input" placeholder="價格（未定留空）" min="0" step="0.01">
        <button class="btn-primary btn-sm add-spec-btn" data-id="${p.id}">＋ 新增規格</button>
      </div>
    </div>
  `).join('');

  bindProductCardEvents();
}

function bindProductCardEvents() {
  productListEl.querySelectorAll('.edit-product-btn').forEach(btn => {
    btn.addEventListener('click', () => openProductModal(products.find(p => p.id === btn.dataset.id)));
  });

  productListEl.querySelectorAll('.del-product-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('確定刪除此產品？其下所有規格與歷史紀錄也會一併刪除。')) return;
      await deleteProduct(btn.dataset.id);
    });
  });

  productListEl.querySelectorAll('.toggle-new-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await setProductNew(btn.dataset.id, btn.dataset.value === '1');
    });
  });

  productListEl.querySelectorAll('.toggle-changed-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const product = products.find(p => p.specs.some(s => s.id === btn.dataset.id));
      await setSpecChanged(product, btn.dataset.id, btn.dataset.value === '1');
    });
  });

  productListEl.querySelectorAll('.add-spec-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.card');
      const nameInput = card.querySelector('.new-spec-name');
      const priceInput = card.querySelector('.new-spec-price');
      const spec_name = nameInput.value.trim();
      const price = priceInput.value;
      if (!spec_name) return alert('請輸入規格名稱');
      if (price !== '' && Number(price) < 0) return alert('請輸入有效價格');
      try {
        const product = products.find(p => p.id === btn.dataset.id);
        await addSpec(product, { spec_name, price: price === '' ? null : Number(price) });
      } catch (e) {
        alert(e.message);
      }
    });
  });

  productListEl.querySelectorAll('.edit-spec-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const product = products.find(p => p.specs.some(s => s.id === btn.dataset.id));
      const spec = product.specs.find(s => s.id === btn.dataset.id);
      openSpecModal(product.id, spec);
    });
  });

  productListEl.querySelectorAll('.del-spec-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('確定刪除此規格？')) return;
      const product = products.find(p => p.specs.some(s => s.id === btn.dataset.id));
      await deleteSpec(product, btn.dataset.id);
    });
  });

  productListEl.querySelectorAll('.history-spec-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const product = products.find(p => p.specs.some(s => s.id === btn.dataset.id));
      openHistoryModal(product.id, btn.dataset.id);
    });
  });
}

// ---------- product modal ----------

const productModal = document.getElementById('productModal');

function openProductModal(product) {
  document.getElementById('productModalTitle').textContent = product ? '編輯產品' : '新增產品';
  document.getElementById('productId').value = product ? product.id : '';
  document.getElementById('productName').value = product ? product.name : '';
  document.getElementById('productCategory').value = product && product.categoryId ? product.categoryId : '';
  document.getElementById('productNote').value = product ? (product.note || '') : '';
  productModal.hidden = false;
}

document.getElementById('addProductBtn').addEventListener('click', () => openProductModal(null));
document.getElementById('productCancelBtn').addEventListener('click', () => (productModal.hidden = true));

document.getElementById('productSaveBtn').addEventListener('click', async () => {
  const id = document.getElementById('productId').value;
  const name = document.getElementById('productName').value.trim();
  const categoryId = document.getElementById('productCategory').value || null;
  const note = document.getElementById('productNote').value.trim() || null;
  if (!name) return alert('請輸入產品名稱');

  try {
    if (id) {
      await updateProduct(id, { name, categoryId, note });
    } else {
      const nextSeq = products.reduce((max, p) => Math.max(max, p.seq ?? 0), 0) + 1;
      await createProduct({ name, categoryId, note, seq: nextSeq });
    }
    productModal.hidden = true;
  } catch (e) {
    alert(e.message);
  }
});

// ---------- spec modal ----------

const specModal = document.getElementById('specModal');
let specModalProductId = null;

function openSpecModal(productId, spec) {
  specModalProductId = productId;
  document.getElementById('specId').value = spec.id;
  document.getElementById('specName').value = spec.spec_name;
  document.getElementById('specPrice').value = spec.price === null ? '' : spec.price;
  specModal.hidden = false;
}

document.getElementById('specCancelBtn').addEventListener('click', () => (specModal.hidden = true));

document.getElementById('specSaveBtn').addEventListener('click', async () => {
  const id = document.getElementById('specId').value;
  const spec_name = document.getElementById('specName').value.trim();
  const price = document.getElementById('specPrice').value;
  if (!spec_name) return alert('請輸入規格名稱');
  if (price !== '' && Number(price) < 0) return alert('請輸入有效價格');

  try {
    const product = products.find(p => p.id === specModalProductId);
    await updateSpec(product, id, { spec_name, price: price === '' ? null : Number(price) });
    specModal.hidden = true;
  } catch (e) {
    alert(e.message);
  }
});

// ---------- history modal ----------

const historyModal = document.getElementById('historyModal');

async function openHistoryModal(productId, specId) {
  const history = await getSpecHistory(productId, specId);
  const listEl = document.getElementById('historyList');

  if (!history.length) {
    listEl.innerHTML = '<li>尚無異動紀錄</li>';
  } else {
    listEl.innerHTML = history.map(h => {
      const isFirst = h.oldPrice === null || h.oldPrice === undefined;
      const diff = isFirst ? null : h.newPrice - h.oldPrice;
      const cls = diff > 0 ? 'price-up' : diff < 0 ? 'price-down' : '';
      const desc = isFirst
        ? `設定價格為 $${formatPrice(h.newPrice)}`
        : `$${formatPrice(h.oldPrice)} → $${formatPrice(h.newPrice)}`;
      return `<li><span>${formatDate(h.changedAt)}</span><span class="${cls}">${desc}</span></li>`;
    }).join('');
  }
  historyModal.hidden = false;
}

document.getElementById('historyCloseBtn').addEventListener('click', () => (historyModal.hidden = true));

// ---------- global history modal ----------

const globalHistoryModal = document.getElementById('globalHistoryModal');
const globalHistoryBody = document.getElementById('globalHistoryBody');

function onAllHistory(list) {
  allHistory = list;
  if (!globalHistoryModal.hidden) renderGlobalHistory();
}

function findProductAndSpec(productId, specId) {
  const product = products.find((p) => p.id === productId);
  const spec = product ? product.specs.find((s) => s.id === specId) : null;
  return {
    productName: product ? product.name : '（已刪除產品）',
    specName: spec ? spec.spec_name : '（已刪除規格）',
  };
}

function renderGlobalHistory() {
  if (!allHistory.length) {
    globalHistoryBody.innerHTML = '<tr><td colspan="5" class="note">尚無異動紀錄</td></tr>';
    return;
  }
  globalHistoryBody.innerHTML = allHistory.map((h) => {
    const { productName, specName } = findProductAndSpec(h.productId, h.specId);
    const isNewEntry = h.oldPrice === null || h.oldPrice === undefined;
    const diff = isNewEntry ? null : h.newPrice - h.oldPrice;
    const priceCls = diff > 0 ? 'price-up' : diff < 0 ? 'price-down' : '';
    const priceText = isNewEntry ? `$${formatPrice(h.newPrice)}` : `$${formatPrice(h.oldPrice)} → $${formatPrice(h.newPrice)}`;
    const actionHtml = isNewEntry
      ? '<span class="badge-action badge-created">新增</span>'
      : '<span class="badge-action badge-adjusted">調整</span>';
    return `
      <tr>
        <td>${formatDate(h.changedAt)}</td>
        <td>${escapeHtml(productName)}</td>
        <td>${escapeHtml(specName)}</td>
        <td>${actionHtml}</td>
        <td class="price-cell ${priceCls}">${priceText}</td>
      </tr>
    `;
  }).join('');
}

document.getElementById('globalHistoryBtn').addEventListener('click', () => {
  globalHistoryModal.hidden = false;
  renderGlobalHistory();
});

document.getElementById('globalHistoryCloseBtn').addEventListener('click', () => (globalHistoryModal.hidden = true));

// ---------- misc ----------

searchEl.addEventListener('input', renderProducts);
categoryFilterEl.addEventListener('change', renderProducts);

[productModal, specModal, historyModal, globalHistoryModal].forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });
});

initBackToTop();
