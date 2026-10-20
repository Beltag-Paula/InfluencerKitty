'use strict';
(async function () {
  const { $, $$, esc, money, api, productCard } = Kitty;
  await Kitty.ready;

  /* ---- hero slider ---- */
  const slides = $$('.slide');
  const dots = $('#hero-dots');
  let current = 0, timer;
  slides.forEach((_, i) => {
    const b = document.createElement('button');
    b.setAttribute('aria-label', 'Show slide ' + (i + 1));
    b.addEventListener('click', () => { show(i); restart(); });
    dots.appendChild(b);
  });
  function show(i) {
    current = (i + slides.length) % slides.length;
    slides.forEach((s, n) => s.classList.toggle('active', n === current));
    $$('button', dots).forEach((d, n) => d.classList.toggle('active', n === current));
  }
  function restart() {
    clearInterval(timer);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => show(current + 1), 6000);
  }
  show(0); restart();

  /* ---- filters come from the address bar so links like /?category=Toys work ---- */
  const params = new URLSearchParams(location.search);
  const filters = { q: params.get('q') || '', category: params.get('category') || '', sale: params.get('sale') === '1', sort: params.get('sort') || 'newest' };
  $('#sort').value = filters.sort;

  let categories = [];
  try { categories = (await api('/categories')).categories; } catch (e) { Kitty.toast(e.message, 'err'); }

  function drawCategories() {
    $('#categories').innerHTML = categories.map(c => `
      <a class="cat-tile ${filters.category === c.name ? 'active' : ''}" href="/?category=${encodeURIComponent(c.name)}#shop" data-cat="${esc(c.name)}">
        <img src="${esc(c.image)}" alt=""><div><strong>${esc(c.name)}</strong><span>${c.count} item${c.count === 1 ? '' : 's'}</span></div></a>`).join('');
    const chip = (label, active, attrs) => `<button class="chip ${active ? 'active' : ''}" ${attrs}>${esc(label)}</button>`;
    $('#chips').innerHTML = chip('All', !filters.category && !filters.sale, 'data-chip=""') +
      categories.map(c => chip(c.name, filters.category === c.name, `data-chip="${esc(c.name)}"`)).join('') +
      chip('On sale', filters.sale, 'data-sale="1"');
  }

  async function loadProducts() {
    const qs = new URLSearchParams();
    if (filters.q) qs.set('q', filters.q);
    if (filters.category) qs.set('category', filters.category);
    if (filters.sale) qs.set('sale', '1');
    qs.set('sort', filters.sort);
    const grid = $('#products');
    try {
      const { products } = await api('/products?' + qs);
      $('#shop-title').textContent = filters.q ? `Results for "${filters.q}"` : filters.sale ? 'On sale' : filters.category || 'All products';
      $('#result-count').textContent = products.length + ' product' + (products.length === 1 ? '' : 's');
      grid.innerHTML = products.length ? products.map(productCard).join('')
        : `<div class="empty"><img src="/assets/images/logo/logo-cat.svg" alt=""><p>No products match that. Try another search or <a href="/" style="text-decoration:underline">see everything</a>.</p></div>`;
    } catch (e) { grid.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  }

  function filterChanged() {
    const qs = new URLSearchParams();
    if (filters.q) qs.set('q', filters.q);
    if (filters.category) qs.set('category', filters.category);
    if (filters.sale) qs.set('sale', '1');
    if (filters.sort !== 'newest') qs.set('sort', filters.sort);
    history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + '#shop');
    drawCategories(); loadProducts();
  }

  $('#chips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    filters.q = ''; filters.sale = 'sale' in b.dataset; filters.category = b.dataset.chip || '';
    filterChanged();
  });
  $('#categories').addEventListener('click', e => {
    const a = e.target.closest('[data-cat]'); if (!a) return;
    e.preventDefault(); filters.q = ''; filters.sale = false; filters.category = a.dataset.cat; filterChanged();
    $('#shop').scrollIntoView();
  });
  $('#sort').addEventListener('change', e => { filters.sort = e.target.value; filterChanged(); });

  drawCategories();
  await loadProducts();

  /* ---- deal of the day: the product with the biggest discount that is in stock ---- */
  try {
    const { products } = await api('/products?sort=discount');
    const deal = products.find(p => p.discountPercent > 0 && p.stock > 0);
    if (deal) {
      const sec = $('#deal-section');
      sec.hidden = false;
      const left = Math.min(100, Math.round(deal.stock / 50 * 100));
      sec.innerHTML = `<div class="deal">
        <img src="${esc(deal.images[0])}" alt="${esc(deal.name)}">
        <div><span class="eyebrow">Biggest discount right now: ${deal.discountPercent}% off</span>
          <h2>${esc(deal.name)}</h2><p>${esc(deal.description.slice(0, 140))}</p>
          <div class="price"><strong>${money(deal.finalCents)}</strong><del>${money(deal.priceCents)}</del></div>
          <div class="stock-bar" aria-hidden="true"><i style="width:${left}%"></i></div>
          <p>${deal.stock} left in stock</p>
          <button class="btn" data-add-to-cart="${esc(deal.id)}">Add to cart</button></div></div>`;
    }
  } catch { /* the deal is optional */ }
})();
