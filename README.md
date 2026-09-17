# Job Application Tracker

A single-user job search tracker: applications, interview rounds, networking contacts, and a dashboard that tells you what to do today. Node.js + Express + SQLite on the back end, a dependency-free vanilla-JS single-page app on the front end. Dark mode, works on desktop and mobile, deploys as a single container.

> **Note:** this repository ships with fictional sample data so the app is useful the moment you start it. Every company, person, and note in [`seed.js`](seed.js) is made up.

## Run it

```bash
npm install
npm start
# open http://localhost:3000
```

On first run the database is created at `./data/tracker.db` and seeded with the sample data. Delete the `data/` folder to start from scratch. Sample dates are generated relative to the day you run it, so the dashboard and charts always look current.

## Features

**Dashboard** — stat cards (applied, companies interviewed, interviews completed, in progress, closed), interview/offer/response rates, and a Today's Actions panel that merges hard deadlines (interviews today, follow-ups you scheduled) with generated suggestions: post-interview follow-ups, silent applications, contacts going cold, aging saved jobs, and pipeline pace. Suggestions can be dismissed (dismissals expire after two weeks). An Upcoming Events panel looks forward, and a velocity chart plots applications or interviews over five time ranges as bars or a line — hand-rolled SVG, no chart library.

**Applications** — sortable table or drag-and-drop kanban, filters across six fields, bulk status changes and deletes, CSV export of the filtered view, and a resizable detail drawer with inline editing, interview prep notes, an interview log, an activity timeline, and matching networking contacts.

**Interviews** — every round grouped by company (names are normalized, so "Acme" and "Acme.ai" stay together), with dates, times, interviewers, outcomes, and expandable notes.

**Networking** — contacts with status badges, active contacts pinned to the top, filtering and sorting.

**Saved Jobs** — bookmark postings to apply to later; one click converts a saved job into a tracked application.

**Role Fit** — paste a job description and get a streaming, calibrated read on how well your background fits it: a verdict, where you align, where you would be ramping, and what to raise in a first conversation. It runs on the Anthropic API against a fixed record of your background, so it cannot invent experience you do not have, and it is instructed to name a bad match as a bad match. Any read can be filed against an application or a saved job. Off by default — see setup below.

**Throughout** — global search across every record type with keyboard navigation, `N` / `/` keyboard shortcuts, JSON export/import for backups, and an installable PWA manifest.

## Architecture

| | |
|---|---|
| `server.js` | Express API, SQLite schema and migrations, seeding, dashboard aggregation, optional auth |
| `seed.js` | Sample data inserted on first run |
| `public/app.js` | The entire SPA — routing, rendering, state. No build step, no framework |
| `public/style.css` | Design tokens and layout, responsive at a 768px breakpoint |

There is no build step and no client-side dependency: `index.html` loads one script and one stylesheet. The only runtime dependencies are `express` and `better-sqlite3`.

### API

REST under `/api`:

- `GET/POST /api/applications`, `GET/PUT/DELETE /api/applications/:id`
- `GET/POST /api/applications/:id/activity`
- `GET/POST /api/networking`, `GET/PUT/DELETE /api/networking/:id`
- `GET/POST /api/interviews`, `GET/PUT/DELETE /api/interviews/:id`
- `GET/POST /api/saved-jobs`, `PUT/DELETE /api/saved-jobs/:id`, `POST /api/saved-jobs/:id/apply`
- `GET /api/analyze/status`, `POST /api/analyze` — Role Fit analyzer (streams `text/plain`)
- `GET /api/dashboard` — every summary statistic in one call
- `GET /api/export` / `POST /api/import` — full JSON backup and restore

Status changes are written to an activity log automatically, and logging an interview round flags the application as having landed an interview.

## Deploying

The included `Dockerfile` runs anywhere containers do. On Railway:

1. Create a project from this repo — the Dockerfile is detected automatically.
2. Add a volume mounted at `/data` so the SQLite file survives deploys.
3. Generate a domain. `PORT` is read from the environment and defaults to 3000.

### Role Fit analyzer

The analyzer needs two things, and stays disabled until it has both:

1. **A profile.** Copy `profile.example.js` to `profile.js` and fill in your own background. The only required export is `buildSystemPrompt()`. Your real `profile.js` is gitignored.
2. **An API key.** Set `ANTHROPIC_API_KEY` ([console.anthropic.com](https://console.anthropic.com)).

The Role Fit page tells you which of the two is missing. Requests are capped at 30 per hour as a cost guard, and pasted postings are treated as untrusted data, so instructions hidden inside a job description are ignored rather than followed.

### Password protection

The app has no login by default. Set `AUTH_PASSWORD` (and optionally `AUTH_USER`, default `admin`) to require HTTP Basic Auth on every request — worth doing before putting a real job search on the public internet.

## License

MIT
