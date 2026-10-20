'use strict';
/**
 * Kitty Ecommerce - backend
 * Zero dependencies: only Node's built-in modules. Run with:  node server.js
 * Data is stored in data/db.json (created and seeded on first start).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const UPLOADS = path.join(PUBLIC, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true'; // set to true when served over HTTPS
const SESSION_DAYS = 7;

const CONFIG = { currency: '$', shippingCents: 499, freeShippingOverCents: 5000 };
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const PAYMENT_METHODS = ['card', 'paypal', 'cod'];

/* ------------------------------------------------------------------ */
/* Tiny JSON database                                                  */
/* ------------------------------------------------------------------ */
let db;
const uid = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE); // atomic replace so a crash can't corrupt the file
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}
function verifyPassword(pw, stored) {
  const [s, h] = String(stored).split(':');
  if (!s || !h) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  const known = Buffer.from(h, 'hex');
  return known.length === hash.length && crypto.timingSafeEqual(hash, known);
}

function seed() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@kitty.local').toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  db.users.push({ id: uid(), name: 'Shop Admin', email: adminEmail, passwordHash: hashPassword(adminPass), role: 'admin', createdAt: now() });
  const img = n => `/assets/images/products/${n}.svg`;
  const items = [
    ['Crunchy Bites Dry Cat Food 2kg', 'Food', 1899, 15, 40, 'dry-food', 4.8, true, 'Complete crunchy kibble with chicken and salmon. Supports healthy digestion and a shiny coat.'],
    ['Tuna Treats Pouch', 'Food', 499, 0, 120, 'treats', 4.7, false, 'Soft, bite-sized tuna treats. Perfect for training or just saying "good kitty".'],
    ['Wet Food Cans (Pack of 6)', 'Food', 1299, 20, 60, 'wet-food', 4.5, true, 'Tender pieces in gravy, in fish and beef flavours. No artificial colours.'],
    ['Feather Wand Teaser', 'Toys', 799, 0, 80, 'feather-wand', 4.9, true, 'A 90cm wand with colourful feathers and a jingle bell. Wakes up the hunter in every cat.'],
    ['Squeaky Toy Mouse', 'Toys', 399, 10, 150, 'toy-mouse', 4.4, false, 'Soft plush mouse with a squeaker and a long tail made for pouncing.'],
    ['Catnip Fish Plush', 'Toys', 649, 0, 90, 'catnip-fish', 4.6, false, 'Filled with organic catnip. Great for kicking, cuddling and chewing.'],
    ['Cozy Round Cat Bed', 'Beds & Trees', 3499, 25, 25, 'cat-bed', 4.9, true, 'A deep, plush donut bed with a raised rim for head-resting and a washable cover.'],
    ['Tall Cat Tree with Hideout', 'Beds & Trees', 8999, 30, 10, 'cat-tree', 4.8, true, 'Sisal-wrapped post, cosy hideout and two lounging platforms. Sturdy for climbers and nappers.'],
    ['Cardboard Lounge Scratcher', 'Beds & Trees', 1599, 0, 55, 'scratcher', 4.5, false, 'A curved corrugated scratcher that doubles as a lounge. Includes catnip.'],
    ['Hooded Litter Box', 'Litter & Care', 3299, 0, 30, 'litter-box', 4.3, false, 'Keeps litter and smells inside. Easy-clean base and a carbon filter in the lid.'],
    ['Ceramic-Look Water Fountain', 'Litter & Care', 2799, 15, 35, 'fountain', 4.6, false, 'Flowing water encourages cats to drink more. Quiet pump and replaceable filter.'],
    ['Slicker Grooming Brush', 'Litter & Care', 999, 0, 70, 'brush', 4.7, false, 'Gentle pins remove loose fur and tangles. Self-cleaning button for fast cleanup.'],
    ['Safety Collar with Bell', 'Collars & Travel', 849, 0, 100, 'collar', 4.5, false, 'Adjustable collar with a quick-release safety buckle and a bell.'],
    ['Soft-Sided Cat Carrier', 'Collars & Travel', 4499, 10, 20, 'carrier', 4.7, true, 'Ventilated carrier with a secure front door, top handle and padded base.']
  ];
  items.forEach(([name, category, priceCents, discountPercent, stock, image, rating, featured, description], i) => {
    db.products.push({ id: uid(), name, category, description, priceCents, discountPercent, stock, images: [img(image)], rating, featured, createdAt: new Date(Date.now() - i * 3600e3).toISOString() });
  });
}

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return;
  }
  db = { users: [], products: [], orders: [], carts: {}, sessions: [], orderSeq: 1000 };
  seed();
  saveDb();
  console.log('Created data/db.json with sample products.');
  console.log(`Admin login: ${db.users[0].email} / ${process.env.ADMIN_PASSWORD || 'admin123'}  (change this - see README)`);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (msg, status = 400) => new HttpError(status, msg);

const finalCents = p => Math.round(p.priceCents * (100 - (p.discountPercent || 0)) / 100);
const publicProduct = p => ({ id: p.id, name: p.name, description: p.description, category: p.category, priceCents: p.priceCents, discountPercent: p.discountPercent || 0, finalCents: finalCents(p), stock: p.stock, images: p.images, rating: p.rating || 0, featured: !!p.featured, createdAt: p.createdAt });
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt });
const shippingFor = subtotal => (subtotal === 0 || subtotal >= CONFIG.freeShippingOverCents ? 0 : CONFIG.shippingCents);

function cleanStr(v, max, { required = false, field = 'Field' } = {}) {
  const s = typeof v === 'string' ? v.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') : '';
  if (required && !s) throw bad(`${field} is required.`);
  if (s.length > max) throw bad(`${field} must be at most ${max} characters.`);
  return s;
}
const isEmail = e => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e);

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function getUser(req) {
  const token = parseCookies(req).kitty_sid;
  if (!token) return null;
  const h = sha(token);
  const s = db.sessions.find(x => x.tokenHash === h);
  if (!s || s.expires < Date.now()) return null;
  return db.users.find(u => u.id === s.userId) || null;
}
function startSession(res, user) {
  db.sessions = db.sessions.filter(s => s.expires > Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions.push({ tokenHash: sha(token), userId: user.id, expires: Date.now() + SESSION_DAYS * 864e5 });
  saveDb();
  res.setHeader('Set-Cookie', `kitty_sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${COOKIE_SECURE ? '; Secure' : ''}`);
}

// very small login rate limiter (per IP)
const attempts = new Map();
function checkRate(ip) {
  const a = attempts.get(ip);
  if (a && a.reset > Date.now() && a.count >= 10) throw bad('Too many attempts. Please wait a few minutes and try again.', 429);
}
function noteFail(ip) {
  const a = attempts.get(ip);
  if (!a || a.reset < Date.now()) attempts.set(ip, { count: 1, reset: Date.now() + 15 * 60e3 });
  else a.count++;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(bad('Request is too large.', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('Invalid JSON.')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */
const routes = [];
const route = (method, pattern, opts, handler) => {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, opts, handler });
};

route('GET', '/api/config', () => CONFIG);

/* ---- auth ---- */
route('POST', '/api/auth/signup', ({ body, res, ip }) => {
  checkRate(ip);
  const name = cleanStr(body.name, 60, { required: true, field: 'Name' });
  const email = cleanStr(body.email, 200, { required: true, field: 'Email' }).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!isEmail(email)) throw bad('Please enter a valid email address.');
  if (password.length < 8 || password.length > 100) throw bad('Password must be 8 to 100 characters.');
  if (db.users.some(u => u.email === email)) throw bad('An account with this email already exists.', 409);
  const user = { id: uid(), name, email, passwordHash: hashPassword(password), role: 'customer', createdAt: now() };
  db.users.push(user);
  startSession(res, user);
  return { user: publicUser(user) };
});

route('POST', '/api/auth/login', ({ body, res, ip }) => {
  checkRate(ip);
  const email = cleanStr(body.email, 200).toLowerCase();
  const user = db.users.find(u => u.email === email);
  const ok = user && verifyPassword(typeof body.password === 'string' ? body.password : '', user.passwordHash);
  if (!ok) { noteFail(ip); throw bad('Wrong email or password.', 401); }
  startSession(res, user);
  return { user: publicUser(user) };
});

route('POST', '/api/auth/logout', ({ req, res }) => {
  const token = parseCookies(req).kitty_sid;
  if (token) { const h = sha(token); db.sessions = db.sessions.filter(s => s.tokenHash !== h); saveDb(); }
  res.setHeader('Set-Cookie', 'kitty_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return { ok: true };
});

route('GET', '/api/auth/me', ({ user }) => ({ user: user ? publicUser(user) : null }));

/* ---- products (public) ---- */
route('GET', '/api/products', ({ query }) => {
  let list = db.products.slice();
  if (query.ids) { const ids = query.ids.split(',').slice(0, 100); list = list.filter(p => ids.includes(p.id)); }
  if (query.category) list = list.filter(p => p.category === query.category);
  if (query.q) { const q = query.q.toLowerCase(); list = list.filter(p => (p.name + ' ' + p.category + ' ' + p.description).toLowerCase().includes(q)); }
  if (query.sale === '1') list = list.filter(p => p.discountPercent > 0);
  if (query.featured === '1') list = list.filter(p => p.featured);
  const sorters = {
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    'price-asc': (a, b) => finalCents(a) - finalCents(b),
    'price-desc': (a, b) => finalCents(b) - finalCents(a),
    discount: (a, b) => b.discountPercent - a.discountPercent,
    rating: (a, b) => b.rating - a.rating
  };
  list.sort(sorters[query.sort] || sorters.newest);
  return { products: list.map(publicProduct) };
});

route('GET', '/api/products/:id', ({ params }) => {
  const p = db.products.find(x => x.id === params.id);
  if (!p) throw bad('Product not found.', 404);
  return { product: publicProduct(p) };
});

route('GET', '/api/categories', () => {
  const map = new Map();
  for (const p of db.products) {
    const c = map.get(p.category) || { name: p.category, count: 0, image: p.images[0] || '' };
    c.count++; map.set(p.category, c);
  }
  return { categories: [...map.values()] };
});

/* ---- cart (logged-in users; guests keep theirs in localStorage) ---- */
route('GET', '/api/cart', { auth: 'user' }, ({ user }) => ({ items: (db.carts[user.id] || []).filter(i => db.products.some(p => p.id === i.productId)) }));
route('PUT', '/api/cart', { auth: 'user' }, ({ user, body }) => {
  if (!Array.isArray(body.items) || body.items.length > 100) throw bad('Invalid cart.');
  const items = [];
  for (const i of body.items) {
    const p = db.products.find(x => x.id === i.productId);
    const qty = Math.floor(Number(i.qty));
    if (!p || !(qty >= 1)) continue;
    items.push({ productId: p.id, qty: Math.min(qty, 99, Math.max(p.stock, 1)) });
  }
  db.carts[user.id] = items;
  saveDb();
  return { items };
});

/* ---- orders ---- */
function validatePayment(body) {
  if (!PAYMENT_METHODS.includes(body.paymentMethod)) throw bad('Please choose a payment method.');
  return body.paymentMethod;
}

route('POST', '/api/orders', { auth: 'user' }, ({ user, body }) => {
  const s = body.shipping || {};
  const shipping = {
    fullName: cleanStr(s.fullName, 80, { required: true, field: 'Full name' }),
    phone: cleanStr(s.phone, 30, { required: true, field: 'Phone' }),
    address: cleanStr(s.address, 150, { required: true, field: 'Address' }),
    city: cleanStr(s.city, 60, { required: true, field: 'City' }),
    zip: cleanStr(s.zip, 20, { required: true, field: 'Postal code' }),
    country: cleanStr(s.country, 60, { required: true, field: 'Country' })
  };
  const paymentMethod = validatePayment(body);
  const cart = db.carts[user.id] || [];
  if (!cart.length) throw bad('Your cart is empty.');

  // Prices and stock are always re-checked on the server.
  const lines = [];
  for (const i of cart) {
    const p = db.products.find(x => x.id === i.productId);
    if (!p) throw bad('A product in your cart is no longer available. Please review your cart.');
    if (p.stock < i.qty) throw bad(`Only ${p.stock} left of "${p.name}". Please update your cart.`, 409);
    lines.push({ p, qty: i.qty });
  }
  const items = lines.map(({ p, qty }) => ({ productId: p.id, name: p.name, image: p.images[0] || '', unitCents: finalCents(p), qty }));
  const subtotalCents = items.reduce((t, i) => t + i.unitCents * i.qty, 0);
  const shippingCents = shippingFor(subtotalCents);
  lines.forEach(({ p, qty }) => { p.stock -= qty; });

  const order = {
    id: uid(), number: 'KT-' + (++db.orderSeq), userId: user.id, userName: user.name, userEmail: user.email,
    items, subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents, shipping, paymentMethod,
    // Demo only: no real payment is processed. Card/PayPal are marked "paid (demo)".
    paymentStatus: paymentMethod === 'cod' ? 'pay on delivery' : 'paid (demo)',
    status: 'pending', createdAt: now()
  };
  db.orders.push(order);
  db.carts[user.id] = [];
  saveDb();
  return { order };
});

route('GET', '/api/orders', { auth: 'user' }, ({ user }) => ({ orders: db.orders.filter(o => o.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }));

/* ---- admin ---- */
function parseProduct(b) {
  const name = cleanStr(b.name, 120, { required: true, field: 'Name' });
  const category = cleanStr(b.category, 40, { required: true, field: 'Category' });
  const description = cleanStr(b.description, 2000);
  const priceCents = Number(b.priceCents), discountPercent = Number(b.discountPercent || 0), stock = Number(b.stock);
  if (!Number.isInteger(priceCents) || priceCents < 1 || priceCents > 10000000) throw bad('Price must be between 0.01 and 100000.');
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 90) throw bad('Discount must be a whole number from 0 to 90.');
  if (!Number.isInteger(stock) || stock < 0 || stock > 100000) throw bad('Stock must be a whole number of 0 or more.');
  const images = (Array.isArray(b.images) ? b.images : []).slice(0, 8).map(u => String(u).trim()).filter(Boolean);
  for (const u of images) if (!/^(\/(uploads|assets)\/[\w\-./]+|https:\/\/[^\s"'<>]+)$/.test(u) || u.includes('..')) throw bad('Image links must be uploaded images or https:// URLs.');
  return { name, category, description, priceCents, discountPercent, stock, images, featured: !!b.featured };
}

route('GET', '/api/admin/stats', { auth: 'admin' }, () => {
  const live = db.orders.filter(o => o.status !== 'cancelled');
  const days = [];
  for (let d = 6; d >= 0; d--) {
    const day = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
    days.push({ day, totalCents: live.filter(o => o.createdAt.startsWith(day)).reduce((t, o) => t + o.totalCents, 0) });
  }
  return {
    revenueCents: live.reduce((t, o) => t + o.totalCents, 0),
    orders: db.orders.length,
    pendingOrders: db.orders.filter(o => o.status === 'pending').length,
    products: db.products.length,
    customers: db.users.filter(u => u.role === 'customer').length,
    lowStock: db.products.filter(p => p.stock <= 5).map(publicProduct),
    recentOrders: db.orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    days
  };
});

route('POST', '/api/admin/products', { auth: 'admin' }, ({ body }) => {
  const p = { id: uid(), rating: 0, createdAt: now(), ...parseProduct(body) };
  db.products.push(p); saveDb();
  return { product: publicProduct(p) };
});
route('PUT', '/api/admin/products/:id', { auth: 'admin' }, ({ params, body }) => {
  const p = db.products.find(x => x.id === params.id);
  if (!p) throw bad('Product not found.', 404);
  Object.assign(p, parseProduct(body)); saveDb();
  return { product: publicProduct(p) };
});
route('DELETE', '/api/admin/products/:id', { auth: 'admin' }, ({ params }) => {
  const i = db.products.findIndex(x => x.id === params.id);
  if (i < 0) throw bad('Product not found.', 404);
  const [gone] = db.products.splice(i, 1);
  // remove the image files we uploaded for it
  gone.images.filter(u => u.startsWith('/uploads/')).forEach(u => fs.unlink(path.join(UPLOADS, path.basename(u)), () => {}));
  saveDb();
  return { ok: true };
});

const MAGIC = [['png', b => b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))], ['jpg', b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff], ['gif', b => b.slice(0, 4).toString() === 'GIF8'], ['webp', b => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP']];
route('POST', '/api/admin/upload', { auth: 'admin', bodyLimit: 6 * 1024 * 1024 }, ({ body }) => {
  const m = /^data:image\/(?:png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ''));
  if (!m) throw bad('Please upload a PNG, JPG, GIF or WebP image.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 4 * 1024 * 1024) throw bad('Image must be smaller than 4 MB.', 413);
  const type = MAGIC.find(([, test]) => test(buf));
  if (!type) throw bad('That file is not a valid image.');
  const file = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${type[0]}`;
  fs.writeFileSync(path.join(UPLOADS, file), buf);
  return { url: '/uploads/' + file };
});

route('GET', '/api/admin/orders', { auth: 'admin' }, () => ({ orders: db.orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }));
route('PUT', '/api/admin/orders/:id', { auth: 'admin' }, ({ params, body }) => {
  const o = db.orders.find(x => x.id === params.id);
  if (!o) throw bad('Order not found.', 404);
  if (!ORDER_STATUSES.includes(body.status)) throw bad('Unknown status.');
  if (body.status === 'cancelled' && o.status !== 'cancelled') {
    o.items.forEach(i => { const p = db.products.find(x => x.id === i.productId); if (p) p.stock += i.qty; }); // put stock back
  } else if (o.status === 'cancelled' && body.status !== 'cancelled') {
    for (const i of o.items) { const p = db.products.find(x => x.id === i.productId); if (p && p.stock < i.qty) throw bad(`Not enough stock of "${i.name}" to re-open this order.`, 409); }
    o.items.forEach(i => { const p = db.products.find(x => x.id === i.productId); if (p) p.stock -= i.qty; });
  }
  o.status = body.status;
  if (body.status === 'delivered' && o.paymentMethod === 'cod') o.paymentStatus = 'paid';
  saveDb();
  return { order: o };
});
route('GET', '/api/admin/users', { auth: 'admin' }, () => ({
  users: db.users.map(u => ({ ...publicUser(u), orders: db.orders.filter(o => o.userId === u.id).length }))
}));

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || path.basename(file).startsWith('.')) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    const headers = { ...SECURITY_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' };
    // uploaded files must never be rendered as active content
    if (file.startsWith(UPLOADS + path.sep)) headers['Content-Security-Policy'] = "default-src 'none'; sandbox";
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

async function handleApi(req, res, url) {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const match = routes.map(r => ({ r, m: r.re.exec(pathname) })).find(x => x.m && x.r.method === req.method);
  if (!match) {
    if (routes.some(r => r.re.test(pathname))) throw bad('Method not allowed.', 405);
    throw bad('Not found.', 404);
  }
  const { r, m } = match;
  if (!['GET', 'HEAD'].includes(req.method)) {
    // CSRF defence: only same-origin JSON requests are accepted
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) throw bad('Content-Type must be application/json.', 415);
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) throw bad('Cross-origin request blocked.', 403);
  }
  const user = getUser(req);
  if (r.opts.auth && !user) throw bad('Please log in first.', 401);
  if (r.opts.auth === 'admin' && user.role !== 'admin') throw bad('Admins only.', 403);
  const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req, r.opts.bodyLimit || 100 * 1024) : {};
  const query = Object.fromEntries(url.searchParams);
  const result = await r.handler({ req, res, params, body, query, user, ip: req.socket.remoteAddress });
  if (!res.headersSent) send(res, 200, result, SECURITY_HEADERS);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      try { await handleApi(req, res, url); }
      catch (e) {
        if (e instanceof HttpError) return send(res, e.status, { error: e.message }, SECURITY_HEADERS);
        console.error(e); return send(res, 500, { error: 'Something went wrong on our side.' }, SECURITY_HEADERS);
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e); res.writeHead(400); res.end('Bad request');
  }
});

loadDb();
server.listen(PORT, () => console.log(`Kitty Ecommerce running at http://localhost:${PORT}`));
