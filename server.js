'use strict';
/**
 * Kitty Ecommerce - backend
 * Zero dependencies: only Node's built-in modules (needs Node 22.13 or newer for node:sqlite).
 * Run with:  node server.js
 * Data lives in data/kitty.db (SQLite). It is created and seeded on first start.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// node:sqlite still prints an "experimental" notice; hide only that one line.
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w && w.message || w).includes('SQLite') ? undefined : emitWarning.call(process, w, ...a));
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const UPLOADS = path.join(PUBLIC, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'kitty.db');
const OLD_JSON = path.join(DATA_DIR, 'db.json'); // from the first version of the shop
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true'; // set to true when served over HTTPS
const SESSION_DAYS = 7;

const CONFIG = { currency: '$', shippingCents: 499, freeShippingOverCents: 5000 };
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const PAYMENT_METHODS = ['card', 'paypal', 'cod'];

/* ------------------------------------------------------------------ */
/* Database (SQLite)                                                   */
/* ------------------------------------------------------------------ */
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  discount_percent INTEGER NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 90),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  images TEXT NOT NULL DEFAULT '[]', rating REAL NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE TABLE IF NOT EXISTS cart_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL CHECK (qty > 0), PRIMARY KEY (user_id, product_id));
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, user_name TEXT NOT NULL, user_email TEXT NOT NULL,
  items TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, shipping_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
  shipping TEXT NOT NULL, payment_method TEXT NOT NULL, payment_status TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO meta (key, value) VALUES ('orderSeq', '1000');
`);

// run several statements all-or-nothing
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
const q = sql => db.prepare(sql);
const uid = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();

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

/* ---- row <-> object converters ---- */
const toProduct = r => r && ({
  id: r.id, name: r.name, description: r.description, category: r.category,
  priceCents: r.price_cents, discountPercent: r.discount_percent, finalCents: finalCents(r.price_cents, r.discount_percent),
  stock: r.stock, images: JSON.parse(r.images), rating: r.rating, featured: !!r.featured, createdAt: r.created_at
});
const toOrder = r => r && ({
  id: r.id, number: r.number, userId: r.user_id, userName: r.user_name, userEmail: r.user_email, items: JSON.parse(r.items),
  subtotalCents: r.subtotal_cents, shippingCents: r.shipping_cents, totalCents: r.total_cents, shipping: JSON.parse(r.shipping),
  paymentMethod: r.payment_method, paymentStatus: r.payment_status, status: r.status, createdAt: r.created_at
});
const toUser = r => r && ({ id: r.id, name: r.name, email: r.email, role: r.role, createdAt: r.created_at });
function finalCents(priceCents, discountPercent) { return Math.round(priceCents * (100 - (discountPercent || 0)) / 100); }
const shippingFor = subtotal => (subtotal === 0 || subtotal >= CONFIG.freeShippingOverCents ? 0 : CONFIG.shippingCents);

function insertProduct(p, extra = {}) {
  const id = extra.id || uid();
  q(`INSERT INTO products (id, name, category, description, price_cents, discount_percent, stock, images, rating, featured, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, p.name, p.category, p.description, p.priceCents, p.discountPercent, p.stock,
    JSON.stringify(p.images), extra.rating || 0, p.featured ? 1 : 0, extra.createdAt || now());
  return id;
}
function updateProduct(id, p) {
  q(`UPDATE products SET name=?, category=?, description=?, price_cents=?, discount_percent=?, stock=?, images=?, featured=? WHERE id=?`)
    .run(p.name, p.category, p.description, p.priceCents, p.discountPercent, p.stock, JSON.stringify(p.images), p.featured ? 1 : 0, id);
}
const getProduct = id => toProduct(q('SELECT * FROM products WHERE id = ?').get(id));

/* ---- first start: seed sample data, or migrate the old db.json ---- */
function seed() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@kitty.local').toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  q('INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
    .run(uid(), 'Shop Admin', adminEmail, hashPassword(adminPass), 'admin', now());
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
  tx(() => items.forEach(([name, category, priceCents, discountPercent, stock, image, rating, featured, description], i) =>
    insertProduct({ name, category, description, priceCents, discountPercent, stock, images: [img(image)], featured },
      { rating, createdAt: new Date(Date.now() - i * 3600e3).toISOString() })));
  console.log('Created data/kitty.db with sample products.');
  console.log(`Admin login: ${adminEmail} / ${adminPass}  (change this - see README)`);
}

function migrateJson() {
  const old = JSON.parse(fs.readFileSync(OLD_JSON, 'utf8'));
  tx(() => {
    for (const u of old.users || []) q('INSERT OR IGNORE INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)').run(u.id, u.name, u.email, u.passwordHash, u.role, u.createdAt);
    for (const p of old.products || []) q(`INSERT OR IGNORE INTO products (id,name,category,description,price_cents,discount_percent,stock,images,rating,featured,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(p.id, p.name, p.category, p.description || '', p.priceCents, p.discountPercent || 0, p.stock, JSON.stringify(p.images || []), p.rating || 0, p.featured ? 1 : 0, p.createdAt);
    for (const o of old.orders || []) q(`INSERT OR IGNORE INTO orders (id,number,user_id,user_name,user_email,items,subtotal_cents,shipping_cents,total_cents,shipping,payment_method,payment_status,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(o.id, o.number, o.userId, o.userName, o.userEmail, JSON.stringify(o.items), o.subtotalCents, o.shippingCents, o.totalCents, JSON.stringify(o.shipping), o.paymentMethod, o.paymentStatus, o.status, o.createdAt);
    for (const [userId, items] of Object.entries(old.carts || {})) for (const i of items)
      if (getProduct(i.productId)) q('INSERT OR IGNORE INTO cart_items (user_id,product_id,qty) VALUES (?,?,?)').run(userId, i.productId, i.qty);
    q("UPDATE meta SET value = ? WHERE key = 'orderSeq'").run(String(old.orderSeq || 1000));
  });
  fs.renameSync(OLD_JSON, OLD_JSON + '.migrated');
  console.log('Moved your data from data/db.json into data/kitty.db (old file kept as db.json.migrated).');
}

if (q('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  if (fs.existsSync(OLD_JSON)) migrateJson(); else seed();
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (msg, status = 400) => new HttpError(status, msg);

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
  const row = q(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?`).get(sha(token), Date.now());
  return row || null;
}
function startSession(res, userId) {
  q('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  q('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?,?,?)').run(sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
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
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

/* ---------------- CSV (for Google Sheets / Excel) ---------------- */
// Cells that start with = + - @ can run as formulas when the file is opened in a spreadsheet, so text cells get a leading '.
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCsv = (headers, rows) => '\uFEFF' + [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','; // Excel in some countries uses ;
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
const unQuote = s => String(s).replace(/^'(?=[=+\-@])/, ''); // undo the protective ' added on export

function sendCsv(res, filename, headers, rows) {
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(toCsv(headers, rows));
}
const dollars = cents => (cents / 100).toFixed(2);

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
  if (q('SELECT 1 FROM users WHERE email = ?').get(email)) throw bad('An account with this email already exists.', 409);
  const id = uid();
  q('INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)').run(id, name, email, hashPassword(password), 'customer', now());
  startSession(res, id);
  return { user: toUser(q('SELECT * FROM users WHERE id = ?').get(id)) };
});

route('POST', '/api/auth/login', ({ body, res, ip }) => {
  checkRate(ip);
  const email = cleanStr(body.email, 200).toLowerCase();
  const user = q('SELECT * FROM users WHERE email = ?').get(email);
  const ok = user && verifyPassword(typeof body.password === 'string' ? body.password : '', user.password_hash);
  if (!ok) { noteFail(ip); throw bad('Wrong email or password.', 401); }
  startSession(res, user.id);
  return { user: toUser(user) };
});

route('POST', '/api/auth/logout', ({ req, res }) => {
  const token = parseCookies(req).kitty_sid;
  if (token) q('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
  res.setHeader('Set-Cookie', 'kitty_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return { ok: true };
});

route('GET', '/api/auth/me', ({ user }) => ({ user: user || null }));

/* ---- products (public) ---- */
const SORTS = {
  newest: 'created_at DESC',
  'price-asc': 'ROUND(price_cents * (100 - discount_percent) / 100.0) ASC',
  'price-desc': 'ROUND(price_cents * (100 - discount_percent) / 100.0) DESC',
  discount: 'discount_percent DESC, created_at DESC',
  rating: 'rating DESC, created_at DESC'
};
route('GET', '/api/products', ({ query }) => {
  const where = [], args = [];
  if (query.ids) { const ids = query.ids.split(',').slice(0, 100); where.push(`id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
  if (query.category) { where.push('category = ?'); args.push(query.category); }
  if (query.q) { where.push(`(name || ' ' || category || ' ' || description) LIKE ? ESCAPE '\\'`); args.push('%' + query.q.replace(/[\\%_]/g, '\\$&') + '%'); }
  if (query.sale === '1') where.push('discount_percent > 0');
  if (query.featured === '1') where.push('featured = 1');
  const sql = `SELECT * FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${SORTS[query.sort] || SORTS.newest}`;
  return { products: q(sql).all(...args).map(toProduct) };
});

route('GET', '/api/products/:id', ({ params }) => {
  const p = getProduct(params.id);
  if (!p) throw bad('Product not found.', 404);
  return { product: p };
});

route('GET', '/api/categories', () => {
  const rows = q('SELECT category, COUNT(*) AS n, MIN(created_at) AS first FROM products GROUP BY category ORDER BY first').all();
  return {
    categories: rows.map(r => {
      const p = q('SELECT images FROM products WHERE category = ? ORDER BY created_at LIMIT 1').get(r.category);
      return { name: r.category, count: r.n, image: JSON.parse(p.images)[0] || '' };
    })
  };
});

/* ---- cart (logged-in users; guests keep theirs in localStorage) ---- */
route('GET', '/api/cart', { auth: 'user' }, ({ user }) => ({
  items: q('SELECT product_id, qty FROM cart_items WHERE user_id = ?').all(user.id).map(r => ({ productId: r.product_id, qty: r.qty }))
}));
route('PUT', '/api/cart', { auth: 'user' }, ({ user, body }) => {
  if (!Array.isArray(body.items) || body.items.length > 100) throw bad('Invalid cart.');
  const items = [];
  tx(() => {
    q('DELETE FROM cart_items WHERE user_id = ?').run(user.id);
    for (const i of body.items) {
      const p = q('SELECT id, stock FROM products WHERE id = ?').get(String(i.productId));
      const qty = Math.floor(Number(i.qty));
      if (!p || !(qty >= 1) || items.some(x => x.productId === p.id)) continue;
      const capped = Math.min(qty, 99, Math.max(p.stock, 1));
      q('INSERT INTO cart_items (user_id, product_id, qty) VALUES (?,?,?)').run(user.id, p.id, capped);
      items.push({ productId: p.id, qty: capped });
    }
  });
  return { items };
});

/* ---- orders ---- */
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
  if (!PAYMENT_METHODS.includes(body.paymentMethod)) throw bad('Please choose a payment method.');
  const paymentMethod = body.paymentMethod;

  // Everything below happens in one transaction: if anything fails, nothing is saved.
  const order = tx(() => {
    const cart = q('SELECT product_id, qty FROM cart_items WHERE user_id = ?').all(user.id);
    if (!cart.length) throw bad('Your cart is empty.');
    const items = [];
    for (const c of cart) {
      const p = getProduct(c.product_id); // prices are always re-read from the database
      if (!p) throw bad('A product in your cart is no longer available. Please review your cart.');
      const upd = q('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(c.qty, p.id, c.qty);
      if (!upd.changes) throw bad(`Only ${p.stock} left of "${p.name}". Please update your cart.`, 409);
      items.push({ productId: p.id, name: p.name, image: p.images[0] || '', unitCents: p.finalCents, qty: c.qty });
    }
    const subtotalCents = items.reduce((t, i) => t + i.unitCents * i.qty, 0);
    const shippingCents = shippingFor(subtotalCents);
    q("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'orderSeq'").run();
    const number = 'KT-' + q("SELECT value FROM meta WHERE key = 'orderSeq'").get().value;
    const o = {
      id: uid(), number, user_id: user.id, user_name: user.name, user_email: user.email, items: JSON.stringify(items),
      subtotal_cents: subtotalCents, shipping_cents: shippingCents, total_cents: subtotalCents + shippingCents, shipping: JSON.stringify(shipping),
      payment_method: paymentMethod,
      // Demo only: no real payment is processed. Card/PayPal are marked "paid (demo)".
      payment_status: paymentMethod === 'cod' ? 'pay on delivery' : 'paid (demo)', status: 'pending', created_at: now()
    };
    q(`INSERT INTO orders VALUES (:id,:number,:user_id,:user_name,:user_email,:items,:subtotal_cents,:shipping_cents,:total_cents,:shipping,:payment_method,:payment_status,:status,:created_at)`).run(o);
    q('DELETE FROM cart_items WHERE user_id = ?').run(user.id);
    return toOrder(o);
  });
  return { order };
});

route('GET', '/api/orders', { auth: 'user' }, ({ user }) => ({
  orders: q('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(user.id).map(toOrder)
}));

/* ---- admin: products ---- */
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

route('POST', '/api/admin/products', { auth: 'admin' }, ({ body }) => ({ product: getProduct(insertProduct(parseProduct(body))) }));
route('PUT', '/api/admin/products/:id', { auth: 'admin' }, ({ params, body }) => {
  if (!getProduct(params.id)) throw bad('Product not found.', 404);
  updateProduct(params.id, parseProduct(body));
  return { product: getProduct(params.id) };
});
route('DELETE', '/api/admin/products/:id', { auth: 'admin' }, ({ params }) => {
  const p = getProduct(params.id);
  if (!p) throw bad('Product not found.', 404);
  q('DELETE FROM products WHERE id = ?').run(params.id); // also removes it from carts
  p.images.filter(u => u.startsWith('/uploads/')).forEach(u => fs.unlink(path.join(UPLOADS, path.basename(u)), () => {}));
  return { ok: true };
});

/* ---- admin: stats ---- */
route('GET', '/api/admin/stats', { auth: 'admin' }, () => adminStats());
function adminStats() {
  const days = [];
  for (let d = 6; d >= 0; d--) {
    const day = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
    days.push({ day, totalCents: q("SELECT COALESCE(SUM(total_cents),0) AS t FROM orders WHERE status != 'cancelled' AND created_at LIKE ?").get(day + '%').t });
  }
  return {
    revenueCents: q("SELECT COALESCE(SUM(total_cents),0) AS t FROM orders WHERE status != 'cancelled'").get().t,
    orders: q('SELECT COUNT(*) AS n FROM orders').get().n,
    pendingOrders: q("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'").get().n,
    products: q('SELECT COUNT(*) AS n FROM products').get().n,
    customers: q("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").get().n,
    lowStock: q('SELECT * FROM products WHERE stock <= 5 ORDER BY stock').all().map(toProduct),
    recentOrders: q('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5').all().map(toOrder),
    days
  };
}

/* ---- admin: uploads ---- */
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

/* ---- admin: orders + customers ---- */
route('GET', '/api/admin/orders', { auth: 'admin' }, () => ({ orders: q('SELECT * FROM orders ORDER BY created_at DESC').all().map(toOrder) }));
route('PUT', '/api/admin/orders/:id', { auth: 'admin' }, ({ params, body }) => {
  if (!ORDER_STATUSES.includes(body.status)) throw bad('Unknown status.');
  tx(() => {
    const o = toOrder(q('SELECT * FROM orders WHERE id = ?').get(params.id));
    if (!o) throw bad('Order not found.', 404);
    if (body.status === 'cancelled' && o.status !== 'cancelled') {
      o.items.forEach(i => q('UPDATE products SET stock = stock + ? WHERE id = ?').run(i.qty, i.productId)); // put stock back
    } else if (o.status === 'cancelled' && body.status !== 'cancelled') {
      for (const i of o.items) {
        const r = q('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(i.qty, i.productId, i.qty);
        if (!r.changes && q('SELECT 1 FROM products WHERE id = ?').get(i.productId)) throw bad(`Not enough stock of "${i.name}" to re-open this order.`, 409);
      }
    }
    const paymentStatus = body.status === 'delivered' && o.paymentMethod === 'cod' ? 'paid' : o.paymentStatus;
    q('UPDATE orders SET status = ?, payment_status = ? WHERE id = ?').run(body.status, paymentStatus, o.id);
  });
  return { order: toOrder(q('SELECT * FROM orders WHERE id = ?').get(params.id)) };
});
route('GET', '/api/admin/users', { auth: 'admin' }, () => ({
  users: q('SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders FROM users u ORDER BY created_at').all().map(r => ({ ...toUser(r), orders: r.orders }))
}));

/* ---- admin: CSV export (open in Google Sheets or Excel) ---- */
const PRODUCT_COLUMNS = ['id', 'name', 'category', 'description', 'price', 'discount_percent', 'stock', 'featured', 'images'];
route('GET', '/api/admin/export/:what', { auth: 'admin' }, ({ params, res }) => {
  const stamp = new Date().toISOString().slice(0, 10);
  if (params.what === 'products.csv') {
    const rows = q('SELECT * FROM products ORDER BY created_at DESC').all().map(toProduct)
      .map(p => [p.id, p.name, p.category, p.description, dollars(p.priceCents), p.discountPercent, p.stock, p.featured ? 'yes' : 'no', p.images.join(' | ')]);
    return sendCsv(res, `kitty-products-${stamp}.csv`, PRODUCT_COLUMNS, rows);
  }
  if (params.what === 'orders.csv') {
    const rows = q('SELECT * FROM orders ORDER BY created_at DESC').all().map(toOrder).map(o => [
      o.number, o.createdAt, o.status, o.userName, o.userEmail, o.items.map(i => `${i.name} x${i.qty}`).join('; '),
      dollars(o.subtotalCents), dollars(o.shippingCents), dollars(o.totalCents), o.paymentMethod, o.paymentStatus,
      o.shipping.fullName, o.shipping.phone, o.shipping.address, o.shipping.city, o.shipping.zip, o.shipping.country]);
    return sendCsv(res, `kitty-orders-${stamp}.csv`, ['order', 'date', 'status', 'customer', 'email', 'items', 'subtotal', 'shipping', 'total', 'payment_method', 'payment_status', 'ship_to', 'phone', 'address', 'city', 'postal_code', 'country'], rows);
  }
  if (params.what === 'customers.csv') {
    const rows = q('SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS n, (SELECT COALESCE(SUM(total_cents),0) FROM orders o WHERE o.user_id = u.id AND o.status != \'cancelled\') AS spent FROM users u ORDER BY created_at').all()
      .map(r => [r.name, r.email, r.role, r.created_at, r.n, dollars(r.spent)]);
    return sendCsv(res, `kitty-customers-${stamp}.csv`, ['name', 'email', 'role', 'joined', 'orders', 'total_spent'], rows);
  }
  if (params.what === 'dashboard.csv') {
    const s = adminStats();
    const rows = [['Summary', 'Revenue (not cancelled)', dollars(s.revenueCents)], ['Summary', 'Orders', s.orders], ['Summary', 'Orders waiting to process', s.pendingOrders],
      ['Summary', 'Products', s.products], ['Summary', 'Customers', s.customers],
      ...s.days.map(d => ['Sales by day', d.day, dollars(d.totalCents)]),
      ...s.lowStock.map(p => ['Low stock', p.name, p.stock])];
    return sendCsv(res, `kitty-dashboard-${stamp}.csv`, ['section', 'label', 'value'], rows);
  }
  throw bad('Unknown export.', 404);
});

/* ---- admin: CSV import of products ---- */
const num = v => { // accepts 18.99, 18,99, "$18.99"
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.'); else s = s.replace(/,/g, '');
  return s === '' ? NaN : Number(s);
};
route('POST', '/api/admin/import/products', { auth: 'admin', bodyLimit: 3 * 1024 * 1024 }, ({ body }) => {
  const table = parseCsv(String(body.csv || ''));
  if (table.length < 2) throw bad('The file is empty. Export your products first and use that file as a template.');
  if (table.length > 2001) throw bad('Please import at most 2000 products at a time.');
  const head = table[0].map(h => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  for (const col of ['name', 'category', 'price', 'stock']) if (!head.includes(col)) throw bad(`The first row must contain a "${col}" column.`);
  const get = (row, col) => { const i = head.indexOf(col); return i < 0 ? '' : unQuote(String(row[i] ?? '').trim()); };

  const plan = [], errors = [];
  table.slice(1).forEach((row, idx) => {
    const line = idx + 2; // spreadsheet row number (row 1 is the header)
    try {
      const priceCents = Math.round(num(get(row, 'price')) * 100);
      const p = parseProduct({
        name: get(row, 'name'), category: get(row, 'category'), description: get(row, 'description'), priceCents,
        discountPercent: head.includes('discount_percent') && get(row, 'discount_percent') !== '' ? num(get(row, 'discount_percent')) : 0,
        stock: num(get(row, 'stock')), featured: /^(yes|true|1|x|y)$/i.test(get(row, 'featured')),
        images: get(row, 'images').split(/\s*[|\n]\s*/).filter(Boolean)
      });
      const id = get(row, 'id');
      plan.push({ p, id: id && getProduct(id) ? id : null });
    } catch (e) { errors.push({ row: line, message: e.message }); }
  });
  if (errors.length) return { created: 0, updated: 0, errors: errors.slice(0, 30), moreErrors: Math.max(0, errors.length - 30) };

  let created = 0, updated = 0; // nothing is saved unless every row is valid
  tx(() => plan.forEach(({ p, id }) => { if (id) { updateProduct(id, p); updated++; } else { insertProduct(p); created++; } }));
  return { created, updated, errors: [] };
});

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
  const result = await r.handler({ req, res, params, body, query, user: user && toUser(user), ip: req.socket.remoteAddress });
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

server.listen(PORT, () => console.log(`Kitty Ecommerce running at http://localhost:${PORT}`));
process.on('SIGINT', () => { db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });
