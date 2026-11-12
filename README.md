# Affilink — Affiliate Program Directory

A complete affiliate program discovery platform for creators, publishers and brands. Affilink lets creators search and compare affiliate programs, save a shortlist, track applications, and gives brands a dashboard to submit and manage listings — with an admin review workflow on top.

**Real program data.** The directory lists 31 real, currently open affiliate programs (Amazon Associates, Shopify, Semrush, Booking.com, Hostinger, HubSpot and more). Every listing links to the brand's official affiliate application page and stores the date its commission, cookie and payout terms were checked, plus the source URL shown on the detail page. Where a brand does not publish a figure the listing says “Not published” instead of guessing. Accounts, reviews, testimonials and the two demo brand listings are clearly marked demo data; Affilink is not affiliated with or endorsed by any listed brand.

---

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | HTML5, CSS3, vanilla JS (ES modules), Bootstrap 5.3, Bootstrap Icons |
| Animation | GSAP 3 + ScrollTrigger (CDN) |
| Backend | Node.js 22+ with Express 4 |
| Database | SQLite via the built-in `node:sqlite` driver (`DatabaseSync`), WAL mode, foreign keys on |
| Auth | Email + password, `scrypt` hashing, server-side sessions in an HTTP-only cookie |
| SEO | Server-rendered `<title>`, meta description, canonical, Open Graph, JSON-LD, `sitemap.xml`, `robots.txt` |

No frontend framework, no build step, no external database service required.

---

## Run it

```bash
npm install          # express only
npm start            # http://localhost:3000
```

The database is created and seeded automatically on first boot (`data/affilink.db`).

```bash
npm run db:seed      # seed if empty
npm run db:reset     # wipe and reseed
npm test             # end-to-end smoke test on a throwaway DB (port 3100)
```

Environment variables: `PORT` (default `3000`), `DB_PATH`, `SITE_URL` (used for canonical URLs and the sitemap).

### Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Creator | `creator@affilink.demo` | `Creator123!` |
| Brand | `brand@affilink.demo` | `Brand123!` |
| Admin | `admin@affilink.demo` | `Admin123!` |

### Changing the brand

The working name "Affilink" is centralised: the wordmark lives in `components/header.html` and `components/footer.html`, the logo marks are `assets/images/favicon.svg` and `assets/logos/affilink.svg`, and the accent colour is the `--accent` token in `assets/css/main.css`. Strings like page titles are rendered by `server.js`.

---

## Features

### Public site

- **Homepage** — hero search with category filter, live demo statistics, featured programs, 12 category tiles, trending + recently added programs, how-it-works, for-brands panel, testimonials, FAQ, CTA band.
- **Directory** (`/programs`) — search by brand/keyword, filter by category, commission type, minimum commission, cookie duration, network and payment method; sort by newest, highest commission, popularity or A–Z; pagination; grid/list toggle. All filters combine and are reflected in the URL.
- **Program detail** (`/programs/:slug`) — commission structure (including tiers), cookie window, minimum payout, payment frequency and methods, network, eligible countries, promotional methods, requirements, brand website, similar programs, live view/click/save counts, approved reviews, review submission, device tracking, outbound click tracking.
- **Categories** (`/categories`), **For brands** (`/for-brands`), **Resources** (`/resources`), **About**, **Contact** (working form), **Privacy**, **Terms**, custom **404**.

Applications always link to the brand's official signup URL — Affilink never approves anyone into an external program.

### Authentication

Sign up (creator or brand), login, logout, forgot password, reset password, change password. Passwords are hashed with `scrypt`; sessions are random tokens stored server-side in an HTTP-only, SameSite=Lax cookie (Secure behind HTTPS). Password resets expire after one hour, are single-use, and invalidate existing sessions. Login is rate-limited.

### Creator dashboard (`/dashboard`)

Overview (saved count, application statuses, recent/recommended/viewed programs), Saved Programs, My Applications (track, edit status/date/notes, delete, open the official application page), **My Affiliate Links** (create your own tracked links to Amazon, Etsy, Booking.com or any brand using your own affiliate URL), Profile (name, photo URL, links, niche, audience size, country, promotional methods, bio), Account Settings (change password, session info, JSON data export, logout).

### Brand dashboard (`/brand/dashboard`)

Overview (listed programs, views, outbound clicks, click-through rate, 14-day chart, recent reviews), My Programs (status, edit, delete, analytics), Add New Program (`/brand/programs/new`), Edit Program (`/brand/programs/:id/edit`, resubmits for review), Listing Analytics (per-program 30-day views/clicks, saves, CTR), Account Settings (brand profile + password).

### Creator-owned affiliate links

Creators can publish their own affiliate links without waiting for a brand listing. In **My Affiliate Links** they pick a preset (Amazon, Etsy, Booking.com, Fiverr, Shopify) or any brand, paste the affiliate URL they were issued, and Affilink returns a short `/go/<slug>` link.

- `GET /go/:slug` increments the click counter and redirects (302) to the creator's URL exactly as supplied — Affilink never injects or rewrites tracking.
- Links can be edited, paused (the short URL then 404s) or deleted; click totals are private to the owner.
- Only `http(s)` URLs are accepted. The brand pays the creator directly; Affilink does not handle commissions.

### Admin dashboard (`/admin`)

Overview with the pending queue, program management (approve/reject with reason, feature/unfeature, inline edit, delete, search + status filter), user management (suspend/reactivate/delete, protected admin accounts), category management, testimonial management, creator review moderation, homepage content editing, contact messages, and platform analytics (traffic, signups, submissions, top categories, networks).

### Roles and security

- Server-side role guards on every API (`creator`, `brand`, `admin`) and on every dashboard page.
- State-changing requests from a foreign origin are rejected; cookies are HTTP-only and SameSite=Lax.
- All SQL uses prepared statements. User input is length-limited and cleaned.
- Unified field-level validation on the server with matching client-side validation.
- Analytics views are deduplicated per visitor for 12 hours and exclude admins and the owning brand.

---

## Project structure

```
server.js                 Express app, page router, SEO meta injection, sitemap, robots
src/
  db.js                   Schema, indexes, query helpers
  seed.js                 8 categories, 31 real programs + 2 demo listings, users, demo activity
  real-programs.js        Real program dataset with official application + verification URLs
  security.js             scrypt hashing, tokens, validation helpers
  auth.js                 Sessions, auth middleware, origin check
  programs.js             Program query builder, facets, serialization, stats
  validate.js             Program submission validation + slug generation
  routes/                 public, auth, creator, brand, admin APIs
components/
  head.html               Shared <head> (meta, CDN CSS, design system)
  header.html             Sticky header with server-injected auth area
  footer.html             Shared footer
pages/                    index, programs, program-details, categories, for-brands,
                          resources, login, register, forgot/reset password,
                          creator-dashboard, brand-dashboard, add-program,
                          admin-dashboard, about, contact, privacy, terms, 404
assets/
  css/main.css            Design system, components, dashboards, responsive rules
  js/app.js               API client, toasts, form helpers, cards, save/apply, animations
  js/*.js                 Page controllers + dependency-free SVG chart helper
  logos/                  Generated brand monogram SVGs (placeholder assets, not brand logos)
  images/                 Favicon and Open Graph cover
scripts/
  seed.js, reset.js, smoke-test.js
data/                     SQLite database + server log (gitignored)
```

### Database

`users`, `creator_profiles`, `brand_profiles`, `categories`, `affiliate_programs`, `creator_offers`, `saved_programs`, `applications`, `program_views`, `outbound_clicks`, `reviews`, `featured_programs`, `testimonials`, `site_content`, `contact_messages`, `sessions`, `password_resets` — with foreign keys, check constraints, uniqueness rules and indexes on the columns used for filtering and sorting.

---

## Testing

`npm test` boots the real server against a temporary database and runs 96 checks over HTTP, covering:

- directory search, combined filters, sorting and pagination
- view/click analytics increments
- registration, duplicate/invalid input, login, session resolution, password reset
- saved programs, application tracking and profile persistence
- brand submission → pending state → edit → admin approval → public visibility → sitemap inclusion
- admin rejection rules, user suspension, category/testimonial/content management, review moderation
- role-based API denial, cross-origin blocking, guest redirects for protected pages
- every page rendering with SEO metadata

The temporary database is deleted afterwards.

`npm run test:ui` loads every page in jsdom, executes the real page modules against the running server, and asserts that dynamic content rendered without console or runtime errors — including dashboard tab switching, tables, charts, the program form's live preview, and the filters drawer.

`node scripts/screenshots.js` (optional) captures the key pages at desktop and mobile widths with a headless Chromium via Playwright:

```bash
npx playwright install chromium
node scripts/screenshots.js http://127.0.0.1:3000 artifacts
```

Current review screenshots live in [`artifacts/`](artifacts): homepage, directory (grid and list), program detail, login, creator dashboard, brand dashboard, admin, and mobile home/directory.
