'use strict';
(async function () {
  const { $, $$, esc, money, dateStr, api } = Kitty;
  await Kitty.ready;
  const user = Kitty.state.user;
  const view = $('#view');
  if (!user) { location.href = '/login.html?next=/admin.html'; return; }
  if (user.role !== 'admin') {
    document.querySelector('.admin-shell').innerHTML = '<main class="admin-main"><h1>Admins only</h1><p>This area is for shop admins. <a href="/" style="text-decoration:underline">Back to the shop</a></p></main>';
    return;
  }

  const STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  const fail = e => Kitty.toast(e.message, 'err');
  let products = [];

  /* ------------------------------ navigation ------------------------------ */
  const views = { dashboard, products: productsView, orders, customers };
  async function go(name) {
    $$('#admin-nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    view.innerHTML = '<p class="muted">Loading...</p>';
    try { await views[name](); } catch (e) { view.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
    history.replaceState(null, '', '#' + name);
  }
  $('#admin-nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.view); });

  /* ------------------------------ dashboard ------------------------------ */
  async function dashboard() {
    const s = await api('/admin/stats');
    const max = Math.max(...s.days.map(d => d.totalCents), 1);
    view.innerHTML = `<div class="page-head"><h1>Dashboard</h1></div>
      <div class="stats">
        <div class="stat"><span>Revenue</span><strong>${money(s.revenueCents)}</strong></div>
        <div class="stat"><span>Orders</span><strong>${s.orders}</strong></div>
        <div class="stat"><span>Waiting to process</span><strong>${s.pendingOrders}</strong></div>
        <div class="stat"><span>Products</span><strong>${s.products}</strong></div>
        <div class="stat"><span>Customers</span><strong>${s.customers}</strong></div>
      </div>
      <div class="admin-grid">
        <section class="panel"><h3>Sales, last 7 days</h3>
          <div class="bars">${s.days.map(d => `<div class="bar" title="${money(d.totalCents)}"><i style="height:${Math.round(d.totalCents / max * 100)}%"></i>${d.day.slice(5)}</div>`).join('')}</div></section>
        <section class="panel"><h3>Low stock</h3>
          ${s.lowStock.length ? `<ul class="mini-list">${s.lowStock.map(p => `<li><span>${esc(p.name)}</span><span class="low">${p.stock} left</span></li>`).join('')}</ul>` : '<p class="muted">Everything is well stocked.</p>'}</section>
      </div>
      <section class="panel"><h3>Recent orders</h3>
        ${s.recentOrders.length ? `<ul class="mini-list">${s.recentOrders.map(o => `<li><span><strong>${esc(o.number)}</strong> ${esc(o.userName)}</span><span><span class="status ${esc(o.status)}">${esc(o.status)}</span> ${money(o.totalCents)}</span></li>`).join('')}</ul>` : '<p class="muted">No orders yet.</p>'}</section>`;
  }

  /* ------------------------------ products ------------------------------ */
  async function productsView() {
    products = (await api('/products?sort=newest')).products;
    view.innerHTML = `<div class="page-head"><h1>Products</h1><button class="btn" id="add-product">Add product</button></div>
      <div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Discount</th><th>Stock</th><th></th></tr></thead><tbody>
      ${products.map(p => `<tr data-id="${esc(p.id)}">
        <td><div class="prod-cell"><img class="thumb" src="${esc(p.images[0] || '/assets/images/logo/logo-cat.svg')}" alt=""><div><strong>${esc(p.name)}</strong>${p.featured ? '<br><span class="muted">Featured</span>' : ''}</div></div></td>
        <td>${esc(p.category)}</td>
        <td>${p.discountPercent ? `<strong>${money(p.finalCents)}</strong> <del class="muted">${money(p.priceCents)}</del>` : money(p.priceCents)}</td>
        <td>${p.discountPercent ? p.discountPercent + '%' : '-'}</td>
        <td class="${p.stock <= 5 ? 'low' : ''}">${p.stock}</td>
        <td><div class="actions"><button class="btn btn-sm btn-ghost" data-edit>Edit</button><button class="btn btn-sm btn-danger" data-delete>Delete</button></div></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No products yet.</td></tr>'}
      </tbody></table></div>`;
  }

  view.addEventListener('click', async e => {
    if (e.target.closest('#add-product')) return openForm();
    const row = e.target.closest('tr[data-id]');
    if (row && e.target.closest('[data-edit]')) return openForm(products.find(p => p.id === row.dataset.id));
    if (row && e.target.closest('[data-delete]')) {
      const p = products.find(x => x.id === row.dataset.id);
      if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
      try { await api('/admin/products/' + p.id, { method: 'DELETE' }); Kitty.toast('Product deleted'); go('products'); } catch (err) { fail(err); }
    }
    const toggle = e.target.closest('[data-toggle-order]');
    if (toggle) { const d = $('#detail-' + toggle.dataset.toggleOrder); d.hidden = !d.hidden; }
  });

  /* ---- product form (add + edit) ---- */
  const dlg = $('#product-dialog');
  let editing = null, formImages = [];

  function drawImages() {
    $('#pf-images').innerHTML = formImages.map((u, i) => `<div class="img-item"><img src="${esc(u)}" alt=""><button type="button" data-rm="${i}" aria-label="Remove image">&times;</button></div>`).join('') || '<span class="muted">No images yet</span>';
  }
  function drawPreview() {
    const price = Number($('#pf-price').value), d = Number($('#pf-discount').value) || 0;
    $('#pf-preview').textContent = price > 0 && d > 0 ? `Customers pay ${Kitty.state.config.currency}${(price * (100 - d) / 100).toFixed(2)}` : '';
  }
  async function openForm(p) {
    editing = p || null;
    try { const { categories } = await api('/categories'); $('#category-list').innerHTML = categories.map(c => `<option value="${esc(c.name)}">`).join(''); } catch { /* optional */ }
    $('#dlg-title').textContent = p ? 'Edit product' : 'Add product';
    $('#pf-error').textContent = '';
    $('#pf-name').value = p ? p.name : '';
    $('#pf-category').value = p ? p.category : '';
    $('#pf-stock').value = p ? p.stock : 10;
    $('#pf-price').value = p ? (p.priceCents / 100).toFixed(2) : '';
    $('#pf-discount').value = p ? p.discountPercent : 0;
    $('#pf-desc').value = p ? p.description : '';
    $('#pf-featured').checked = p ? p.featured : false;
    formImages = p ? p.images.slice() : [];
    drawImages(); drawPreview();
    dlg.showModal();
  }
  $('#pf-price').addEventListener('input', drawPreview);
  $('#pf-discount').addEventListener('input', drawPreview);
  $('#pf-cancel').addEventListener('click', () => dlg.close());
  $('#pf-images').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { formImages.splice(Number(b.dataset.rm), 1); drawImages(); } });
  $('#pf-upload').addEventListener('click', () => $('#pf-file').click());
  $('#pf-url-add').addEventListener('click', () => {
    const u = $('#pf-url').value.trim();
    if (!u) return;
    if (!/^https:\/\//.test(u)) { $('#pf-error').textContent = 'Image links must start with https://'; return; }
    formImages.push(u); $('#pf-url').value = ''; $('#pf-error').textContent = ''; drawImages();
  });
  $('#pf-file').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) {
      if (f.size > 4 * 1024 * 1024) { $('#pf-error').textContent = `"${f.name}" is bigger than 4 MB.`; continue; }
      try {
        const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
        const { url } = await api('/admin/upload', { method: 'POST', body: { data } });
        formImages.push(url); $('#pf-error').textContent = ''; drawImages();
      } catch (err) { $('#pf-error').textContent = err.message; }
    }
  });
  $('#product-form').addEventListener('submit', async e => {
    e.preventDefault();
    const price = Number($('#pf-price').value);
    const body = {
      name: $('#pf-name').value, category: $('#pf-category').value, description: $('#pf-desc').value,
      priceCents: Math.round(price * 100), discountPercent: Number($('#pf-discount').value || 0), stock: Number($('#pf-stock').value),
      featured: $('#pf-featured').checked, images: formImages
    };
    const btn = $('#pf-save'); btn.disabled = true;
    try {
      if (editing) await api('/admin/products/' + editing.id, { method: 'PUT', body });
      else await api('/admin/products', { method: 'POST', body });
      dlg.close(); Kitty.toast(editing ? 'Product updated' : 'Product added'); go('products');
    } catch (err) { $('#pf-error').textContent = err.message; }
    btn.disabled = false;
  });

  /* ------------------------------ orders ------------------------------ */
  async function orders() {
    const list = (await api('/admin/orders')).orders;
    view.innerHTML = `<div class="page-head"><h1>Orders</h1></div>
      <div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Payment</th><th>Total</th><th>Status</th></tr></thead><tbody>
      ${list.map(o => `<tr>
        <td><button class="link-btn" style="color:var(--ink)" data-toggle-order="${esc(o.id)}"><strong>${esc(o.number)}</strong> (details)</button></td>
        <td>${esc(o.userName)}<br><span class="muted">${esc(o.userEmail)}</span></td>
        <td>${dateStr(o.createdAt)}</td>
        <td>${esc(o.paymentMethod)}<br><span class="muted">${esc(o.paymentStatus)}</span></td>
        <td>${money(o.totalCents)}</td>
        <td><select data-order="${esc(o.id)}" aria-label="Status of ${esc(o.number)}">${STATUSES.map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>
        <tr class="order-detail" id="detail-${esc(o.id)}" hidden><td colspan="6">
          <strong>Items</strong><ul>${o.items.map(i => `<li>${esc(i.name)} &times; ${i.qty} (${money(i.unitCents * i.qty)})</li>`).join('')}</ul>
          <p style="margin:10px 0 0"><strong>Ship to:</strong> ${esc(o.shipping.fullName)}, ${esc(o.shipping.address)}, ${esc(o.shipping.zip)} ${esc(o.shipping.city)}, ${esc(o.shipping.country)} &middot; ${esc(o.shipping.phone)}</p>
          <p style="margin:4px 0 0" class="muted">Subtotal ${money(o.subtotalCents)} + shipping ${money(o.shippingCents)}</p></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No orders yet.</td></tr>'}
      </tbody></table></div>`;
  }
  view.addEventListener('change', async e => {
    const sel = e.target.closest('[data-order]');
    if (!sel) return;
    try { await api('/admin/orders/' + sel.dataset.order, { method: 'PUT', body: { status: sel.value } }); Kitty.toast('Order updated'); go('orders'); }
    catch (err) { fail(err); go('orders'); }
  });

  /* ------------------------------ customers ------------------------------ */
  async function customers() {
    const list = (await api('/admin/users')).users;
    view.innerHTML = `<div class="page-head"><h1>Customers</h1></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Orders</th></tr></thead><tbody>
      ${list.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${dateStr(u.createdAt)}</td><td>${u.orders}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  const start = location.hash.slice(1);
  go(Object.hasOwn(views, start) ? start : 'dashboard');
})();
