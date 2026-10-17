# Changelog

## Phase 2 — TypeScript backend, React frontend (2026-10)

Every page is rebuilt in React and looks exactly like phase 1 (checked screenshot against screenshot at phone, tablet
and desktop widths, for every page, every admin section and all three admin roles). The backend is the same Express +
Prisma server, now in strict TypeScript.

### Upgrading a phase-1 installation (e.g. a local `cofecomplete` database)

1. Back up first: `pg_dump -Fc cofecomplete > before-phase2.dump` (and the `uploads/products/` folder).
2. Replace the code but **keep `.env` and the `uploads/products/` folder** (product images are not in git), then
   `npm install` (or `npm ci`).
3. `npx prisma migrate deploy` applies `20261013140000_menu_types_addons` in a single transaction (all or nothing):
   - creates the `MenuType` table with «کافه», «رستوران», «صبحانه» and moves every existing category to the
     menu type it had before;
   - creates the add-on tables (`AddOn`, `ProductAddOn`);
   - removes the unused "change reservation" flow: any leftover `CHANGE_PENDING` reservation becomes `CANCELLED`,
     and `originalReservationId` is dropped.
   The user in `DATABASE_URL` must own the tables (it does if it created them with the phase-1 migration).
4. Development: `npm run dev`. Production: `npm run build`, then restart with `npm start`.

No `.env` change is needed. Bookmarks and links in old SMS messages keep working (see "URLs" below).

### Backend
- Whole server in strict TypeScript (`src/**/*.ts`); `tsx` runs it in development and tests, `tsc` builds it to
  `dist/server`. Request helpers are typed (`currentUser`, `currentAdmin`, `queryString`).
- The same server also serves the React pages: Vite as middleware in development (one port, live reload),
  the built files from `dist/client` in production.

### Frontend
- React 19 + Vite 6, all TypeScript. Each page is its own small app with its own stylesheet, so the café site,
  the reservation pages and the admin panel can never affect each other's styles.
- All phase-1 CSS is reused unchanged (only asset paths changed); each page has one `page.css` that fixes the cascade
  order for both development and the production build.
- The legacy vanilla-JS frontend (`web/`) is removed. Fonts, images and floor-map files live in `client/public`.

### URLs
- Clean addresses: `/`, `/menu`, `/feedback`, `/reserve`, `/reserve/payment`, `/reserve/invoice`, `/reserve/profile`,
  `/reserve/track`, `/admin`, `/admin/login` (a trailing slash works too).
- Every old address redirects permanently (301) and keeps its query string: `/src/pages/menu/menu.html` → `/menu`,
  `/reserve/payment.html?id=…` → `/reserve/payment?id=…`, `/admin/login.html` → `/admin/login`, and the addresses of
  the original separate projects. The payment gateway now returns customers to `/reserve/payment`.

### New
- **Menu types** (the tabs of the menu page) are managed from the admin panel: add (e.g. «قلیان»), rename, reorder,
  hide, delete when empty. Manager and developer only; staff keep products, add-ons and categories.
- **Product add-ons**: one shared library of add-ons with an extra price (0 = free), attached to any number of products.
  The product dialog on the menu lets the customer tick them; the order list shows them and adds their prices.
- **Working hours and closures up to 24:00.** Hours past midnight are not supported (by decision).
- The "change reservation" API, which no page used and which charged the full new price, is removed.

### Bugs fixed
- Phone numbers, login codes and tracking codes typed on a Persian keyboard (۰۹۱۲…) were rejected as invalid.
  The same input is now accepted in working hours and settings.
- Changing an admin's password used `window.prompt`, which showed the new password in plain text; now a masked dialog.
- Menu page: the underline under the active menu tab was misplaced until the window was resized.
- Booking page heading used Arabic «ي/ك/ى» instead of Persian «ی/ک».
- Impossible dates and times (e.g. 2026-02-30, 25:00) are a clear 400 instead of a server error.
- Removed unused dependencies (`cors`, `zod`, `nodemon`); `tsx` updated for an `esbuild` advisory.

### Visible differences from phase 1 (intended)
- Admin menu: two new sections («افزودنی‌ها», «دسته‌های اصلی منو»); add-on picker in the product form; a hint about
  24:00 above working hours; the categories hint mentions menu types instead of the fixed three.
- Booking dialog policy text says «لغو رزرو تا …» (change-reservation is gone).

### Still to do
- SMS provider (sms.ir) — saved for the very end; `SMS_MODE="console"` only.
- Phase 3: cleanup, some restyling, the «افتر» / After branding.

## Phase 1 — merge (2026-10)

The former **Roof Reservation** project and the **Simple Cafe Template** now run as one site.

### Structure
- One Express server, one PostgreSQL database, one Prisma schema with a fresh `init` migration.
- Café pages at `/`, reservation at `/reserve/`, one admin panel at `/admin/`, uploads at `/uploads/products/`.
- Old addresses (`/admin.html`, `/payment.html`, `/invoice.html`, `/profile.html`, `/track.html`, …) redirect.
- Fonts are self-hosted (Google Fonts is unreliable from Iran); same families as before.

### Admin
- Single panel built on the reservation admin's look; menu products, categories and reviews moved into it.
- Login by username. Roles: `DEVELOPER` (only role allowed to edit the floor map), `MAIN`, `SECONDARY`.
- Dashboard combines reservations with menu numbers (visitors today, products, categories, pending reviews).
- Reservation status changes follow fixed transitions; every change asks for confirmation.
- Deleting a category that still has products requires explicit confirmation (was silent).

### Reservation site
- Fully responsive, mobile-first layer (`web/reserve/css/responsive.css`); desktop unchanged.
- Map fills its frame on every screen, starts on a single hall on phones, supports one-finger pan,
  two-finger pinch zoom, and no longer traps page scrolling.
- Customers can cancel from the invoice page (the policy text promised it, but there was no button).
- Micro-animations (`motion.css` on both sites), disabled for users who prefer reduced motion.

### Bugs fixed
- Reservation page layout never collapsed on phones (a later rule overrode the media query).
- On phones the table-detail sheet opened *under* the dark overlay, so "continue booking" could not be tapped.
- Map overflowed its card between 1024 and 1279 px.
- About-page hero image missing on Linux servers (`hero-bg.JPG` vs `hero-bg.jpg`).
- Negative cleaning buffer could be saved, letting reservations overlap (double booking).
- A payment completed after the hold expired confirmed the booking even if the table had been re-booked.
- Admin could "confirm" an expired/cancelled reservation without any availability check.
- Cancelling a reservation paid through the change flow did not record the refund.
- Staff could not register walk-in / phone bookings for the next two hours.
- Customer cancellation errors surfaced as 500 "internal error".
- Invalid OTP purpose, closure zone/table, or table fields produced raw database errors (500).
- `image` field in table updates crashed the request; table numbers were not validated.
- Anyone with a reservation id could start a payment for it.
- Settings accepted unknown keys and non-integer values; min duration could exceed max.
- Uploads trusted the browser's mimetype; now checked by file content. A product could reuse another product's
  image file, and deleting one removed the other's image.
- Login timing leak (invalid dummy bcrypt hash) and spoofable visitor counter (`X-Forwarded-For` trusted).
- Review length limits differed between the form (100) and the server (500).
- Admin sessions now end immediately when an account is deactivated or its role changes.
- Re-running `db:seed` reset every floor-map edit made in the panel.
- Decoration checkbox misaligned; bidi-garbled "table · guests" line in profile and dashboard.

### Known, left for later phases
- The "change reservation" API has no UI and charges the full new price instead of the difference; redesign in phase 2.
- Working hours cannot cross midnight (the About page says the café is open until 24:00).
- SMS provider (sms.ir) not yet connected; `SMS_MODE="console"` only.
- Unused legacy files kept for phase 3 cleanup: `web/reserve/css/{main,map,shared}.css`, `web/site/public/service-worker.js`.
