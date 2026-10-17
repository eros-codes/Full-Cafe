# Roof — café website, menu & table reservation

One Node.js server runs the whole café site:

| Part | URL | What it is |
| --- | --- | --- |
| Café site | `/`, `/menu`, `/feedback` | About page, menu (with add-ons and an order list), customer reviews |
| Reservation | `/reserve` (+ `/reserve/payment`, `/invoice`, `/profile`, `/track`) | Live floor map, table booking, Zarinpal payment, invoice, guest tracking, customer profile (SMS login) |
| Admin panel | `/admin` (login at `/admin/login`) | One panel for reservations, the floor map, menu, menu types, add-ons, categories, reviews, hours, closures, settings, reports and admin accounts |
| API | `/api/...` | JSON API used by all of the above |

**Stack:** Express 4 + Prisma 5 + PostgreSQL, strict TypeScript on the server; React 19 + Vite 6 (TypeScript) for every page.
Persian, RTL, mobile-first.

> **Phase 2 of 3.** Phase 1 merged the former *Roof Reservation* project and the *Simple Cafe Template* into one server,
> one database and one admin panel. Phase 2 (this version) moves the backend to TypeScript and rebuilds every page in
> React, pixel-identical to phase 1, and adds manageable menu types and product add-ons. Phase 3 is cleanup and restyling.

---

## Quick start

Requirements: **Node.js 20+** and **PostgreSQL 14+**.

```bash
npm install
cp .env.example .env            # Windows: copy .env.example .env
# edit .env: DATABASE_URL, the two JWT secrets, SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD

npx prisma migrate deploy       # creates / upgrades all tables
npm run db:seed                 # settings, working hours, floor-map tables, first admin
npm run dev                     # http://localhost:3000
```

Log in at `http://localhost:3000/admin/login` with `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`.

In development, SMS messages (including login codes) are printed to the server console (`SMS_MODE="console"`).

### How development works

`npm run dev` starts **one** server on one port. Express serves the API, and Vite runs inside it as middleware, so the
React pages are compiled on the fly from `client/` and the browser reloads itself when you save a file.
Server files (`src/`) restart the server automatically (`tsx watch`). There is no second dev server to start.

### Production

```bash
npm ci                          # dev dependencies are needed for the build
npx prisma migrate deploy
npm run build                   # prisma generate + server (tsc → dist/server) + pages (vite → dist/client)
npm start                       # node dist/server/server.js
```

The built server always serves the built pages from `dist/client` (hashed JS/CSS cached for a year, HTML never
cached). **Restart the server after every build**, because it caches the page HTML in memory.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Development server with live reload (API + React pages on one port) |
| `npm run build` | Production build: Prisma client, server to `dist/server`, pages to `dist/client` |
| `npm run build:client` | Only the React pages (`vite build`) |
| `npm start` | Start the production build |
| `npm run typecheck` | Type-check the server, tests and the React client |
| `npm test` | Integration tests (see below) |
| `npm run db:seed` | Seed settings, working hours, floor-map tables and the first admin (safe to re-run; never overwrites existing data) |
| `npm run prisma:deploy` | Apply migrations (production) |
| `npm run prisma:migrate` | Create a new migration after editing `schema.prisma` (development) |

## Admin roles

| Role | Can do |
| --- | --- |
| `DEVELOPER` | Everything. The **only** role that can edit the floor map (add/move/reshape/delete tables, chairs, table connections) and manage developer accounts. The seeded admin is a developer. |
| `MAIN` (café manager) | Dashboard, reports, settings, working hours, closures, reservations, manual booking, the whole menu **including menu types**, reviews, managing `MAIN`/`SECONDARY` admins, turning tables on/off. |
| `SECONDARY` (staff) | Reservations (complete / no-show / cancel), manual booking, products, add-ons, categories, reviews. Sees the floor map read-only. Cannot add, rename, reorder or delete menu types. |

The rules live in one place on the server: `src/lib/roles.ts`. The admin UI mirrors them in
`client/admin/common/roles.ts` only to hide buttons; the server always checks. At least one active developer account
always remains.

## Menu: types, categories, products, add-ons

- **Menu types** are the tabs at the top of the menu page (کافه, صبحانه, رستوران, …; the migration creates these
  three). The manager adds, renames,
  reorders (the order in the admin list is the tab order), hides or deletes them. A type can only be deleted when it has
  no categories; a hidden type disappears from the site together with everything in it.
- **Categories** belong to one menu type; **products** belong to one category.
- **Add-ons** are one shared library (e.g. «سس فرانسوی» +25,000). Each is created once, with its extra price (0 = free),
  and attached to any number of products from the product form. An inactive add-on stays attached but is hidden on the
  site. On the menu page the customer ticks add-ons in the product dialog; the same product with different add-ons is a
  separate line in the order list.

## Working hours

Closing time can be at most `24:00` (midnight). Hours past midnight (e.g. until 02:00) are not supported. A closure
(day off or blocked hours) can also run until `24:00`; in the admin form, "until 00:00" after a start time means
until midnight.

## Project layout

```
prisma/
  schema.prisma            one schema for reservation + menu
  migrations/              init (phase 1) + menu_types_addons (phase 2)
  seed.ts                  settings, working hours, floor-map tables, first admin
  export-tables.ts         prints the current tables as seed data (after editing the map in the panel)
src/                       the server (TypeScript, ES modules)
  app.ts                   Express app: security headers, API routers, pages
  server.ts                HTTP server + background jobs (hold expiry, SMS reminders, upload cleanup); Vite in dev
  config.ts                environment variables and production safety checks
  lib/                     auth tokens, roles, uploads, payment (Zarinpal), SMS, time helpers
  middleware/              admin/user auth, site-visit counter
  routes/                  auth, public, reservations, payments, menu, admin, admin-menu
  services/                availability engine, reservation logic, settings cache
  web/pages.ts             every page: its URL and its HTML entry (also read by vite.config.ts) + old-URL redirects
  web/frontend.ts          serves the pages (Vite middleware in dev, dist/client in production)
client/                    the React pages (each page is its own small app with its own stylesheet)
  shared/                  API helper, number formatting, icons, mount, storage
  site/                    about, menu, feedback (+ common header/drawer/footer and their CSS)
  reserve/                 booking, payment, invoice, profile, track (+ common parts, floor map, CSS)
  admin/                   login, panel (one component per section in sections/), CSS
  public/                  fonts (self-hosted), images, floor-map files — served at the site root
test/                      node:test integration suite
uploads/products/          product images uploaded from the admin panel (not in git)
```

Each page has a `page.css` that imports its stylesheets in cascade order, so a production build keeps exactly the
order used in development, and the stylesheets of the café site, the reservation pages and the admin panel never mix.

## Images

Product images are uploaded from the admin panel and stored on the server in `uploads/products/`
(served at `/uploads/products/<file>`). Files are checked by content, not just by name, and are limited to 5 MB
(jpg, png, webp, gif). Back this folder up together with the database.

## Tests

```bash
# create an empty database whose name contains "test" (it is WIPED on every run), then:
TEST_DATABASE_URL="postgresql://postgres:PASS@localhost:5432/roof_test?schema=public" npx prisma migrate deploy
TEST_DATABASE_URL="postgresql://postgres:PASS@localhost:5432/roof_test?schema=public" npm test
```

On Windows PowerShell: `$env:TEST_DATABASE_URL="..."; npm test`.

Without `TEST_DATABASE_URL` the integration suite is skipped. It covers admin roles and the floor-map permission,
menu types, categories, add-ons, uploads, reviews, settings and closure validation, working hours up to 24:00,
reservation status rules, holds/availability/payment/cancellation, Persian-digit input, page URLs and old-URL
redirects.

## Production checklist

- `NODE_ENV=production`, `APP_URL` = the real `https://` address.
- Two long random `JWT_SECRET` / `ADMIN_JWT_SECRET` values.
- `PAYMENT_MODE="live"` and a real `ZARINPAL_MERCHANT_ID`.
- An SMS provider: `src/lib/sms.ts` currently only has the console mode; the provider (sms.ir) is plugged in there.
  The server refuses to start in production with `SMS_MODE="console"`.
- Run behind nginx (the app trusts one proxy hop in production) with HTTPS.
- Back up the database and `uploads/products/`.

## Old addresses

Every address used before phase 2 still works and redirects permanently (301, query string kept), e.g.
`/src/pages/menu/menu.html` → `/menu`, `/reserve/payment.html?id=…` → `/reserve/payment?id=…`,
`/admin/login.html` → `/admin/login`, and the addresses of the original separate projects (`/admin.html`,
`/payment.html`, `/track.html`, …). The full list is in `src/web/pages.ts`.
