# Job Application Tracker — PUBLIC demo

This repository is **public and MIT-licensed**. It is a portfolio/demo build of
the job tracker, and everything in it is safe to share.

## Hard rules

- **`seed.js` must contain only fictional data.** Every company, person, and
  note in it is invented. It carries this sentinel line, which must never be
  removed — a local pre-push hook blocks the push if it goes missing:

  `Every company, person, and note below is fictional.`

- **Never import, paste, or commit real job-search data** into this repo: no
  real recruiter or interviewer names, no real salary figures, no notes about
  real people, and no seed file copied from a private counterpart.
- **Never commit `data/`, `*.db`, or a JSON export.** They are gitignored;
  keep it that way.
- Before committing anything that touches `seed.js`, confirm the names in it
  are fictional.

## Sample data

Sample dates are generated relative to the day the app is first run, so the
dashboard, follow-ups, and charts always look current instead of frozen. See
the `day()` helper at the top of `seed.js`.

## Local development

- Runs on **port 3000** (`npm start`, then <http://localhost:3000>).
- The database is created at `./data/tracker.db` on first run and seeded from
  `seed.js`. Delete `data/` to reseed.

## Architecture notes

No build step and no client-side dependencies: `public/index.html` loads one
script and one stylesheet. Runtime dependencies are only `express` and
`better-sqlite3`. `public/app.js` is the entire SPA — routing, rendering, and
state. Keep it that way; adding a bundler would defeat the point of the project.
