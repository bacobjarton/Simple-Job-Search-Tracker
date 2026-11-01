# Job Tracker

A hosted, multi-user job search tracker: applications, interview rounds, networking contacts, and a dashboard that tells you what to do today. Node.js 20 + Express + SQLite on the back end, a dependency-free vanilla-JS app on the front end. Sign-in is an email magic link (and Google, when configured). Plans, Role Fit quotas, and Stripe billing are enforced on the server.

> **Note:** fictional sample data ships in [`seed.js`](seed.js) so a local database is useful the moment you start it. Every company, person, and note in that file is made up. The sample is attached to the demo account, not shared across users.

## Run it

```bash
npm install
npm start
# open http://localhost:3000
```

`/` is the public landing page. The tracker lives at `/app`.

On first run the database is created at `./data/tracker.db` (or `/data/tracker.db` when that directory is writable) and, unless you opt out, seeded for `demo@localhost`. Delete the `data/` folder to start over. Sample dates are generated relative to the day you run it.

Sign-in emails use the `console` provider until you set a real one: the magic link is printed in the server log. Set `AUTH_DEBUG_RETURN_LINK=1` (ignored when `NODE_ENV=production`) if you want the login page to show the link as well.

```bash
npm test   # isolation, plan limits, and the Stripe webhook
```

## Features

**Dashboard** — stat cards (applied, companies interviewed, interviews completed, in progress, closed), interview/offer/response rates, and a Today's Actions panel that merges hard deadlines with generated suggestions. Suggestions can be dismissed (dismissals expire after two weeks, per account). An Upcoming Events panel looks forward, and a velocity chart plots applications or interviews over five time ranges.

**Applications** — sortable table or drag-and-drop kanban, filters, bulk status changes and deletes, CSV export of the filtered view, and a detail drawer with inline editing, interview prep notes, an interview log, an activity timeline, and matching networking contacts. The free plan stops at 25 applications. Existing rows stay readable and editable.

**Interviews** — every round grouped by company, with dates, times, interviewers, outcomes, and expandable notes.

**Networking** — contacts with status badges, active contacts pinned to the top, filtering and sorting.

**Saved Jobs** — bookmark postings to apply to later. One click converts a saved job into a tracked application (this counts toward the application cap).

**Role Fit** — paste a job description and get a streaming read on how well your saved background fits it. The posting and the background are sent to Anthropic for that request. Each account has a monthly quota, an hourly limit, and the whole site has a daily cap. Usage, including token counts, is stored per user. Any read can be filed against an application or a saved job.

**Insights** — which strategies are converting: referral versus cold, source end to end, whether your priority rating predicts outcomes, and whether knowing someone at the company helps.

**Account** — plan, usage, Stripe checkout, the customer portal, JSON export/import of your own data, and account deletion.

**Admin** — `ADMIN_EMAIL` can open an admin view of users, plans, and Role Fit usage. That view does not include notes or resumes.

## Plans

| Plan | Price | Applications | Role Fit / month |
|---|---|---|---|
| Free | $0 | 25 | 3 |
| 90-day pass | $19 once | unlimited while `access_until` is in the future | 100 |
| Monthly | $9 / month | unlimited while the subscription period is active | 100 |
| Lifetime | $49 once | unlimited | 100 |

The lifetime offer turns off after 50 sales (`LIFETIME_DEAL_LIMIT`). A sale still counts if the buyer later deletes their account. Admins skip the application cap and use the paid Role Fit quota. Numbers above are the defaults; see the env vars.

There is also a per-user hourly Role Fit limit (default 10) and a global daily cap (default 500), both counted in `APP_TIMEZONE`.

Compared with published list prices: Teal $29 / 30 days, Huntr $40 / month, Simplify $39.99 / month. Those prices belong to those products and change.

## Architecture

| | |
|---|---|
| `server.js` | Express API, SQLite schema and migration, sessions, billing, dashboard aggregation |
| `seed.js` | Fictional sample data for the demo account |
| `public/app.html` + `public/app.js` | The tracker SPA. No build step, no framework |
| `public/landing.html` | Marketing page served at `/` |
| `public/login.html` | Magic-link sign-in |
| `public/terms.html`, `public/privacy.html` | Terms and privacy |
| `test/smoke.js` | Isolation, limits, and webhook coverage |

Runtime dependencies: `express`, `better-sqlite3`, `@anthropic-ai/sdk`, `stripe`.

### API

Authenticated JSON under `/api` (session cookie + `X-CSRF-Token` on any request that changes state):

- `GET/POST /api/applications`, `GET/PUT/DELETE /api/applications/:id`
- `GET/POST /api/applications/:id/activity`
- `GET/POST /api/networking`, `GET/PUT/DELETE /api/networking/:id`
- `GET/POST /api/interviews`, `GET/PUT/DELETE /api/interviews/:id`
- `GET/POST /api/saved-jobs`, `PUT/DELETE /api/saved-jobs/:id`, `POST /api/saved-jobs/:id/apply`
- `GET /api/analyze/status`, `POST /api/analyze` — Role Fit (streams `text/plain`)
- `GET/PUT/DELETE /api/profile`
- `GET /api/insights`, `GET /api/dashboard`
- `GET /api/export`, `POST /api/import` — this account only
- `GET /api/auth/me`, `POST /api/auth/logout`, `DELETE /api/account`
- `GET /api/billing/status`, `POST /api/billing/checkout`, `POST /api/billing/portal`
- `GET /api/admin/overview` — admin only

Public:

- `POST /api/auth/magic-link`, `GET /api/auth/verify`
- `GET /api/auth/google`, `GET /api/auth/google/callback` (when configured)
- `GET /api/billing/catalog`, `GET /api/health`
- `POST /api/stripe/webhook` — raw body, Stripe signature, test mode only

Every job-search row is stored with `user_id`. Reads, writes, export, and import filter on the session user. Import assigns new ids so one account cannot collide with another. A shared `profile.js` is not applied to every customer; set `ANALYZER_PROFILE_FILE=1` only for a single-operator install where that file should win over the saved background.

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | Listen port. Default `3000`. |
| `DATA_DIR` | Directory for `tracker.db`. Default: `/data` when that path is writable, otherwise `./data`. |
| `APP_BASE_URL` | Public origin, no trailing slash. Used for magic links, OAuth redirects, and Stripe return URLs. Required in production. |
| `APP_TIMEZONE` | IANA name (`America/Los_Angeles`). Falls back to `TZ`, then server local time. Drives "today", the Role Fit month, and the global daily cap. |
| `COOKIE_SECURE` | `1` or `0`. Default: secure when `APP_BASE_URL` is `https://` or `NODE_ENV=production`. |
| `NODE_ENV` | `production` skips demo seed unless `SEED_DEMO=1`, and refuses `AUTH_DEBUG_RETURN_LINK`. |
| `ADMIN_EMAIL` | This address is an admin (promoted on sign-in and at startup if the user already exists). |
| `MIGRATION_OWNER_EMAIL` | Required once, when booting a database that still has rows and no `user_id`. See migration below. |
| `SEED_DEMO` | `0` never seeds. `1` seeds an empty database. Unset: seed unless `NODE_ENV=production`. |
| `SEED_DEMO_EMAIL` | Demo account. Default `demo@localhost`. |
| `EMAIL_PROVIDER` | `console` (default), `resend`, or `webhook`. If unset and `RESEND_API_KEY` is set, provider is `resend`. |
| `RESEND_API_KEY` | Resend API key. |
| `EMAIL_FROM` | From address Resend will accept, for example `Job Tracker <hello@yourdomain.com>`. |
| `EMAIL_WEBHOOK_URL` | JSON POST target when `EMAIL_PROVIDER=webhook`. Body is `{ to, subject, text, html }`. |
| `EMAIL_WEBHOOK_TOKEN` | Optional bearer token for that webhook. |
| `AUTH_DEBUG_RETURN_LINK` | `1` returns the magic link in the login response. Ignored when `NODE_ENV=production`. |
| `MAGIC_LINK_EMAIL_LIMIT` | Links per email per hour. Default `5`. |
| `MAGIC_LINK_IP_LIMIT` | Links per IP per hour. Default `30`. |
| `GOOGLE_CLIENT_ID` | Google OAuth client id. Both id and secret must be set or the button stays hidden. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. |
| `ANTHROPIC_API_KEY` | Enables Role Fit. |
| `ANALYZE_MODEL` | Default `claude-sonnet-5`. |
| `ANALYZER_PROFILE_FILE` | `1` lets `./profile.js` override every user's saved background. Leave unset on a hosted deploy. |
| `APPLICATION_LIMIT_FREE` | Default `25`. |
| `ANALYZE_QUOTA_FREE` | Role Fit reads per month on the free plan. Default `3`. |
| `ANALYZE_QUOTA_PAID` | Role Fit reads per month on pass, subscription, lifetime, and admin. Default `100`. |
| `ANALYZE_HOURLY_LIMIT` | Per user, per rolling hour. Default `10`. |
| `ANALYZE_GLOBAL_DAILY_CAP` | All users, per calendar day in `APP_TIMEZONE`. Default `500`. |
| `PASS_DURATION_DAYS` | Default `90`. |
| `LIFETIME_DEAL_LIMIT` | Default `50`. Checkout refuses new lifetime sessions at the cap. A session already paid is still honored. |
| `PRICE_PASS_CENTS` | Display only. Default `1900`. |
| `PRICE_SUB_CENTS` | Display only. Default `900`. |
| `PRICE_LIFETIME_CENTS` | Display only. Default `4900`. |
| `STRIPE_SECRET_KEY` | Must be `sk_test_...`. Live keys are refused. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/stripe/webhook`. |
| `STRIPE_PRICE_PASS` | Price id for the $19 one-time pass. |
| `STRIPE_PRICE_SUBSCRIPTION` | Price id for the $9 / month subscription. |
| `STRIPE_PRICE_LIFETIME` | Price id for the $49 lifetime product. Omit to hide the offer. |
| `PRIVACY_EMAIL` | Contact address on the terms and privacy pages. Falls back to `ADMIN_EMAIL`. |

`AUTH_PASSWORD` and `AUTH_USER` are ignored. The old shared Basic Auth login is gone.

## Stripe (test mode)

Create these in the Stripe **test mode** dashboard. Do not use live mode; the server rejects `sk_live_` keys and `livemode: true` webhooks.

1. **Product** "Job Tracker 90-day pass". One-time price, **$19.00 USD**. Copy the price id into `STRIPE_PRICE_PASS`.
2. **Product** "Job Tracker Monthly". Recurring price, **$9.00 USD / month**. Copy the price id into `STRIPE_PRICE_SUBSCRIPTION`.
3. **Product** "Job Tracker Lifetime" (optional). One-time price, **$49.00 USD**. Copy the price id into `STRIPE_PRICE_LIFETIME`. Leave it unset and the offer stays disabled. The app stops selling it after `LIFETIME_DEAL_LIMIT` completed checkouts (default 50).
4. **Customer portal**: Settings → Billing → Customer portal, enable it in test mode so "Billing portal" can cancel a subscription.
5. **Webhook** endpoint `https://YOUR_DOMAIN/api/stripe/webhook`. Subscribe to:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   Put the signing secret in `STRIPE_WEBHOOK_SECRET`.

Checkout writes `user_id` and `product` (`pass`, `subscription`, or `lifetime`) on the session metadata, and on the subscription metadata for the monthly plan. The webhook is idempotent on the Stripe event id.

Local webhook forwarding, against the test secret:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Use Stripe's test cards. No live charges are possible while the secret key is `sk_test_`.

## Google sign-in

In Google Cloud Console, create an OAuth web client. Authorized redirect URI:

```
https://YOUR_DOMAIN/api/auth/google/callback
```

Scopes used: `openid`, `email`, `profile`. The email must be verified. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Until both are set, the login page only offers the magic link.

## Deploy and migration

The included `Dockerfile` runs anywhere containers do. Keep the SQLite file on a persistent volume mounted at `/data`. `PORT` is read from the environment.

**First deploy of this version onto a database that already has data** (the single-user file at `/data/tracker.db`):

1. Set `MIGRATION_OWNER_EMAIL` to the email address that should own every existing application, contact, interview, saved job, note, dismissal, and Role Fit background. The server refuses to start if it finds rows with no `user_id` and this variable is missing, and it does not modify the file in that case.
2. Set `ADMIN_EMAIL` to the same address if that person should also see the admin view.
3. Set `SEED_DEMO=0` so the fictional sample is not inserted beside the real rows.
4. Set `APP_BASE_URL`, the email provider, and the Stripe test-mode variables.
5. Deploy. On boot the server rebuilds the data tables with `user_id`, copies every existing row onto that owner, and logs the user id. Sign in as that email with a magic link. New accounts start empty.
6. After a successful boot you can leave `MIGRATION_OWNER_EMAIL` set; it is only read when the old shape is still present.

Take a copy of `/data/tracker.db` before that first boot. The migration runs in a transaction. A failed migration leaves the previous tables in place and exits non-zero.

New empty databases do not need `MIGRATION_OWNER_EMAIL`.

### Role Fit

1. Each user pastes a background on the Role Fit page (at least 200 characters). It is stored on their row.
2. Set `ANTHROPIC_API_KEY`.

`profile.js` (see `profile.example.js`) is only used when `ANALYZER_PROFILE_FILE=1`. Do not turn that on for a multi-user host: it would apply one background to every account.

Requests that fail before the model is called do not consume quota. A dry-run mode exists for tests (`ANALYZE_DRY_RUN=1` and `NODE_ENV=test`) and is ignored otherwise.

### Timezone

Set `APP_TIMEZONE` to an IANA name so "today", follow-ups, and the Role Fit month follow the operator's day rather than UTC.

## Privacy

The terms (`/terms`) and privacy policy (`/privacy`) state that a Role Fit request sends the pasted posting and the saved background to Anthropic, that export downloads only the caller's data, and that deleting an account removes their rows. A lifetime sale keeps the email on the sale record so the 50-seat cap cannot be reset by deleting the account.

## License

MIT
