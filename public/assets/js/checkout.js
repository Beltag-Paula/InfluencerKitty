'use strict';
/*
 * Checkout. The payment section is FRONT END ONLY (a demo):
 *  - card details are checked in the browser (format + Luhn) and are NEVER sent to the server
 *  - only the chosen method ("card", "paypal" or "cod") is sent with the order
 * To take real payments, connect a provider such as Stripe Checkout (see README).
 */
(async function () {
  const { $, esc, money, api } = Kitty;
  await Kitty.ready;
  const root = $('#checkout-root');
  const user = Kitty.state.user;
  if (!user) { location.href = '/login.html?next=/checkout.html'; return; }

  const lines = await Kitty.cartLines();
  if (!lines.length) {
    root.innerHTML = `<div class="empty"><img src="/assets/images/logo/logo-cat.svg" alt=""><p>Your cart is empty.</p><a class="btn" href="/">Back to the shop</a></div>`;
    return;
  }
  const t = Kitty.totals(lines);

  root.innerHTML = `<h1>Checkout</h1>
  <form id="checkout-form" class="two-col" novalidate>
    <div>
      <section class="panel" style="margin-bottom:20px">
        <h2>Delivery details</h2>
        <div class="field"><label for="fullName">Full name</label><input id="fullName" type="text" autocomplete="name" value="${esc(user.name)}" required></div>
        <div class="field-row">
          <div class="field"><label for="phone">Phone</label><input id="phone" type="tel" autocomplete="tel" required></div>
          <div class="field"><label for="country">Country</label><input id="country" type="text" autocomplete="country-name" required></div>
        </div>
        <div class="field"><label for="address">Street address</label><input id="address" type="text" autocomplete="street-address" required></div>
        <div class="field-row keep">
          <div class="field"><label for="city">City</label><input id="city" type="text" autocomplete="address-level2" required></div>
          <div class="field"><label for="zip">Postal code</label><input id="zip" type="text" autocomplete="postal-code" required></div>
        </div>
      </section>
      <section class="panel">
        <h2>Payment method</h2>
        <p class="demo-note"><strong>Demo checkout.</strong> No real payment is taken and card details never leave your browser.</p>
        <label class="pay-option"><input type="radio" name="pay" value="card" checked><span>Credit or debit card<small>Visa, Mastercard and more</small></span></label>
        <div class="pay-detail" id="pay-card">
          <div class="field"><label for="cc-name">Name on card</label><input id="cc-name" type="text" autocomplete="cc-name"></div>
          <div class="field"><label for="cc-number">Card number</label><input id="cc-number" type="text" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" maxlength="23"></div>
          <div class="field-row keep">
            <div class="field"><label for="cc-exp">Expiry (MM/YY)</label><input id="cc-exp" type="text" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" maxlength="5"></div>
            <div class="field"><label for="cc-cvc">CVC</label><input id="cc-cvc" type="text" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4"></div>
          </div>
        </div>
        <label class="pay-option"><input type="radio" name="pay" value="paypal"><span>PayPal<small>You would be sent to PayPal to approve the payment (demo)</small></span></label>
        <label class="pay-option"><input type="radio" name="pay" value="cod"><span>Cash on delivery<small>Pay the courier when your order arrives</small></span></label>
      </section>
    </div>
    <aside class="panel sticky">
      <h2>Your order</h2>
      ${lines.map(l => `<div class="sum-row"><span>${esc(l.product.name)} &times; ${l.qty}</span><span>${money(l.product.finalCents * l.qty)}</span></div>`).join('')}
      <div class="sum-row" style="margin-top:8px"><span>Shipping</span><span>${t.shipping ? money(t.shipping) : 'Free'}</span></div>
      <div class="sum-row total"><span>Total</span><span>${money(t.total)}</span></div>
      <div class="form-error" id="co-error" role="alert" style="margin-top:14px"></div>
      <button class="btn btn-block" type="submit" id="place">Place order</button>
    </aside>
  </form>`;

  /* ---- card input helpers ---- */
  const digits = s => s.replace(/\D/g, '');
  $('#cc-number').addEventListener('input', e => { e.target.value = digits(e.target.value).slice(0, 19).replace(/(.{4})/g, '$1 ').trim(); });
  $('#cc-exp').addEventListener('input', e => {
    const d = digits(e.target.value).slice(0, 4);
    e.target.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
  });
  $('#cc-cvc').addEventListener('input', e => { e.target.value = digits(e.target.value).slice(0, 4); });

  const luhn = num => { // standard card-number checksum
    let sum = 0, alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let n = Number(num[i]);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return num.length >= 13 && sum % 10 === 0;
  };
  function cardError() {
    if (!$('#cc-name').value.trim()) return 'Please enter the name on the card.';
    if (!luhn(digits($('#cc-number').value))) return 'That card number does not look right.';
    const m = /^(\d{2})\/(\d{2})$/.exec($('#cc-exp').value);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return 'Enter the expiry date as MM/YY.';
    const expires = new Date(2000 + Number(m[2]), Number(m[1]), 1); // first day of the month after expiry
    if (expires <= new Date()) return 'That card has expired.';
    if (!/^\d{3,4}$/.test($('#cc-cvc').value)) return 'Enter the 3 or 4 digit security code.';
    return '';
  }

  const method = () => $('input[name=pay]:checked').value;
  root.addEventListener('change', e => { if (e.target.name === 'pay') $('#pay-card').hidden = method() !== 'card'; });

  $('#checkout-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#co-error'); err.textContent = '';
    const shipping = {};
    for (const k of ['fullName', 'phone', 'country', 'address', 'city', 'zip']) {
      shipping[k] = $('#' + k).value.trim();
      if (!shipping[k]) { err.textContent = 'Please fill in all delivery details.'; $('#' + k).focus(); return; }
    }
    if (method() === 'card') { const ce = cardError(); if (ce) { err.textContent = ce; return; } }

    const btn = $('#place'); btn.disabled = true; btn.textContent = 'Placing order...';
    try {
      // NOTE: only the payment *method* is sent - never card details.
      const { order } = await api('/orders', { method: 'POST', body: { shipping, paymentMethod: method() } });
      await Kitty.loadCart(); // the server emptied the cart
      Kitty.renderChrome();
      root.innerHTML = `<div class="success">
        <img src="/assets/images/logo/logo-cat.svg" alt="">
        <h1>Thank you, ${esc(user.name.split(' ')[0])}!</h1>
        <p>Order <strong>${esc(order.number)}</strong> is in. Total ${money(order.totalCents)} (${esc(order.paymentStatus)}).</p>
        <p class="muted">We will get it packed. You can follow its status in your account.</p>
        <a class="btn" href="/account.html">View my orders</a> <a class="btn btn-ghost" href="/">Keep shopping</a></div>`;
      window.scrollTo(0, 0);
    } catch (ex) {
      err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Place order';
      if (ex.status === 401) location.href = '/login.html?next=/checkout.html';
    }
  });
})();
