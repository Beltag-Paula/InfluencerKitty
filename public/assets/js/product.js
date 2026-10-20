'use strict';
(async function () {
  const { $, $$, esc, money, api, stars, productCard } = Kitty;
  await Kitty.ready;
  const root = $('#product-root');
  const id = new URLSearchParams(location.search).get('id');
  let product;
  try { product = (await api('/products/' + encodeURIComponent(id))).product; }
  catch { root.innerHTML = '<div class="empty"><img src="/assets/images/logo/logo-cat.svg" alt=""><p>We could not find that product. <a href="/" style="text-decoration:underline">Back to the shop</a></p></div>'; return; }

  document.title = product.name + ' - Kitty';
  let qty = 1;
  const out = product.stock < 1;
  const imgs = product.images.length ? product.images : ['/assets/images/logo/logo-cat.svg'];

  root.innerHTML = `
    <p class="crumbs"><a href="/">Home</a> / <a href="/?category=${encodeURIComponent(product.category)}#shop">${esc(product.category)}</a> / ${esc(product.name)}</p>
    <div class="product">
      <div>
        <div class="gallery-main"><img id="main-img" src="${esc(imgs[0])}" alt="${esc(product.name)}"></div>
        ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, i) => `<button type="button" class="${i ? '' : 'active'}" data-img="${esc(u)}" aria-label="Show image ${i + 1}"><img src="${esc(u)}" alt=""></button>`).join('')}</div>` : ''}
      </div>
      <div class="product-info">
        <span class="card-cat">${esc(product.category)}</span>
        <h1>${esc(product.name)}</h1>
        ${product.rating ? stars(product.rating) + ` <span class="muted">${product.rating.toFixed(1)}</span>` : ''}
        <div class="price"><strong>${money(product.finalCents)}</strong>${product.discountPercent ? `<del>${money(product.priceCents)}</del> <span class="badge sale" style="position:static">-${product.discountPercent}%</span>` : ''}</div>
        <p>${esc(product.description).replace(/\n/g, '<br>')}</p>
        <p class="stock-note ${out ? 'low' : product.stock <= 5 ? 'low' : 'ok'}">${out ? 'Sold out' : product.stock <= 5 ? 'Only ' + product.stock + ' left' : 'In stock'}</p>
        <div class="buy-row">
          <div class="qty" ${out ? 'hidden' : ''}><button type="button" id="minus" aria-label="Less">-</button><span id="qty" aria-live="polite">1</span><button type="button" id="plus" aria-label="More">+</button></div>
          <button class="btn" id="add" ${out ? 'disabled' : ''}>${out ? 'Sold out' : 'Add to cart'}</button>
        </div>
      </div>
    </div>
    <section class="section" id="related" hidden><div class="section-head"><h2>More in ${esc(product.category)}</h2></div><div class="grid" id="related-grid"></div></section>`;

  root.addEventListener('click', e => {
    const t = e.target.closest('[data-img]');
    if (t) { $('#main-img').src = t.dataset.img; $$('.thumbs button').forEach(b => b.classList.toggle('active', b === t)); }
  });
  const draw = () => { $('#qty').textContent = qty; };
  $('#minus').addEventListener('click', () => { qty = Math.max(1, qty - 1); draw(); });
  $('#plus').addEventListener('click', () => { qty = Math.min(product.stock, 99, qty + 1); draw(); });
  $('#add').addEventListener('click', async () => {
    try { await Kitty.addToCart(product.id, qty); Kitty.toast(`${qty} added to your cart`); }
    catch (e) { Kitty.toast(e.message, 'err'); }
  });

  try {
    const { products } = await api('/products?category=' + encodeURIComponent(product.category));
    const rel = products.filter(p => p.id !== product.id).slice(0, 4);
    if (rel.length) { $('#related').hidden = false; $('#related-grid').innerHTML = rel.map(productCard).join(''); }
  } catch { /* related items are optional */ }
})();
