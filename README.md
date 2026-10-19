# Roof — café website, menu & table reservation

One Node.js server runs the whole café site:

| Part | URL | What it is |
| --- | --- | --- |
| Café site | `/`, `/menu`, `/feedback` | About page, menu (with add-ons, an order list, sold-out marks and «انتخاب برای من»), customer reviews |
| Reservation | `/reserve` (+ `/reserve/payment`, `/invoice`, `/profile`, `/track`) | Live floor map, table booking, Zarinpal payment, invoice, guest tracking, customer profile (SMS login) |
| Admin panel | `/admin` (login at `/admin/login`) | One panel for reservations, the floor map, menu, menu types, add-ons, categories, the «انتخاب برای من» questions and tags, reviews, hours, closures, settings, reports and admin accounts |
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
npm run db:seed                 # settings, working hours, floor-map tables, first admin, the menu (with photos) and its questions
npm run dev                     # http://localhost:3000
```

### Upgrading an existing install

```bash
npm install
npx prisma generate             # the Prisma client must know the new tables (migrate deploy does not do this)
npx prisma migrate deploy       # adds the recommender tables and columns; existing data is untouched
npm run db:seed                 # adds what is missing (e.g. the starter questions, the recommender switch); never overwrites
```

Then, in the admin panel: give each category its kind (drink / food / dessert), tag the categories and products, check
the coverage in «انتخاب برای من», and turn the feature on in «قیمت و تنظیمات». It starts switched off.

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
| `npm run db:seed` | Seed settings, working hours, floor-map tables, the first admin, and the menu and «انتخاب برای من» questions from `prisma/seed-data/` (safe to re-run; never overwrites existing data) |
| `npm run db:export-menu` | Export this database's menu (types, categories, products, add-ons, tags, images) to `menu-export/` |
| `npm run simulate:recommender` | Simulate 1000 customers on the real menu and report how well «انتخاب برای من» does (`-- 5000` for more) |
| `npm run prisma:deploy` | Apply migrations (production) |
| `npm run prisma:migrate` | Create a new migration after editing `schema.prisma` (development) |

## Admin roles

| Role | Can do |
| --- | --- |
| `DEVELOPER` | Everything. The **only** role that can edit the floor map (add/move/reshape/delete tables, chairs, table connections) and manage developer accounts. The seeded admin is a developer. |
| `MAIN` (café manager) | Dashboard, reports, settings, working hours, closures, reservations, manual booking, the whole menu **including menu types and the «انتخاب برای من» questions**, reviews, managing `MAIN`/`SECONDARY` admins, turning tables on/off. |
| `SECONDARY` (staff) | Reservations (complete / no-show / cancel), manual booking, products (including sold out and tags), add-ons, categories (including kind and tags), reviews. Sees the floor map read-only. Cannot change menu types or the recommender questions. |

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
- **Sold out** («ناموجود»): untick «موجود است» in the product form, or use «ناموجود کن» in the product list. The
  product stays on the menu, greyed out with a «ناموجود» mark; it cannot be added to the order list and is never
  recommended. «موجود کن» brings it back.

## «انتخاب برای من» (pick for me)

A round button at the bottom right of the menu page opens a short dialog. It arrives a few seconds after the page and
shows the sentence «نمی‌دونی چی انتخاب کنی؟» for about two seconds before going back to a circle. The customer
says what they want (drink, food, dessert or «فرقی نداره»), optionally their dietary restrictions, answers a few quick
questions and gets 1 to 3 suggestions from the menu, each with its reason («سرد و شیرین، مطابق جواب‌هات»). Tapping a
suggestion opens the product as usual. The button only appears when the feature is switched on in
«قیمت و تنظیمات» **and** there is a taste question with options and a product to suggest.

**What the café sets up** (admin panel):

- **Kind of each category** (drink / food / dessert) in «دسته‌بندی منو». A category without a kind (e.g. hookah) is left
  out of the recommender.
- **Tag groups** in «انتخاب برای من» (manager only). Each group is one question and its options, e.g. «گرم یا سرد؟»
  with «گرم» / «سرد». Per group: the kinds it applies to, the question text (optionally a different text per kind),
  single or multiple choice, an importance from 1 to 5, whether the options are a scale (شیرین ← کم‌شیرین ← تلخ: the
  option next to the customer's answer then counts as a near match), and active / inactive. A group is either a **taste** question
  (asked by the algorithm) or a **dietary restriction** (vegetarian, nut-free, …: only shown when the customer opens
  «محدودیت غذایی داری؟»; a product without that tag is treated as not suitable). Write options descriptively
  («با کافئین», not «دارد»): the same text is the reason shown to the customer. The seed creates the questions of
  `prisma/seed-data/menu.json` once, on an empty table.
- **Tags.** A category's tags are inherited by all its products. A product can also set a group itself, which then
  replaces the category's options **for that group only**: a decaf coffee in «قهوه» sets the caffeine group to
  «بدون کافئین» and still inherits everything else. «مثل دسته» gives the group back to the category. «هیچ‌کدام» means
  none of the options fits the product (water has no flavour): that is a miss for the customer's answer, unlike an
  untagged group, which counts as unknown. «وگان» always brings «گیاهخوار» along.
- **Bulk tagging:** tick products in «محصولات منو» and use «افزودن برچسب» / «برداشتن برچسب». The filter
  «برچسب ناقص» lists the products that still miss an active taste group; the cards in «انتخاب برای من» show the
  coverage of each group.

**How it chooses** (`client/site/menu/recommender/engine.ts`, pure functions, unit-tested):

1. **Pool:** the products of the chosen kind that carry every chosen restriction. Taste answers never remove products.
2. **Score** per product: the importance-weighted average over the answered groups (match 1, miss 0, untagged 0.5;
   a group that does not apply to the product's kind is left out). On a scale the neighbour of the answer counts
   0.35. A product that fits several answers of a group («لاته طعم‌دار»: seven flavours) counts a little less than one
   made for that answer, so «کارامل ماکیاتو» comes before it for «کاراملی».
3. **Contenders:** the products within `SCORE_WINDOW` of the best score. The next question is the active taste group
   that best splits the contenders (times its importance); groups that hardly split them, or that too few contenders
   are tagged in, are never asked. Answers nobody in the pool has are not offered.
4. **Stop** after 4 answers, 8 screens, when 3 or fewer contenders remain, or when no question is useful any more.
   Right after a «فرقی نداره» the most important useful question comes next; after three in a row the customer is
   asked whether to show the result. «نشونم بده» is always there and «قبلی» goes back exactly one step.
5. **Suggestions:** up to 3, only products with at least one real match, the 2nd and 3rd within the window of the
   first, one per category where possible. «یه چیز دیگه نشونم بده» walks the rest of the pool without repeats. From
   the first «یه چیز دیگه» on (not with the first result), a second round of at most 3 questions is offered, and it
   stays while the customer keeps asking for more, as long as there is still something to narrow down.

The tunable constants are `CONFIG` at the top of `engine.ts`. After tagging the real menu, run
`npm run simulate:recommender`: it plays 1000 customers who each care about 2–4 things and reports the average number
of questions and how often the suggestions contain what they wanted (compared with how often such a product exists).

The data comes from `GET /api/recommender` (cached for a minute on the server, dropped at once after any admin change
to the menu, the tags or the settings); the engine runs in the browser.

## Seed menu

`prisma/seed-data/` holds the menu the seed creates on an empty database: `menu.json` (menu types, categories with
their kind and tags, add-ons, products, the «انتخاب برای من» questions) and `images/` (the product photos, copied to
`uploads/products/`). It is the format `npm run db:export-menu` writes, so any café's menu becomes the seed menu by
exporting it and replacing the folder's contents. The menu is only created when there is no category and no product
yet, and the questions only when there is no tag group: running the seed on a café in use changes nothing.

To start a development database over from scratch: `npx prisma migrate reset` (deletes **everything**, including
reservations and admin accounts, re-applies the migrations and runs the seed).

## Working hours

Closing time can be at most `24:00` (midnight). Hours past midnight (e.g. until 02:00) are not supported. A closure
(day off or blocked hours) can also run until `24:00`; in the admin form, "until 00:00" after a start time means
until midnight.

## Project layout

```
prisma/
  schema.prisma            one schema for reservation + menu
  migrations/              init (phase 1) + menu_types_addons (phase 2) + recommender_tags
  seed.ts                  settings, working hours, floor-map tables, first admin (+ seed-menu.ts: menu and questions)
  seed-data/               the seed menu: menu.json + product photos (see «Seed menu»)
  export-menu.ts           npm run db:export-menu: this database's menu → menu-export/ (same format as seed-data)
  export-tables.ts         prints the current tables as seed data (after editing the map in the panel)
src/                       the server (TypeScript, ES modules)
  app.ts                   Express app: security headers, API routers, pages
  server.ts                HTTP server + background jobs (hold expiry, SMS reminders, upload cleanup); Vite in dev
  config.ts                environment variables and production safety checks
  lib/                     auth tokens, roles, uploads, payment (Zarinpal), SMS, time helpers
  middleware/              admin/user auth, site-visit counter
  routes/                  auth, public, reservations, payments, menu, recommender, admin (+ admin/menu, admin/tags)
  services/                availability engine, reservation logic, settings cache, recommender data and tags
  web/pages.ts             every page: its URL and its HTML entry (also read by vite.config.ts) + old-URL redirects
  web/frontend.ts          serves the pages (Vite middleware in dev, dist/client in production)
client/                    the React pages (each page is its own small app with its own stylesheet)
  shared/                  API helper, number formatting, icons, mount, storage
  site/                    about, menu (+ menu/recommender: engine, dialog, button), feedback (+ common header/drawer/footer)
  reserve/                 booking, payment, invoice, profile, track (+ common parts, floor map, CSS)
  admin/                   login, panel (one component per section in sections/), CSS
  public/                  fonts (self-hosted), images, floor-map files — served at the site root
scripts/                   simulate-recommender.ts
test/                      node:test integration suite + recommender engine unit tests
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
redirects, and the recommender's data (tag inheritance and overrides, sold-out / no-kind / hidden-tab exclusion,
bulk tagging, coverage, roles). The recommender engine's unit tests need no database and always run.

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
