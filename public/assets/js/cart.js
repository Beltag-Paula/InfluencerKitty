'use strict';
(async function () {
  const { $, esc, money, api } = Kitty;
  await Kitty.ready;
  const root = $('#cart-root');

  async function draw() {
    let lines;
    try { lines = await Kitty.cartLines(); } catch (e) { root.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; return; }
    if (!lines.length) {
      root.innerHTML = `<div class="empty"><img src="/assets/images/logo/logo-cat.svg" alt=""><p>Your cart is empty. Your cat is judging you.</p><a class="btn" href="/">Start shopping</a></div>`;
      return;
    }
    const t = Kitty.totals(lines);
    const toFree = Kitty.state.config.freeShippingOverCents - t.subtotal;
    root.innerHTML = `<div class="two-col">
      <div class="panel">${lines.map(l => {
        const p = l.product, over = l.qty > p.stock;
        return `<div class="cart-line" data-id="${esc(p.id)}">
          <img src="${esc(p.images[0] || '/assets/images/logo/logo-cat.svg')}" alt="">
          <div><h3><a href="/product.html?id=${esc(p.id)}">${esc(p.name)}</a></h3>
            <div class="muted">${money(p.finalCents)} each</div>
            ${over ? `<div style="color:var(--coral);font-weight:700">${p.stock < 1 ? 'Sold out' : 'Only ' + p.stock + ' left'}. Please lower the quantity.</div>` : ''}
            <div class="qty" style="margin:8px 0"><button type="button" data-dec aria-label="Less">-</button><span>${l.qty}</span><button type="button" data-inc aria-label="More">+</button></div>
            <div><button type="button" class="link-btn" data-remove>Remove</button></div></div>
          <div class="line-total">${money(p.finalCents * l.qty)}</div></div>`;
      }).join('')}</div>
      <aside class="panel sticky"><h2>Order summary</h2>
        <div class="sum-row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
        <div class="sum-row"><span>Shipping</span><span>${t.shipping ? money(t.shipping) : 'Free'}</span></div>
        ${toFree > 0 ? `<p class="hint">Add ${money(toFree)} more for free shipping.</p>` : ''}
        <div class="sum-row total"><span>Total</span><span>${money(t.total)}</span></div>
        <button class="btn btn-block" id="go" ${lines.some(l => l.qty > l.product.stock) ? 'disabled' : ''}>Go to checkout</button>
        <p class="hint" style="margin-top:10px">${Kitty.state.user ? '' : 'You will be asked to log in or create an account first.'}</p>
      </aside></div>`;
  }

  root.addEventListener('click', async e => {
    const row = e.target.closest('.cart-line');
    if (row) {
      const id = row.dataset.id, item = Kitty.state.cart.find(i => i.id === id);
      try {
        if (e.target.closest('[data-inc]')) await Kitty.setQty(id, item.qty + 1);
        else if (e.target.closest('[data-dec]')) await Kitty.setQty(id, item.qty - 1);
        else if (e.target.closest('[data-remove]')) await Kitty.setQty(id, 0);
        else return;
        await draw();
      } catch (err) { Kitty.toast(err.message, 'err'); }
    }
    if (e.target.closest('#go')) location.href = Kitty.state.user ? '/checkout.html' : '/login.html?next=/checkout.html';
  });
  draw();
})();
