# Kitty Ecommerce

A cat shop built with plain HTML, CSS and JavaScript, plus a small Node.js backend with **no dependencies** (nothing to `npm install`).

## Run it

1. Install Node.js 18 or newer.
2. In this folder run: `node server.js` (or `npm start`)
3. Open http://localhost:3000

The first start creates `data/db.json` with 14 sample cat products and an admin account.

**Admin login:** `admin@kitty.local` / `admin123` at http://localhost:3000/login.html, then open the Admin dashboard.
Change these before going live: delete `data/db.json` and start with your own values:

    ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-password' node server.js

## What's included

**Shop:** home with hero slider, categories, search, filters, sorting, sale items, "deal of the day" (biggest discount), product pages with image gallery, cart, checkout.

**Accounts:** sign up, log in, log out. Guests can fill a cart; it is merged into their account on login. Logged-in carts are saved on the server. The "My orders" page shows order history and status.

**Admin dashboard (`/admin.html`):**
- Dashboard: revenue, orders, customers, 7-day sales, low-stock list
- Products: add, edit, delete, upload several images, set price, **discount %**, stock, featured
- Orders: see all orders with items and delivery details, change status (cancelling puts stock back)
- Customers: list of registered users

**Payment (front end only):** card form (formatting, Luhn check, expiry check), PayPal and cash-on-delivery options. Card details **never leave the browser**; only the chosen method is sent. Card/PayPal orders are labelled `paid (demo)`.
To take real payments, add Stripe Checkout or PayPal on the server: create a payment session in `POST /api/orders` and only mark the order paid after the provider's webhook confirms it.

## Folder layout

    server.js                 backend (API + static files)
    data/db.json              database (created automatically)
    public/                   the website
      index.html product.html cart.html checkout.html login.html account.html admin.html
      assets/css/             style.css, admin.css
      assets/js/              common.js (shared), one script per page
      assets/images/          logo, hero art, product art
      uploads/                images uploaded from the admin

## Your own logo

The black kitty logo is `public/assets/images/logo/logo-cat.svg` (also `logo.svg` and `favicon.svg`).
To use your own AI-generated kitty, save it as `logo-cat.png` in the same folder and change the `logo-cat.svg` paths in `public/assets/js/common.js` (header and footer) and `public/admin.html`.

## Security notes

Passwords are hashed with scrypt. Sessions use HttpOnly cookies. Prices and stock are always recalculated on the server. Admin routes check the role on the server. Uploads are checked by file signature (SVG is not accepted). State-changing requests must be same-origin JSON. When you host this on HTTPS, start with `COOKIE_SECURE=true`.
This is a small JSON-file store, good for a demo or a small shop. For heavy traffic, move to a real database.

## Currency and shipping

Edit `CONFIG` near the top of `server.js` (currency symbol, shipping price, free-shipping threshold).
