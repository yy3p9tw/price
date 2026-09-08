const productListEl = document.getElementById('productList');
const searchEl = document.getElementById('search');
const categoryFilterEl = document.getElementById('categoryFilter');
const categoryListEl = document.getElementById('categoryList');

let categories = [];
let searchTimer = null;

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

function formatDate(iso) {
  if (!iso) return '';
  return iso.replace('T', ' ').slice(0, 19);
}

async function api(url, options) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '發生錯誤');
  return data;
}

// ---------- categories ----------

async function loadCategories() {
  categories = await api('/api/categories');

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
      await api(`/api/categories/${btn.dataset.id}`, { method: 'DELETE' });
      await loadCategories();
      await loadProducts();
    });
  });
}

document.getElementById('addCategoryBtn').addEventListener('click', async () => {
  const input = document.getElementById('newCategoryName');
  const name = input.value.trim();
  if (!name) return;
  try {
    await api('/api/categories', { method: 'POST', body: JSON.stringify({ name }) });
    input.value = '';
    await loadCategories();
  } catch (e) {
    alert(e.message);
  }
});

// ---------- products ----------

async function loadProducts() {
  const params = new URLSearchParams();
  if (searchEl.value.trim()) params.set('q', searchEl.value.trim());
  if (categoryFilterEl.value) params.set('category_id', categoryFilterEl.value);

  const products = await api('/api/products?' + params.toString());
  renderProducts(products);
}

function renderProducts(products) {
  if (!products.length) {
    productListEl.innerHTML = '<div class="empty-state">尚無產品，點選「＋ 新增產品」開始建立</div>';
    return;
  }

  productListEl.innerHTML = products.map(p => `
    <div class="card" data-product-id="${p.id}">
      <div class="card-head">
        <div>
          <div class="product-name">${escapeHtml(p.name)}</div>
          ${p.category_name ? `<span class="tag">${escapeHtml(p.category_name)}</span>` : ''}
          ${p.note ? `<div class="note">${escapeHtml(p.note)}</div>` : ''}
        </div>
        <div class="card-actions">
          <button class="btn-secondary btn-sm edit-product-btn" data-id="${p.id}">編輯</button>
          <button class="btn-danger btn-sm del-product-btn" data-id="${p.id}">刪除</button>
        </div>
      </div>

      ${p.specs.length ? `
        <table>
          <thead><tr><th>規格</th><th>價格</th><th></th></tr></thead>
          <tbody>
            ${p.specs.map(s => `
              <tr data-spec-id="${s.id}">
                <td>${escapeHtml(s.spec_name)}</td>
                <td class="price-cell">${priceCellHtml(s.price)}</td>
                <td>
                  <div class="spec-row-actions">
                    <span class="muted-link history-spec-btn" data-id="${s.id}">歷史</span>
                    <button class="btn-secondary btn-sm edit-spec-btn" data-id="${s.id}">編輯</button>
                    <button class="btn-danger btn-sm del-spec-btn" data-id="${s.id}">刪除</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<div class="note">尚未設定規格</div>'}

      <div class="spec-add-row">
        <input type="text" class="new-spec-name" placeholder="新規格名稱，例如：紅色 / L">
        <input type="number" class="new-spec-price price-input" placeholder="價格（未定留空）" min="0" step="0.01">
        <button class="btn-primary btn-sm add-spec-btn" data-id="${p.id}">＋ 新增規格</button>
      </div>
    </div>
  `).join('');

  bindProductCardEvents(products);
}

function bindProductCardEvents(products) {
  productListEl.querySelectorAll('.edit-product-btn').forEach(btn => {
    btn.addEventListener('click', () => openProductModal(products.find(p => p.id == btn.dataset.id)));
  });

  productListEl.querySelectorAll('.del-product-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('確定刪除此產品？其下所有規格與歷史紀錄也會一併刪除。')) return;
      await api(`/api/products/${btn.dataset.id}`, { method: 'DELETE' });
      await loadProducts();
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
        await api(`/api/products/${btn.dataset.id}/specs`, {
          method: 'POST',
          body: JSON.stringify({ spec_name, price: price === '' ? null : Number(price) }),
        });
        await loadProducts();
      } catch (e) {
        alert(e.message);
      }
    });
  });

  productListEl.querySelectorAll('.edit-spec-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('tr');
      const product = products.find(p => p.specs.some(s => s.id == btn.dataset.id));
      const spec = product.specs.find(s => s.id == btn.dataset.id);
      openSpecModal(spec);
    });
  });

  productListEl.querySelectorAll('.del-spec-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('確定刪除此規格？')) return;
      await api(`/api/specs/${btn.dataset.id}`, { method: 'DELETE' });
      await loadProducts();
    });
  });

  productListEl.querySelectorAll('.history-spec-btn').forEach(btn => {
    btn.addEventListener('click', () => openHistoryModal(btn.dataset.id));
  });
}

// ---------- product modal ----------

const productModal = document.getElementById('productModal');

function openProductModal(product) {
  document.getElementById('productModalTitle').textContent = product ? '編輯產品' : '新增產品';
  document.getElementById('productId').value = product ? product.id : '';
  document.getElementById('productName').value = product ? product.name : '';
  document.getElementById('productCategory').value = product && product.category_id ? product.category_id : '';
  document.getElementById('productNote').value = product ? (product.note || '') : '';
  productModal.hidden = false;
}

document.getElementById('addProductBtn').addEventListener('click', () => openProductModal(null));
document.getElementById('productCancelBtn').addEventListener('click', () => (productModal.hidden = true));

document.getElementById('productSaveBtn').addEventListener('click', async () => {
  const id = document.getElementById('productId').value;
  const name = document.getElementById('productName').value.trim();
  const category_id = document.getElementById('productCategory').value || null;
  const note = document.getElementById('productNote').value.trim() || null;
  if (!name) return alert('請輸入產品名稱');

  try {
    if (id) {
      await api(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify({ name, category_id, note }) });
    } else {
      await api('/api/products', { method: 'POST', body: JSON.stringify({ name, category_id, note }) });
    }
    productModal.hidden = true;
    await loadProducts();
  } catch (e) {
    alert(e.message);
  }
});

// ---------- spec modal ----------

const specModal = document.getElementById('specModal');

function openSpecModal(spec) {
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
    await api(`/api/specs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ spec_name, price: price === '' ? null : Number(price) }),
    });
    specModal.hidden = true;
    await loadProducts();
  } catch (e) {
    alert(e.message);
  }
});

// ---------- history modal ----------

const historyModal = document.getElementById('historyModal');

async function openHistoryModal(specId) {
  const history = await api(`/api/specs/${specId}/history`);
  const listEl = document.getElementById('historyList');

  if (!history.length) {
    listEl.innerHTML = '<li>尚無異動紀錄</li>';
  } else {
    listEl.innerHTML = history.map(h => {
      const isFirst = h.old_price === null;
      const diff = isFirst ? null : h.new_price - h.old_price;
      const cls = diff > 0 ? 'price-up' : diff < 0 ? 'price-down' : '';
      const desc = isFirst
        ? `設定價格為 $${formatPrice(h.new_price)}`
        : `$${formatPrice(h.old_price)} → $${formatPrice(h.new_price)}`;
      return `<li><span>${formatDate(h.changed_at)}</span><span class="${cls}">${desc}</span></li>`;
    }).join('');
  }
  historyModal.hidden = false;
}

document.getElementById('historyCloseBtn').addEventListener('click', () => (historyModal.hidden = true));

// ---------- misc ----------

searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadProducts, 250);
});
categoryFilterEl.addEventListener('change', loadProducts);

[productModal, specModal, historyModal].forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });
});

(async function init() {
  await loadCategories();
  await loadProducts();
})();
