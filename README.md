# Roof — café website, menu & table reservation

One Node.js server runs the whole café site:

| Part | URL | What it is |
| --- | --- | --- |
| Café site | `/`, `/menu`, `/feedback`, `/games` | About page, menu (with add-ons, an order list, sold-out marks and «انتخاب برای من»), customer reviews, party games on one phone |
| Reservation | `/reserve` (+ `/reserve/payment`, `/invoice`, `/profile`, `/track`) | Live floor map, table booking, Zarinpal payment, invoice, guest tracking, customer profile (SMS login) |
| Admin panel | `/admin` (login at `/admin/login`) | One panel for reservations, the floor map, menu, menu types, add-ons, categories, the «انتخاب برای من» questions and tags, the games and their cards, reviews, hours, closures, settings, reports and admin accounts |
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
npx prisma migrate deploy       # adds the new tables and columns (recommender, games); existing data is untouched
npm run db:seed                 # adds what is missing (questions, the game cards, the switches); never overwrites
```

Then, in the admin panel: give each category its kind (drink / food / dessert), tag the categories and products, check
the coverage in «انتخاب برای من», and turn the feature on in «قیمت و تنظیمات». It starts switched off. The games page
also starts switched off: turn it on in the «بازی‌ها» section.

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
| `npm run db:seed` | Seed settings, working hours, floor-map tables, the first admin, the menu and «انتخاب برای من» questions, and the game cards from `prisma/seed-data/` (safe to re-run; never overwrites existing data) |
| `npm run db:export-menu` | Export this database's menu (types, categories, products, add-ons, tags, images) to `menu-export/` |
| `npm run db:export-games` | Export this database's games (order, on/off, every deck and its cards) to `games-export/games.json` |
| `npm run db:merge-games` | Add the decks and cards of `prisma/seed-data/games.json` that this database does not have yet (after an update brought new cards) |
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

## Games page (/games)

Party games for a table, played on **one phone** that is passed around or put in the middle. Nothing about the players
goes to the server: the page loads the games and their cards once (`GET /api/games`, also kept on the phone so the games
still open when the café's Wi-Fi drops), and every game keeps its state on the phone, so a reload, a call or another
app does not lose it (a game left for more than 6 hours is dropped). A running clock pauses by itself when the phone
goes to another app, a call or the lock screen, and waits for «ادامه». Leaving a game, with ✕ or the phone's back
button, ends it: nothing of it is kept. Only a game interrupted by closing the browser shows «ادامه‌ی بازی» on the list.

| Game | Players | How it works on one phone |
| --- | --- | --- |
| «جاسوس» | 3–12 | The phone goes round; everyone sees the place except the spy (two spies from 6 players). A timer, the list of possible places, «کارتم یادم رفت», a vote, and the caught spy's last guess. A spy may stop the game to name the place, after the phone has privately checked their card (a citizen knows the place). Points per round. |
| «گوشی رو پیشونی» | 2–12 | The player holds the phone on the forehead; tilting it down = guessed, up = pass. Without a motion sensor (or permission), the friends tap the two buttons instead. |
| «پانتومیم» | 2–4 teams | The actor sees the word and acts it out; «گفتن» / «رد». Either as many words as fit in the time, or one word per turn. |
| «کلمات ممنوعه» | 2–4 teams | The describer sees the word and its forbidden words; an opponent watches and taps «خطا» (−1). |
| «دوز» | 1–2 | Tic-tac-toe, two players or against the bot. |
| «چهار در یک ردیف» | 1–2 | Connect four (7 × 6), two players or against the bot. |
| «نقطه‌بازی» | 1–4 | Dots and boxes on a 3×3, 4×4 or 5×5 board, 2–4 friends or one player against the bot. |
| «مافیا» | 5–16 + a narrator | The phone deals the roles (each card seen by its owner only; the mafia also see their team), then stays with the narrator (گرداننده, not a player), who leads the game with it: a speaking timer, the vote, and a script for every night step. Roles: پدرخوانده, مافیا, دکتر, کارآگاه, تک‌تیرانداز, شهروند (the specials can be switched off). |
| «منچ» | 2–4 | Ludo on the classic cross board; any player but the first can be the bot. Three house rules can be switched off. |
| «شطرنج» | 1–2 | Chess with every rule, two players (the board fixed, or turned to whoever is to move) or against the bot with white, black or each colour in turn. Undo, resign, agreed draw. |
| «تخته نرد» | 1–2 | Backgammon the Iranian way: no doubling cube, a «مارس» is worth 2 points, a match to 1, 3, 5 or 7. Two players or against the bot. **Off by default** (see below). |

After every turn of the word games the cards are listed and a wrong tap can be fixed before the points are added.

The board games count the wins of the evening and change the starter every round. Their bots run on the phone and
have two levels: **easy** makes mistakes on purpose, **hard** plays properly. Hard «دوز» is perfect (minimax: it never
loses); hard «چهار در یک ردیف» looks 6 moves ahead (negamax with alpha-beta and a table of positions already seen; well under 0.1 s per move); hard
«نقطه‌بازی» takes every box it can, never gives one away while it has a choice, and otherwise gives the fewest.
Easy «منچ» moves at random (and takes a pawn half of the times it can); hard «منچ» scores every move (a capture, reaching
home, leaving the yard, a safe cell, getting out of reach, not stopping where an opponent can hit next roll).
The «شطرنج» bot is our own (no outside engine): alpha-beta search with captures searched to the end, material and
piece-square tables. Easy looks one move ahead with a lot of noise; hard looks two (so it also
sees a mate it is threatened with), roughly a 1000-rated club beginner; both always take a mate in one. A move takes well under
half a second on a phone. The «تخته نرد» bot weighs every complete play: the race, the chance each lone checker is hit
(counted over the 36 rolls), points made (more in its home board), primes, hits; easy adds a lot of noise.

**«مافیا» rules on the phone:** the mafia are at most (players − 1) / 2, by default a third. Every night the mafia
choose a target, the doctor saves one player (themselves only once a game), the detective asks about one player (the
godfather looks like a citizen) and the sniper has one bullet: on a mafia it kills them, on a citizen the sniper dies
instead. A night step is still called after its player is out (the screen says so), so nobody learns who is gone. The
town wins when no mafia is left, the mafia when they are as many as the town. Whether the role of a player who leaves is
announced is a setting. The roles list on the narrator's screen stays closed until tapped.

**«منچ» rules on the phone:** a pawn leaves the yard with a 6 (or a 1 too, when «ورود فقط با ۶» is off), a 6 rolls again
(«۶ = یه تاس دیگه»), landing on an opponent sends it back except on the start cells and the four stars («خونه‌های
امن»), and the centre needs the exact count. A single possible move is made by itself. Two players sit opposite.

**«شطرنج» rules on the phone:** castling, en passant, promotion (a choice of four), check, mate and every draw: stalemate,
threefold repetition, fifty moves without a capture or a pawn move, and too little material to mate. The game is saved
as its list of moves and rebuilt (each move checked) when the page opens again. «برگردون» takes back a move (against the
bot: the player's move and the bot's answer). The move list is in standard notation (Nf3, O-O, e8=Q+).

**«تخته نرد» rules on the phone:** the opening throw is one die each (a tie throws again); the higher starts and plays
both numbers. As many dice as possible must be played; when only one of two can, the bigger one; bearing off the last
checker ends the game even with a die left. A checker on the bar enters first. Bearing off needs every checker home; a
bigger number bears off from the furthest point only. The moves of a turn can be taken back until «تموم». A win is 1
point, a «مارس» (the loser has borne off nothing) 2. It starts **switched off** in «بازی‌ها» (some audiences, state TV
among them, do not show نرد); turning it on is one tap.

The screen stays on during a game, and short sounds (made on the phone, no audio files) can be muted from the game bar;
any tap brings the sound back after a reload, a call or the lock screen.

**Admin («بازی‌ها», manager only):** the switch for the whole page (off by default; when off, the page and every link to
it disappear), each game on/off and the order of the list, and the **decks**. A deck is a list of cards, one per line,
and can serve several games (places for «جاسوس», words for «گوشی رو پیشونی» and «پانتومیم»). For «کلمات ممنوعه» a line
is `کلمه: ممنوع، ممنوع، …` (up to 8 forbidden words); a card without them is not used in that game. A word game only
appears on the site when its active decks hold enough cards (`GAMES` in `src/services/game-catalog.ts`: 10 places, 30
words, 20 words, 20 cards). The «بازی‌ها» link in the site's drawer and footer only shows while the page is on.

**Seed cards:** `prisma/seed-data/games.json` (13 decks, about 830 cards: places, Iranian landmarks, animals, food, jobs,
objects, sports, everyday actions, TV series and cartoons, Iranian cities, proverbs, and two «کلمات ممنوعه» decks). Same
line format as the editor and as `npm run db:export-games`. `npm run db:seed` creates them only when there is no deck
yet; `npm run db:merge-games` adds the decks and cards of the file a running café does not have (matched by deck name
and card text; nothing is changed or removed, so a card the café deleted comes back if it is still in the file).
Review the words before showing the page to an audience.

**The forehead tilt** (`client/site/games/words/tilt.ts`): the phone's orientation (beta, gamma) gives how much the
screen faces up, `cos(beta)·cos(gamma)`: 0 when the phone stands upright (portrait or landscape, either way round), so
no calibration is needed. Below −0.5 for 80 ms = correct, above +0.5 = pass, then the phone has to come back near upright.
Browsers only give the sensor on **https** (or localhost); on an iPhone the player is asked once, from the turn's start
button. Testing on a phone over plain http on the local network therefore always shows the buttons.

**Code:** `client/site/games/` — `GamesPage.tsx` (the list; a game opens in place with `#spy`, `#heads_up`, …, so the
phone's back button returns to the list), `catalog.tsx` (title, players, icon, component of each game), `kit/` (shared
pieces: game frame, setup fields, «pass the phone», clock, scores, sheets, card drawing that avoids the cards this phone
saw lately, saved state, sounds, wake lock), `spy/` and `words/` (each with a pure `engine.ts`, unit-tested in
`test/games-engine.test.ts`), `board/` (the board games: `tictactoe-rules.ts`, `connect4.ts`, `dots-rules.ts` are the pure rules
and bots, unit-tested in `test/board-games.test.ts`; `kit.tsx` is their shared setup, players' bar and result), `mafia/`
and `ludo/` (each a pure `engine.ts`, unit-tested in `test/mafia-ludo.test.ts`, and its screen), `chess/` and
`backgammon/` (the same; tested in `test/chess-backgammon.test.ts`, chess with the standard perft counts). Adding
a game: a key in `GAMES` (`src/services/game-catalog.ts`), its entry in `catalog.tsx`, its folder; no migration needed.

## Seed menu

`prisma/seed-data/` holds the menu the seed creates on an empty database: `menu.json` (menu types, categories with
their kind and tags, add-ons, products, the «انتخاب برای من» questions) and `images/` (the product photos, copied to
`uploads/products/`). It is the format `npm run db:export-menu` writes, so any café's menu becomes the seed menu by
exporting it and replacing the folder's contents. The menu is only created when there is no category and no product
yet, and the questions only when there is no tag group: running the seed on a café in use changes nothing.

To start a development database over from scratch: `npx prisma migrate reset` (deletes **everything**, including
reservations and admin accounts, re-applies the migrations and runs the seed).

## Reservations and payments

- **A verified phone first:** before the hold, the customer confirms their number with an SMS code, in the same
  booking dialog. That also signs them in (their reservations show in the profile), and the reservation is made
  with that verified number. A customer who is already signed in skips the code.
- A booking starts as a **hold** (`holdMinutes`, 10 by default) and is confirmed when Zarinpal confirms the payment.
  Every trip to the gateway is its own payment (its own authority), so paying on an older gateway page still counts.
  If the hold ran out meanwhile and the table was taken, the reservation goes to «بررسی پرداخت» for a manager.
  If the reservation was already paid, the second payment is recorded as owed back.
- The **invoice** is issued when the reservation is paid (online, confirmed by a manager, or a staff booking), not for
  a hold. The invoice page of an unpaid reservation says so and links to the payment.
- **Refunds:** cancelling a paid reservation records a refund owed («بازگشت وجه»; it shows under «نیاز به بررسی»).
  Once the café has paid it back, the manager records it with «بازگشت وجه انجام شد» in the reservation list (manager
  only).
- SMS codes: one per minute per number, five guesses per code. Expired codes and SMS logs older than a year are
  removed once a day.

## Working hours

Closing time can be at most `24:00` (midnight). Hours past midnight (e.g. until 02:00) are not supported. A closure
(day off or blocked hours) can also run until `24:00`; in the admin form, "until 00:00" after a start time means
until midnight.

## Project layout

```
prisma/
  schema.prisma            one schema for reservation + menu
  migrations/              init (phase 1) + menu_types_addons (phase 2) + recommender_tags + games + reservation_payments
  seed.ts                  settings, working hours, floor-map tables, first admin (+ seed-menu.ts: menu and questions)
  seed-data/               the seed menu: menu.json + product photos (see «Seed menu»), games.json (the game cards)
  seed-games.ts            games part of the seed + db:merge-games; export-games.ts: npm run db:export-games
  export-menu.ts           npm run db:export-menu: this database's menu → menu-export/ (same format as seed-data)
  export-tables.ts         prints the current tables as seed data (after editing the map in the panel)
src/                       the server (TypeScript, ES modules)
  app.ts                   Express app: security headers, API routers, pages
  server.ts                HTTP server + background jobs (hold expiry, SMS reminders, upload cleanup); Vite in dev
  config.ts                environment variables and production safety checks
  lib/                     auth tokens, roles, uploads, payment (Zarinpal), SMS, time helpers
  middleware/              admin/user auth, site-visit counter
  routes/                  auth, public, reservations, payments, menu, recommender, games, admin (+ admin/menu, admin/tags, admin/games)
  services/                availability engine, reservation logic, settings cache, recommender data and tags, games (catalog, cards)
  web/pages.ts             every page: its URL and its HTML entry (also read by vite.config.ts) + old-URL redirects
  web/frontend.ts          serves the pages (Vite middleware in dev, dist/client in production)
client/                    the React pages (each page is its own small app with its own stylesheet)
  shared/                  API helper, number formatting, icons, mount, storage
  site/                    about, menu (+ menu/recommender: engine, dialog, button), feedback, games (+ common header/drawer/footer)
  reserve/                 booking, payment, invoice, profile, track (+ common parts, floor map, CSS)
  admin/                   login, panel (one component per section in sections/), CSS
  public/                  fonts (self-hosted), images, floor-map files — served at the site root
scripts/                   simulate-recommender.ts
test/                      node:test integration suite + recommender, games, board games, mafia/ludo and chess/backgammon unit tests
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
bulk tagging, coverage, roles), and the games API (switch, roles, deck validation and card lines, playable games, order).
The unit tests of the recommender, the games, the board games (their bots included), «مافیا», «منچ», «شطرنج» and «تخته نرد» need no database and always run.

## Production checklist

- `NODE_ENV=production`, `APP_URL` = the real `https://` address.
- Two long random `JWT_SECRET` / `ADMIN_JWT_SECRET` values.
- `PAYMENT_MODE="live"` and a real `ZARINPAL_MERCHANT_ID`.
- An SMS provider: `src/lib/sms.ts` currently only has the console mode; the provider (sms.ir) is plugged in there.
  The server refuses to start in production with `SMS_MODE="console"`.
- Run behind nginx with HTTPS. Set `TRUST_PROXY` to the number of proxies in front of the app (nginx alone = 1, the default;
  Cloudflare + nginx = 2). Every rate limit depends on it: one too few and all visitors share one IP.
- Back up the database and `uploads/products/`.

## Old addresses

Every address used before phase 2 still works and redirects permanently (301, query string kept), e.g.
`/src/pages/menu/menu.html` → `/menu`, `/reserve/payment.html?id=…` → `/reserve/payment?id=…`,
`/admin/login.html` → `/admin/login`, and the addresses of the original separate projects (`/admin.html`,
`/payment.html`, `/track.html`, …). The full list is in `src/web/pages.ts`.
