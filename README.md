# Bazhanka — shared wishlists with secret gift reservations

**Bazhanka** ("бажанка", from *бажання*, "a wish") is a website where you create a wishlist for an occasion and share **one link**.
Friends reserve gifts from it: other guests see an item as taken, but **the owner never sees who reserved what**, so the surprise survives.
Several friends can **chip in** on one expensive gift, and groups can run a **Secret Santa** where everyone sees only their giftee's list.

It solves two problems for students and their friends:
- givers don't know what to buy, and asking directly ruins the surprise;
- gifts get duplicated because classmates, school friends and family are not in one chat.

Team: Inna Dermanska, Bohdana Skochynska, Ksenia Nimas (UCU).

**Live demo:** https://d1je5vufmmk66c.cloudfront.net (HTTPS; sign up with any email and password) ·
**Repository:** https://github.com/ksuhxx/bazhanka ·
**User testing report:** [`docs/user_feedback_report.pdf`](docs/user_feedback_report.pdf)

## Features

| Feature | Where |
|---|---|
| Sign up / sign in (email + password, httpOnly session cookie) | `/signup`, `/signin` |
| Create wishlists for an occasion and share them by link (copy or Telegram) | `/dashboard`, `/l/<code>` |
| Add an item by pasting a shop link: title, photo and price are filled in automatically when the shop allows it (JSON-LD / Open Graph); otherwise fill the item in by hand | owner view of a list |
| Own photo for a gift: upload from your computer or phone; the browser shrinks it to 1200 px (~100–300 KB) and it is stored in the database, no extra storage service | gift form |
| Secret reservation: guests see "already reserved", the owner sees nothing | guest view of a list |
| Chip in: several guests add amounts to one gift, with a progress bar | items marked "chip-in" |
| Add from any shop with the “+ Bazhanka” browser button (bookmarklet), also where a pasted link can’t be read | `/button`, `/add` |
| Secret Santa: invite link, the organiser draws names, each member sees only their giftee and their list | `/santa` |
| "Gifts I'm giving" across all lists | `/dashboard` |
| In-app feedback button and a metrics page for the validation goals | Feedback button, `/admin` |

## Gift ideas (AI search with partner shops)

Signed-in users open **Gift ideas** (`/ideas`), describe what they like and get real products from online shops, which they can add to a wishlist in one tap.

How it works (`backend/src/discover.js`, `bedrock.js`, `routes/discover.js`):

1. **Search engine (`DISCOVER_PROVIDER`).** Default when `SERPER_API_KEY` is set: **Google Shopping via [serper.dev](https://serper.dev)** (`gl=ua`, Ukrainian). A cheap Nova call without web search only turns the request into 4 Ukrainian product queries (3 direct, 1 adjacent = **Try something new**). Every card is a real Google Shopping listing, so title, link, shop, price and photo belong together and nothing can be invented. If there are too few listings (or partner shops exist), ordinary Google results (`site:partner.ua …`) are opened and checked as page-level fallback: the page must open, be a product page and agree with the title. Etsy/Amazon/eBay are excluded, AliExpress and Temu are allowed. Cost: about 5 Serper queries per fresh search (about $1 per 1000 queries, 2500 free). Set `AWS_SERPER_API_KEY` for `make aws-backend`. The older option `nova` (Bedrock web grounding) is kept for comparison but tends to invent links.
   **Search options on `/ideas`:** a free-text description (several interests are fine), *kind of ideas* (`strict` = only what was asked, `mixed` = default, `surprise` = about half new things), recipient, occasion and a price range. The planner finds every interest, writes at least one query for each plus queries that combine two interests, and results are interleaved query by query so every interest is represented. Each card says which interest it was found for.
2. **Admin → Stats → "AI search tester"** runs the real pipeline with any provider, without the daily limit and cache, and shows the result list plus the debug trail (planned queries, how many listings were dropped and why).
3. Results are cached for 24 h per normalized query and each user has a daily limit of fresh searches (`DISCOVER_DAILY_LIMIT`, default 5), which keeps the AI bill predictable.
4. **Partner shops** (admin page → *Gift ideas: partner shops*) are searched explicitly and ranked higher, always with a visible **Partner** mark. Ranking puts relevance first: a partner only moves up inside its relevance group, so an off-topic partner product never beats a direct match. Partners apply at read time, so pausing or adding one affects cached results at once.
5. The funnel per partner (shown → clicked → added to a list) is counted in `discover_events` and shown in the admin page; it is the evidence to show a shop when selling placement.

Local development without AWS: `DISCOVER_MOCK=true` returns sample offers (including a `partner-shop.example.ua` partner you can add in the admin page).

Cost and AWS notes:

- Web grounding is only available in US regions (this project runs in `us-east-1`) and is billed on top of model tokens; check the [Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/). Amazon's own Nova models are billed as an AWS service, so AWS promotional credits should apply; third-party models (such as Claude) are usually billed through AWS Marketplace, which credits typically do not cover. Confirm under *Billing → Credits* before relying on it.
- The Lambda role gets `bedrock:InvokeModel` and `bedrock:InvokeTool` (see `infra/backend.yml`). Enable access to the Nova model in the Bedrock console if your account asks for it.
- On AWS, gift ideas and link preview are served by a separate **edge Lambda outside the VPC**, so it reads shop pages and calls Bedrock over the normal internet: no NAT gateway and no VPC endpoint, nothing extra to pay. See [Deploy on AWS](#deploy-on-aws) for how it reaches the database.
- CloudFront waits up to 60 s for the API (`OriginReadTimeout` in `infra/frontend.yml`) because a live search can take 20–40 s.
- Paid placement must be clearly labelled as advertising. Check local advertising rules before signing the first partner.

## Repository layout

```
backend/    Node.js + Express API, PostgreSQL (pg). Also serves the built frontend.
  src/index.js           server entry, static hosting, error handling
  src/db.js              connection pool (or RPC mode on AWS) + schema, created automatically on start
  src/dbrpc.js           AWS only: signed SQL calls from the edge Lambda to the main Lambda
  src/auth.js            JWT session cookie, password hashing in routes/auth.js
  src/preview.js         shop link → title/photo/price (with SSRF protection)
  src/discover.js        gift ideas pipeline; src/serper.js (Google Shopping) and src/bedrock.js (Amazon Bedrock) clients
  src/routes/            auth, wishlists/items/reservations, santa, discover, photos, feedback/stats
  test/                  node:test suites (api, dbrpc, discover and photos need Postgres)
frontend/   React 18 + Vite single-page app
  src/pages/             Home, Auth, Dashboard, ListPage (owner + guest), EditItem, Discover, Santa, Admin,
                         AddButton (/button) and AddFromShop (/add) for the "+ Bazhanka" browser button
  src/bookmarklet.js     the "+ Bazhanka" button code (runs on shop pages)
  src/photo.js           shrinks and uploads own gift photos
infra/      Dockerfile, docker-compose.yml (local), render.yaml (Render),
            ecr.yml / backend.yml / frontend.yml / certificate.sh (AWS, driven by the Makefile)
docs/       user testing report (PDF) and its template, AWS deployment report, deploy report, screenshots
```

## Run locally

You need **Node.js 20+** and **PostgreSQL 14+**.

### Option A — Docker (easiest)

```bash
docker compose -f infra/docker-compose.yml up --build
```

Open http://localhost:3000. Sign up with `admin@example.com` to see `/admin`.

### Option B — without Docker

1. Create a database (default URL is `postgres://postgres:postgres@localhost:5432/bazhanka`):

```bash
createdb bazhanka
```

2. Start the API (tables are created automatically):

```bash
cd backend && npm install && ADMIN_EMAILS=you@example.com npm run dev
```

3. In a second terminal start the frontend with hot reload (proxies `/api` to port 3000):

```bash
cd frontend && npm install && npm run dev
```

Open http://localhost:5173.

### Tests

```bash
cd backend && npm test
```

The tests start the server against your local database and cover sign-up/sign-in, secret reservations (the owner must not see them),
chip-in, Secret Santa draws and admin access.

## Configuration

All configuration is via environment variables (see `backend/.env.example`):

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes in prod | PostgreSQL connection string |
| `DATABASE_SSL` | no | `true` for hosted Postgres reached over the internet (Neon, Supabase) |
| `JWT_SECRET` | **yes in prod** | secret used to sign session cookies |
| `ADMIN_EMAILS` | no | comma-separated emails allowed to open `/admin` |
| `DONATION_URL` | no | Monobank jar to support the project (footer and dashboard); overrides the link in `backend/src/routes/misc.js` |
| `DONATION_LABEL` | no | text for that link, default “Support Bazhanka” |
| `PORT` | no | default 3000 |

## Deploy (HTTPS) on AWS — how the live demo runs

The production site runs on AWS in `us-east-1`, described by CloudFormation templates in `infra/` and driven by the `Makefile`
(details and operations: `docs/aws_deployment_architecture_and_operations_report.md`).

```
CloudFront ─┬─ /*  ───────────────────────────────▶ S3 (built frontend)
            ├─ /api/preview, /api/discover/*,
            │  /api/admin/discover-check|run ─────────▶ Lambda bazhanka-edge (no VPC: internet, Bedrock)
            │                                            │ SQL via lambda:Invoke (HMAC-signed)
            └─ other /api/*, /healthz ────────────▶ Lambda bazhanka-backend (in the VPC)
                                                         │ TCP 5432, SSL
                                                         ▼
                                                  Aurora Serverless v2 PostgreSQL (private)
```

Why two functions: Aurora is private, so the main function has to run inside the VPC, and a VPC Lambda gets no internet access
without a NAT gateway (about $32/month) or VPC endpoints (about $7/month each). The routes that need the internet run in the
edge function outside the VPC instead. Both functions are built from the same image. The edge function has no route to the
database; it sends each query to the main function with `lambda:Invoke` (`DB_MODE=rpc`, `backend/src/dbrpc.js`). The main
function accepts those calls on `/internal/db` only as invoke events (not as HTTP requests through its Function URL), and only
with a fresh HMAC signature made with a key derived from `JWT_SECRET`. Routes that need a transaction (Secret Santa,
reservations) always stay on the main function. The database is never opened to the internet.

Cost: the edge function and the invokes fit in the Lambda free tier (1M requests and 400,000 GB-s per month), so this costs
nothing extra. What you still pay for: Aurora storage and the time it is awake (it pauses after 5 idle minutes), and Bedrock
tokens and web grounding for each fresh gift-idea search (capped by `DISCOVER_DAILY_LIMIT`).

Set-up: put `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DB_PASSWORD` (long random, letters/digits/`_`/`-` only) and
`AWS_JWT_SECRET` (at least 16 characters) in a `.env` file in the repository root. It is gitignored: never commit it. Optional:
`AWS_ADMIN_EMAILS`, `AWS_DONATION_URL`, `AWS_FRONTEND_DOMAIN` (custom domain with a Route 53 zone; run `make aws-frontend-cert`
once). The Makefile needs `make`, `docker` and a POSIX shell. On Windows it uses Git Bash from `C:\Program Files\Git`; if Git
lives elsewhere, add for example `GIT_BASH=d:/Git/bin/bash.exe` to `.env`.

```bash
make aws-db-snapshot
```

```bash
make aws-plan-backend
```

```bash
make aws-deploy
```

`aws-db-snapshot` keeps a manual Aurora snapshot (do it before any infrastructure change; the cluster also has
`DeletionPolicy: Snapshot`). `aws-plan-backend` shows what the backend update would change without applying it: no database resource
may say `Replacement: True`. `aws-deploy` pushes the image, updates the backend stack (both functions) and then the frontend
stack and files. Logs: `make aws-logs` (main function) and `make aws-logs-edge` (preview and gift ideas).

## Alternative: deploy on Render (free tier)

Not what the live demo uses, but the quickest way to run your own copy with HTTPS.

The app is a single Docker service plus a Postgres database, described in `infra/render.yaml`.

1. Push this repository to GitHub.
2. In [Render](https://render.com): **New → Blueprint**, pick the repo, set **Blueprint Path** to `infra/render.yaml`.
3. When asked, fill in `ADMIN_EMAILS` (your team's emails) and optionally `DONATION_URL`.
4. Deploy. Render builds `infra/Dockerfile`, creates the database, generates `JWT_SECRET`, and gives you
   `https://bazhanka-xxxx.onrender.com` with HTTPS. The schema is created on first start.

Notes: the free web service sleeps after ~15 minutes idle (the first request then takes ~30–50 s — open it before a demo);
Render's free Postgres expires after 30 days, so for longer use point `DATABASE_URL` at a free [Neon](https://neon.tech) database with `DATABASE_SSL=true`.

**Any other host** that runs Docker works the same way (Fly.io, Railway, a VPS behind Caddy):

```bash
docker build -f infra/Dockerfile -t bazhanka .
```

```bash
docker run -p 3000:3000 -e DATABASE_URL=... -e JWT_SECRET=... bazhanka
```

## Measuring the validation goals

Sign in with an email listed in `ADMIN_EMAILS` and open `/admin`. It shows, live, the goals from our one-pager:
sign-ups (goal 50), wishlists (20), % of guests who reserved (≥ 30%), % of guests who created their own list (≥ 15%),
% of users who came back on another day (≥ 40%), and Secret Santa groups drawn (3), plus all feedback sent through the Feedback button.

## Privacy and security notes

- Reservation data is never sent to the list owner's browser; it's filtered on the server, not hidden in the UI.
- Passwords are hashed with bcrypt; sessions are signed httpOnly, SameSite=Lax cookies (Secure in production).
- The link-preview fetcher refuses private/internal addresses and limits redirects, time and size.
- Some shops block automated requests, and our link preview deliberately does not pretend to be a browser. For those shops
  the form points to the **“+ Bazhanka” browser button** (`/button`): a bookmarklet that runs in the person's own browser on the
  product page they already opened, reads the same product data (JSON-LD `Product`, Open Graph / `itemprop` tags, otherwise
  the heading and the biggest picture) and opens `/add` with the form prefilled in a small window over the shop, which closes itself once the gift is added. The shop sees an ordinary visitor; nothing is
  saved until the person presses *Add to list*. Code: `frontend/src/bookmarklet.js`, pages `AddButton.jsx` and `AddFromShop.jsx`.
