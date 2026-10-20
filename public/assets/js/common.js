'use strict';
/* Shared code for every page: helpers, API calls, login state, cart, header and footer. */

const Kitty = (() => {
  const state = { user: null, config: { currency: '$', shippingCents: 499, freeShippingOverCents: 5000 }, cart: [] };
  const CART_KEY = 'kitty_cart';

  /* ---------- small helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  // Escape text before putting it into HTML (stops injected scripts)
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = cents => state.config.currency + (cents / 100).toFixed(2);
  const dateStr = iso => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const stars = r => {
    const full = Math.round(r);
    return `<span class="stars" aria-label="${r} out of 5 stars">${'★'.repeat(full)}<span class="off">${'★'.repeat(5 - full)}</span></span>`;
  };
  // only allow same-site relative links for ?next=
  const safeNext = n => (typeof n === 'string' && /^\/?[\w\-./]+(\?[\w\-=&%.]*)?$/.test(n) && !n.includes('..') && !n.startsWith('//') ? n : '');

  function toast(msg, type = 'ok') {
    let box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body || {}); }
    let res;
    try { res = await fetch('/api' + path, opts); } catch { throw new Error('Cannot reach the server. Is it running?'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; throw e; }
    return data;
  }

  /* ---------- cart ---------- */
  // Guests: cart lives in localStorage. Logged-in users: cart is saved on the server too.
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } };
  const writeLocal = items => { try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch { /* storage blocked */ } };

  async function loadCart() {
    if (state.user) {
      const local = readLocal();
      const server = (await api('/cart')).items.map(i => ({ id: i.productId, qty: i.qty }));
      if (local.length) { // merge what the visitor added before logging in
        local.forEach(l => { const s = server.find(x => x.id === l.id); if (s) s.qty += l.qty; else server.push(l); });
        state.cart = server; writeLocal([]);
        await saveCart();
      } else state.cart = server;
    } else state.cart = readLocal();
  }
  async function saveCart() {
    if (state.user) {
      const res = await api('/cart', { method: 'PUT', body: { items: state.cart.map(i => ({ productId: i.id, qty: i.qty })) } });
      state.cart = res.items.map(i => ({ id: i.productId, qty: i.qty }));
    } else writeLocal(state.cart);
    updateBadge();
  }
  const cartCount = () => state.cart.reduce((t, i) => t + i.qty, 0);
  function updateBadge() { $$('[data-cart-count]').forEach(b => { b.textContent = cartCount(); b.hidden = cartCount() === 0; }); }

  async function addToCart(id, qty = 1) {
    const item = state.cart.find(i => i.id === id);
    if (item) item.qty = Math.min(item.qty + qty, 99); else state.cart.push({ id, qty });
    await saveCart();
  }
  async function setQty(id, qty) {
    if (qty < 1) state.cart = state.cart.filter(i => i.id !== id);
    else { const it = state.cart.find(i => i.id === id); if (it) it.qty = Math.min(qty, 99); }
    await saveCart();
  }
  // cart items joined with live product info (name, price, stock)
  async function cartLines() {
    if (!state.cart.length) return [];
    const { products } = await api('/products?ids=' + state.cart.map(i => i.id).join(','));
    const lines = state.cart.map(i => ({ ...i, product: products.find(p => p.id === i.id) })).filter(l => l.product);
    if (lines.length !== state.cart.length) { state.cart = lines.map(l => ({ id: l.id, qty: l.qty })); await saveCart(); }
    return lines;
  }
  function totals(lines) {
    const subtotal = lines.reduce((t, l) => t + l.product.finalCents * l.qty, 0);
    const { shippingCents, freeShippingOverCents } = state.config;
    const shipping = subtotal === 0 || subtotal >= freeShippingOverCents ? 0 : shippingCents;
    return { subtotal, shipping, total: subtotal + shipping };
  }

  /* ---------- auth ---------- */
  async function loadUser() { try { state.user = (await api('/auth/me')).user; } catch { state.user = null; } }
  async function logout() { await api('/auth/logout', { method: 'POST' }); state.user = null; writeLocal([]); location.href = '/'; }

  /* ---------- product card (used on home + product pages) ---------- */
  function productCard(p) {
    const out = p.stock < 1;
    return `<article class="card">
      <a class="card-img" href="/product.html?id=${esc(p.id)}">
        <img src="${esc(p.images[0] || '/assets/images/logo/logo-cat.svg')}" alt="${esc(p.name)}" loading="lazy">
        ${p.discountPercent ? `<span class="badge sale">-${p.discountPercent}%</span>` : ''}
        ${out ? '<span class="badge out">Sold out</span>' : ''}
      </a>
      <div class="card-body">
        <span class="card-cat">${esc(p.category)}</span>
        <h3><a href="/product.html?id=${esc(p.id)}">${esc(p.name)}</a></h3>
        ${p.rating ? stars(p.rating) : ''}
        <div class="price"><strong>${money(p.finalCents)}</strong>${p.discountPercent ? `<del>${money(p.priceCents)}</del>` : ''}</div>
        <button class="btn btn-sm" data-add-to-cart="${esc(p.id)}" ${out ? 'disabled' : ''}>${out ? 'Sold out' : 'Add to cart'}</button>
      </div>
    </article>`;
  }

  /* ---------- header + footer ---------- */
  const CATEGORY_LINKS = ['Food', 'Toys', 'Beds & Trees', 'Litter & Care', 'Collars & Travel'];
  function renderChrome() {
    const u = state.user;
    const q = new URLSearchParams(location.search).get('q') || '';
    const accountLinks = u
      ? `<a href="/account.html">My orders</a>${u.role === 'admin' ? '<a href="/admin.html">Admin dashboard</a>' : ''}<button type="button" data-logout>Log out</button>`
      : '<a href="/login.html">Log in</a><a href="/login.html?tab=signup">Create account</a>';
    const header = $('#site-header');
    if (header) header.innerHTML = `
      <div class="topbar"><div class="container"><span>Free shipping on orders over ${money(state.config.freeShippingOverCents)}</span><span>Made for cats, approved by one very picky black kitty</span></div></div>
      <header class="header"><div class="container header-row">
        <a class="logo" href="/" aria-label="Kitty Ecommerce home"><img src="/assets/images/logo/logo-cat.svg" alt="" width="52" height="48"><span>Kitty</span></a>
        <form class="search" action="/" method="get" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="Search toys, food, beds..." aria-label="Search products"><button>Search</button></form>
        <div class="header-actions">
          <div class="menu-wrap"><button class="icon-btn" type="button" data-menu aria-haspopup="true" aria-expanded="false">${u ? esc(u.name.split(' ')[0]) : 'Account'}</button><div class="dropdown" hidden>${accountLinks}</div></div>
          <a class="icon-btn cart-link" href="/cart.html">Cart <span class="count" data-cart-count hidden>0</span></a>
        </div></div></header>
      <nav class="nav" aria-label="Categories"><div class="container"><a href="/">Home</a>${CATEGORY_LINKS.map(c => `<a href="/?category=${encodeURIComponent(c)}#shop">${esc(c)}</a>`).join('')}<a class="hot" href="/?sale=1#shop">Sale</a></div></nav>`;
    const footer = $('#site-footer');
    if (footer) footer.innerHTML = `
      <footer class="footer"><div class="container footer-grid">
        <div><a class="logo light" href="/"><img src="/assets/images/logo/logo-cat.svg" alt="" width="44" height="41"><span>Kitty</span></a><p>Toys, food and cozy spots for cats who run the house.</p></div>
        <div><h4>Shop</h4>${CATEGORY_LINKS.map(c => `<a href="/?category=${encodeURIComponent(c)}#shop">${esc(c)}</a>`).join('')}</div>
        <div><h4>Your account</h4><a href="/login.html">Log in or sign up</a><a href="/account.html">My orders</a><a href="/cart.html">Cart</a></div>
        <div><h4>Contact</h4><p>hello@kitty.local<br>Mon to Fri, 9:00 to 17:00</p></div>
      </div><div class="container footer-bottom">&copy; ${new Date().getFullYear()} Kitty Ecommerce. Payments in this demo are not real.</div></footer>`;
    updateBadge();
  }

  /* ---------- global click handling (works for dynamically added buttons) ---------- */
  document.addEventListener('click', async e => {
    const add = e.target.closest('[data-add-to-cart]');
    if (add) {
      add.disabled = true;
      try { await addToCart(add.dataset.addToCart); toast('Added to your cart'); }
      catch (err) { toast(err.message, 'err'); }
      add.disabled = false;
      return;
    }
    if (e.target.closest('[data-logout]')) { logout(); return; }
    const menuBtn = e.target.closest('[data-menu]');
    $$('.dropdown').forEach(d => {
      const open = !!menuBtn && d.previousElementSibling === menuBtn && d.hidden;
      d.hidden = !open;
      if (d.previousElementSibling) d.previousElementSibling.setAttribute('aria-expanded', String(open));
    });
  });

  // Load everything the page needs, then draw the header. Page scripts: await Kitty.ready
  const ready = (async () => {
    await Promise.all([
      api('/config').then(c => { state.config = c; }).catch(() => {}),
      loadUser()
    ]);
    try { await loadCart(); } catch { state.cart = readLocal(); }
    renderChrome();
  })();

  return { state, $, $$, esc, money, dateStr, stars, safeNext, toast, api, ready, addToCart, setQty, cartLines, totals, loadCart, productCard, renderChrome };
})();
