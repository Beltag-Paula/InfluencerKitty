'use strict';
(async function () {
  const { $, esc, money, dateStr, api } = Kitty;
  await Kitty.ready;
  const root = $('#account-root');
  const user = Kitty.state.user;
  if (!user) { location.href = '/login.html?next=/account.html'; return; }
  let orders = [];
  try { orders = (await api('/orders')).orders; } catch (e) { Kitty.toast(e.message, 'err'); }

  root.innerHTML = `
    <div class="section-head"><h1>Hi ${esc(user.name.split(' ')[0])}!</h1>
      <div>${user.role === 'admin' ? '<a class="btn btn-sm btn-dark" href="/admin.html">Admin dashboard</a> ' : ''}<button class="btn btn-sm btn-ghost" data-logout>Log out</button></div></div>
    <p class="muted">${esc(user.email)} &middot; member since ${dateStr(user.createdAt)}</p>
    <h2 style="margin-top:28px">Your orders</h2>
    ${orders.length ? orders.map(o => `<article class="panel order">
      <div class="order-head"><div><strong>${esc(o.number)}</strong> <span class="muted">${dateStr(o.createdAt)}</span></div>
        <div><span class="status ${esc(o.status)}">${esc(o.status)}</span> <span class="muted">${esc(o.paymentStatus)}</span></div></div>
      <ul class="order-items">${o.items.map(i => `<li><img src="${esc(i.image)}" alt=""><span>${esc(i.name)} &times; ${i.qty}</span><span>${money(i.unitCents * i.qty)}</span></li>`).join('')}</ul>
      <div class="sum-row"><span class="muted">Shipping</span><span>${o.shippingCents ? money(o.shippingCents) : 'Free'}</span></div>
      <div class="sum-row"><strong>Total</strong><strong>${money(o.totalCents)}</strong></div>
      <p class="muted" style="margin:8px 0 0;font-size:.9rem">Ships to ${esc(o.shipping.fullName)}, ${esc(o.shipping.address)}, ${esc(o.shipping.zip)} ${esc(o.shipping.city)}, ${esc(o.shipping.country)}</p>
    </article>`).join('') : `<div class="empty"><img src="/assets/images/logo/logo-cat.svg" alt=""><p>No orders yet.</p><a class="btn" href="/">Find something for your cat</a></div>`}`;
})();
