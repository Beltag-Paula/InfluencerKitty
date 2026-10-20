'use strict';
(async function () {
  const { $, api } = Kitty;
  await Kitty.ready;
  const params = new URLSearchParams(location.search);
  const next = Kitty.safeNext(params.get('next'));
  const go = user => { location.href = next || (user.role === 'admin' ? '/admin.html' : '/account.html'); };
  if (Kitty.state.user) { go(Kitty.state.user); return; }

  function tab(which) {
    const signup = which === 'signup';
    $('#login-form').hidden = signup; $('#signup-form').hidden = !signup;
    $('#tab-login').classList.toggle('active', !signup); $('#tab-signup').classList.toggle('active', signup);
    $('#tab-login').setAttribute('aria-selected', String(!signup)); $('#tab-signup').setAttribute('aria-selected', String(signup));
  }
  $('#tab-login').addEventListener('click', () => tab('login'));
  $('#tab-signup').addEventListener('click', () => tab('signup'));
  tab(params.get('tab') === 'signup' ? 'signup' : 'login');

  async function submit(form, errBox, path, body) {
    errBox.textContent = '';
    const btn = $('button[type=submit]', form); btn.disabled = true;
    try {
      const { user } = await api(path, { method: 'POST', body });
      Kitty.state.user = user;
      await Kitty.loadCart(); // merges the guest cart into the account
      go(user);
    } catch (e) { errBox.textContent = e.message; btn.disabled = false; }
  }
  $('#login-form').addEventListener('submit', e => {
    e.preventDefault();
    submit(e.target, $('#login-error'), '/auth/login', { email: $('#l-email').value, password: $('#l-pass').value });
  });
  $('#signup-form').addEventListener('submit', e => {
    e.preventDefault();
    if ($('#s-pass').value.length < 8) { $('#signup-error').textContent = 'Password must be at least 8 characters.'; return; }
    submit(e.target, $('#signup-error'), '/auth/signup', { name: $('#s-name').value, email: $('#s-email').value, password: $('#s-pass').value });
  });
})();
