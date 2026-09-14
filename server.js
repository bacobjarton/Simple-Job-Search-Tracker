const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const seed = require('./seed');

const PORT = process.env.PORT || 3000;

// /data is the Railway volume mount; fall back to ./data for local dev.
function resolveDataDir() {
  try {
    if (fs.existsSync('/data')) {
      fs.accessSync('/data', fs.constants.W_OK);
      return '/data';
    }
  } catch (e) { /* not writable, fall through */ }
  const local = path.join(__dirname, 'data');
  fs.mkdirSync(local, { recursive: true });
  return local;
}

const dbPath = path.join(resolveDataDir(), 'tracker.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  applied_date TEXT,
  priority TEXT,
  location_type TEXT,
  salary_range TEXT,
  source TEXT,
  interview_landed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'In Progress',
  recruiter_contact TEXT,
  followup_date TEXT,
  notes TEXT,
  interview_prep_notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  job_link TEXT
);
CREATE TABLE IF NOT EXISTS networking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT,
  title TEXT,
  how_connected TEXT,
  last_contact_date TEXT,
  followup_date TEXT,
  referred_job INTEGER NOT NULL DEFAULT 0,
  job_link TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Active'
);
CREATE TABLE IF NOT EXISTS interview_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
  company TEXT,
  role TEXT,
  round_number INTEGER,
  interview_type TEXT,
  interview_date TEXT,
  duration_minutes INTEGER,
  interviewers TEXT,
  interviewer_titles TEXT,
  notes TEXT,
  outcome TEXT
);
CREATE TABLE IF NOT EXISTS saved_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  salary_range TEXT,
  location_type TEXT,
  source TEXT,
  priority TEXT,
  job_link TEXT,
  notes TEXT,
  saved_date TEXT
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
  event_date TEXT,
  event_type TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS dismissed_suggestions (
  key TEXT PRIMARY KEY,
  dismissed_at TEXT
);
`);

// Migrations for columns added after first release.
const intCols = db.prepare('PRAGMA table_info(interview_rounds)').all().map(c => c.name);
if (!intCols.includes('interview_time')) {
  db.exec('ALTER TABLE interview_rounds ADD COLUMN interview_time TEXT');
}

// ---------- field definitions / row conversion ----------

const APP_FIELDS = ['company','role','applied_date','priority','location_type','salary_range','source','interview_landed','status','recruiter_contact','followup_date','notes','interview_prep_notes','tags','job_link'];
const NET_FIELDS = ['name','company','title','how_connected','last_contact_date','followup_date','referred_job','job_link','notes','status'];
const INT_FIELDS = ['application_id','company','role','round_number','interview_type','interview_date','interview_time','duration_minutes','interviewers','interviewer_titles','notes','outcome'];
const SAVED_FIELDS = ['company','role','salary_range','location_type','source','priority','job_link','notes','saved_date'];

function appToDb(obj) {
  const out = {};
  for (const f of APP_FIELDS) {
    let v = obj[f];
    if (v === undefined) v = null;
    if (f === 'interview_landed') v = v ? 1 : 0;
    if (f === 'tags') v = JSON.stringify(Array.isArray(v) ? v : (v ? v : []));
    out[f] = v;
  }
  return out;
}
function appFromDb(row) {
  if (!row) return row;
  return { ...row, interview_landed: !!row.interview_landed, tags: safeParse(row.tags) };
}
function safeParse(t) { try { const v = JSON.parse(t); return Array.isArray(v) ? v : []; } catch { return []; } }

function netToDb(obj) {
  const out = {};
  for (const f of NET_FIELDS) {
    let v = obj[f];
    if (v === undefined) v = null;
    if (f === 'referred_job') v = v ? 1 : 0;
    out[f] = v;
  }
  return out;
}
function netFromDb(row) { return row ? { ...row, referred_job: !!row.referred_job } : row; }

function intToDb(obj) {
  const out = {};
  for (const f of INT_FIELDS) out[f] = obj[f] === undefined ? null : obj[f];
  return out;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function logActivity(applicationId, eventType, note, eventDate) {
  db.prepare('INSERT INTO activity_log (application_id, event_date, event_type, note) VALUES (?,?,?,?)')
    .run(applicationId, eventDate || todayISO(), eventType, note || null);
}

// ---------- seed on first run ----------

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM applications').get().c;
  if (count > 0) return;
  const insertApp = db.prepare(`INSERT INTO applications (${APP_FIELDS.join(',')}) VALUES (${APP_FIELDS.map(f => '@' + f).join(',')})`);
  const insertNet = db.prepare(`INSERT INTO networking (${NET_FIELDS.join(',')}) VALUES (${NET_FIELDS.map(f => '@' + f).join(',')})`);
  const insertInt = db.prepare(`INSERT INTO interview_rounds (${INT_FIELDS.join(',')}) VALUES (${INT_FIELDS.map(f => '@' + f).join(',')})`);
  const insertSaved = db.prepare(`INSERT INTO saved_jobs (${SAVED_FIELDS.join(',')}) VALUES (${SAVED_FIELDS.map(f => '@' + f).join(',')})`);
  const run = db.transaction(() => {
    const inserted = [];
    for (const a of seed.applications) {
      const info = insertApp.run(appToDb(a));
      inserted.push({ id: info.lastInsertRowid, company: a.company, role: a.role });
      logActivity(info.lastInsertRowid, 'Applied', `Applied to ${a.role} at ${a.company}`, a.applied_date);
    }
    for (const n of seed.networking) insertNet.run(netToDb(n));
    for (const r of seed.interviews) {
      // Match by company + role, falling back to company only (some seed rounds
      // reference a pivoted role title that differs from the application's role).
      let app = inserted.find(a => a.company === r.company && a.role === r.role)
             || inserted.find(a => a.company === r.company);
      insertInt.run(intToDb({ ...r, application_id: app ? app.id : null }));
    }
    for (const s of seed.savedJobs || []) {
      const row = {};
      for (const f of SAVED_FIELDS) row[f] = s[f] === undefined ? null : s[f];
      insertSaved.run(row);
    }
  });
  run();
  console.log(`Seeded database: ${seed.applications.length} applications, ${seed.networking.length} contacts, ${seed.interviews.length} interview rounds, ${(seed.savedJobs || []).length} saved jobs.`);
}
seedIfEmpty();

// ---------- app / API ----------

const app = express();
app.use(express.json({ limit: '20mb' }));

// Optional HTTP Basic Auth: set AUTH_PASSWORD (and optionally AUTH_USER) to
// require a login. When AUTH_PASSWORD is unset (local dev), no auth is applied.
const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
if (AUTH_PASSWORD) {
  const crypto = require('crypto');
  const safeEqual = (a, b) => {
    const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  };
  app.use((req, res, next) => {
    const hdr = req.headers.authorization || '';
    if (hdr.startsWith('Basic ')) {
      const decoded = Buffer.from(hdr.slice(6), 'base64').toString();
      const idx = decoded.indexOf(':');
      const user = decoded.slice(0, idx), pass = decoded.slice(idx + 1);
      if (safeEqual(user, AUTH_USER) && safeEqual(pass, AUTH_PASSWORD)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Job Tracker", charset="UTF-8"');
    res.status(401).send('Authentication required');
  });
}

app.use(express.static(path.join(__dirname, 'public')));

// --- applications ---

app.get('/api/applications', (req, res) => {
  const rows = db.prepare('SELECT * FROM applications ORDER BY applied_date DESC, id DESC').all();
  res.json(rows.map(appFromDb));
});

app.post('/api/applications', (req, res) => {
  const b = req.body || {};
  if (!b.company || !b.role) return res.status(400).json({ error: 'company and role are required' });
  if (!b.applied_date) b.applied_date = todayISO();
  if (!b.status) b.status = 'In Progress';
  const info = db.prepare(`INSERT INTO applications (${APP_FIELDS.join(',')}) VALUES (${APP_FIELDS.map(f => '@' + f).join(',')})`).run(appToDb(b));
  logActivity(info.lastInsertRowid, 'Applied', `Applied to ${b.role} at ${b.company}`, b.applied_date);
  const row = db.prepare('SELECT * FROM applications WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json(appFromDb(row));
});

app.get('/api/applications/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM applications WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(appFromDb(row));
});

app.put('/api/applications/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM applications WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const cur = appFromDb(existing);
  const merged = { ...cur, ...req.body };
  db.prepare(`UPDATE applications SET ${APP_FIELDS.map(f => `${f}=@${f}`).join(', ')} WHERE id=@id`)
    .run({ ...appToDb(merged), id: existing.id });
  if (req.body.status !== undefined && req.body.status !== cur.status) {
    logActivity(existing.id, 'Status Change', `Status changed from "${cur.status}" to "${req.body.status}"`);
  }
  // Interview rounds keep their own copy of company/role; keep it in sync so a
  // rename doesn't split the company apart on the Interviews tab.
  if (merged.company !== cur.company || merged.role !== cur.role) {
    db.prepare('UPDATE interview_rounds SET company=?, role=? WHERE application_id=?')
      .run(merged.company, merged.role, existing.id);
  }
  const row = db.prepare('SELECT * FROM applications WHERE id=?').get(existing.id);
  res.json(appFromDb(row));
});

app.delete('/api/applications/:id', (req, res) => {
  const info = db.prepare('DELETE FROM applications WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// --- activity log ---

app.get('/api/applications/:id/activity', (req, res) => {
  const rows = db.prepare('SELECT * FROM activity_log WHERE application_id=? ORDER BY event_date DESC, id DESC').all(req.params.id);
  res.json(rows);
});

app.post('/api/applications/:id/activity', (req, res) => {
  const exists = db.prepare('SELECT id FROM applications WHERE id=?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'application not found' });
  const b = req.body || {};
  if (!b.event_type) return res.status(400).json({ error: 'event_type is required' });
  const info = db.prepare('INSERT INTO activity_log (application_id, event_date, event_type, note) VALUES (?,?,?,?)')
    .run(exists.id, b.event_date || todayISO(), b.event_type, b.note || null);
  res.status(201).json(db.prepare('SELECT * FROM activity_log WHERE id=?').get(info.lastInsertRowid));
});

// --- networking ---

app.get('/api/networking', (req, res) => {
  const rows = db.prepare('SELECT * FROM networking ORDER BY last_contact_date DESC, id DESC').all();
  res.json(rows.map(netFromDb));
});

app.post('/api/networking', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  if (!b.status) b.status = 'Active';
  const info = db.prepare(`INSERT INTO networking (${NET_FIELDS.join(',')}) VALUES (${NET_FIELDS.map(f => '@' + f).join(',')})`).run(netToDb(b));
  res.status(201).json(netFromDb(db.prepare('SELECT * FROM networking WHERE id=?').get(info.lastInsertRowid)));
});

app.get('/api/networking/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM networking WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(netFromDb(row));
});

app.put('/api/networking/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM networking WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const merged = { ...netFromDb(existing), ...req.body };
  db.prepare(`UPDATE networking SET ${NET_FIELDS.map(f => `${f}=@${f}`).join(', ')} WHERE id=@id`)
    .run({ ...netToDb(merged), id: existing.id });
  res.json(netFromDb(db.prepare('SELECT * FROM networking WHERE id=?').get(existing.id)));
});

app.delete('/api/networking/:id', (req, res) => {
  const info = db.prepare('DELETE FROM networking WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// --- interview rounds ---

app.get('/api/interviews', (req, res) => {
  const sql = req.query.application_id
    ? db.prepare('SELECT * FROM interview_rounds WHERE application_id=? ORDER BY round_number, interview_date').all(req.query.application_id)
    : db.prepare('SELECT * FROM interview_rounds ORDER BY company, round_number, interview_date').all();
  res.json(sql);
});

app.post('/api/interviews', (req, res) => {
  const b = req.body || {};
  if (!b.application_id) return res.status(400).json({ error: 'application_id is required' });
  const parent = db.prepare('SELECT * FROM applications WHERE id=?').get(b.application_id);
  if (!parent) return res.status(400).json({ error: 'application not found' });
  if (!b.company) b.company = parent.company;
  if (!b.role) b.role = parent.role;
  const info = db.prepare(`INSERT INTO interview_rounds (${INT_FIELDS.join(',')}) VALUES (${INT_FIELDS.map(f => '@' + f).join(',')})`).run(intToDb(b));
  // Logging a round means an interview was landed — keep the application flag
  // in sync (this drift caused companies-interviewed count discrepancies).
  if (!parent.interview_landed) {
    db.prepare('UPDATE applications SET interview_landed=1 WHERE id=?').run(parent.id);
  }
  logActivity(parent.id, 'Interview',
    `Interview round${b.round_number ? ' ' + b.round_number : ''}${b.interview_type ? ` — ${b.interview_type}` : ''} logged`,
    b.interview_date || todayISO());
  res.status(201).json(db.prepare('SELECT * FROM interview_rounds WHERE id=?').get(info.lastInsertRowid));
});

app.get('/api/interviews/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM interview_rounds WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

app.put('/api/interviews/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM interview_rounds WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const merged = { ...existing, ...req.body };
  db.prepare(`UPDATE interview_rounds SET ${INT_FIELDS.map(f => `${f}=@${f}`).join(', ')} WHERE id=@id`)
    .run({ ...intToDb(merged), id: existing.id });
  res.json(db.prepare('SELECT * FROM interview_rounds WHERE id=?').get(existing.id));
});

app.delete('/api/interviews/:id', (req, res) => {
  const info = db.prepare('DELETE FROM interview_rounds WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// --- saved jobs (apply-later list) ---

app.get('/api/saved-jobs', (req, res) => {
  res.json(db.prepare('SELECT * FROM saved_jobs ORDER BY saved_date DESC, id DESC').all());
});

app.post('/api/saved-jobs', (req, res) => {
  const b = req.body || {};
  if (!b.company || !b.role) return res.status(400).json({ error: 'company and role are required' });
  if (!b.saved_date) b.saved_date = todayISO();
  const out = {};
  for (const f of SAVED_FIELDS) out[f] = b[f] === undefined ? null : b[f];
  const info = db.prepare(`INSERT INTO saved_jobs (${SAVED_FIELDS.join(',')}) VALUES (${SAVED_FIELDS.map(f => '@' + f).join(',')})`).run(out);
  res.status(201).json(db.prepare('SELECT * FROM saved_jobs WHERE id=?').get(info.lastInsertRowid));
});

app.put('/api/saved-jobs/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM saved_jobs WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const merged = { ...existing, ...req.body };
  const out = {};
  for (const f of SAVED_FIELDS) out[f] = merged[f] === undefined ? null : merged[f];
  db.prepare(`UPDATE saved_jobs SET ${SAVED_FIELDS.map(f => `${f}=@${f}`).join(', ')} WHERE id=@id`).run({ ...out, id: existing.id });
  res.json(db.prepare('SELECT * FROM saved_jobs WHERE id=?').get(existing.id));
});

app.delete('/api/saved-jobs/:id', (req, res) => {
  const info = db.prepare('DELETE FROM saved_jobs WHERE id=?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// Convert a saved job into a real application and remove it from the saved list.
app.post('/api/saved-jobs/:id/apply', (req, res) => {
  const saved = db.prepare('SELECT * FROM saved_jobs WHERE id=?').get(req.params.id);
  if (!saved) return res.status(404).json({ error: 'not found' });
  const b = {
    company: saved.company, role: saved.role,
    applied_date: (req.body && req.body.applied_date) || todayISO(),
    priority: saved.priority || 'Medium',
    location_type: saved.location_type,
    salary_range: saved.salary_range,
    source: saved.source || 'Other',
    interview_landed: false,
    status: 'In Progress',
    notes: saved.notes, tags: [], job_link: saved.job_link,
  };
  const info = db.prepare(`INSERT INTO applications (${APP_FIELDS.join(',')}) VALUES (${APP_FIELDS.map(f => '@' + f).join(',')})`).run(appToDb(b));
  logActivity(info.lastInsertRowid, 'Applied', `Applied to ${b.role} at ${b.company}`, b.applied_date);
  db.prepare('DELETE FROM saved_jobs WHERE id=?').run(saved.id);
  res.status(201).json(appFromDb(db.prepare('SELECT * FROM applications WHERE id=?').get(info.lastInsertRowid)));
});

// --- dashboard ---

app.get('/api/dashboard', (req, res) => {
  const apps = db.prepare('SELECT * FROM applications').all().map(appFromDb);
  const contacts = db.prepare('SELECT * FROM networking').all().map(netFromDb);
  const rounds = db.prepare('SELECT * FROM interview_rounds').all();
  const savedJobs = db.prepare('SELECT * FROM saved_jobs').all();
  const today = todayISO();
  const ageOf = iso => iso ? Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(iso + 'T00:00:00Z')) / 86400000) : null;
  const total = apps.length;
  const CLOSED = ['Rejected', 'Never Heard Back', 'Withdrawn'];

  const interviewsLanded = apps.filter(a => a.interview_landed).length;
  const companiesInterviewed = new Set(
    apps.filter(a => a.interview_landed).map(a => (a.company || '').trim().toLowerCase())
  ).size;
  // Completed = already happened: dated in the past, or undated with a recorded outcome.
  const interviewsCompleted = rounds.filter(r =>
    (r.interview_date && r.interview_date < today) || (!r.interview_date && r.outcome)
  ).length;
  const inProgress = apps.filter(a => a.status === 'In Progress').length;
  const offers = apps.filter(a => a.status === 'Offer Received').length;
  const closed = apps.filter(a => CLOSED.includes(a.status)).length;
  const pct = n => total ? Math.round((n / total) * 1000) / 10 : 0;

  // velocity: last 12 weeks (Mon-start), applications per week
  const weeks = [];
  const now = new Date(today + 'T00:00:00Z');
  const dow = (now.getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = new Date(now); thisMonday.setUTCDate(now.getUTCDate() - dow);
  for (let i = 11; i >= 0; i--) {
    const ws = new Date(thisMonday); ws.setUTCDate(thisMonday.getUTCDate() - i * 7);
    weeks.push({ week_start: ws.toISOString().slice(0, 10), count: 0 });
  }
  for (const a of apps) {
    if (!a.applied_date) continue;
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (a.applied_date >= weeks[i].week_start) {
        const wEnd = new Date(weeks[i].week_start + 'T00:00:00Z'); wEnd.setUTCDate(wEnd.getUTCDate() + 7);
        if (a.applied_date < wEnd.toISOString().slice(0, 10)) weeks[i].count++;
        break;
      }
    }
  }

  const groupBy = (key) => {
    const m = {};
    for (const a of apps) { const k = a[key] || '—'; m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).map(([k, c]) => ({ key: k, count: c, pct: pct(c) })).sort((x, y) => y.count - x.count);
  };

  // ---- Suggested actions: heuristics over the current pipeline state. ----
  // These are advisory (not stored), distinct from hard followup_date deadlines.
  const suggestions = [];
  const futureRound = id => rounds.some(r => r.application_id === id && r.interview_date && r.interview_date > today);
  const lastRoundDate = id => rounds
    .filter(r => r.application_id === id && r.interview_date && r.interview_date <= today)
    .map(r => r.interview_date).sort().pop();

  // 1. Post-interview follow-up: interviewing, no next round scheduled, gone quiet.
  for (const a of apps) {
    if (a.status !== 'In Progress' || !a.interview_landed || a.followup_date || futureRound(a.id)) continue;
    const last = lastRoundDate(a.id), age = ageOf(last);
    if (age !== null && age >= 4) {
      suggestions.push({ priority: 1, type: 'post_interview', stale: age, kind: 'app', target_id: a.id, icon: '📨',
        title: `Follow up with ${a.company}`,
        detail: `Last interview was ${age} days ago and nothing's scheduled — send a thank-you or status check.` });
    }
  }
  // 2. Awaiting-reply contacts that have gone silent.
  for (const c of contacts) {
    if (c.status !== 'Awaiting Reply' || c.followup_date) continue;
    const age = ageOf(c.last_contact_date);
    if (age === null || age >= 5) {
      suggestions.push({ priority: 2, type: 'awaiting_reply', stale: age == null ? 999 : age, kind: 'net', target_id: c.id, icon: '⏳',
        title: `Nudge ${c.name}`,
        detail: `Awaiting reply${age != null ? ` for ${age} days` : ''}${c.company ? ` at ${c.company}` : ''} — a gentle follow-up keeps it alive.` });
    }
  }
  // 3. Stalled applications: applied, silent, no interview, no follow-up planned.
  //    (45+ days moves to the "mark Never Heard Back" bucket below instead.)
  for (const a of apps) {
    if (a.status !== 'In Progress' || a.interview_landed || a.followup_date) continue;
    const age = ageOf(a.applied_date);
    if (age !== null && age >= 10 && age < 45) {
      suggestions.push({ priority: 3, type: 'stalled_app', stale: age, kind: 'app', target_id: a.id, icon: '🔔',
        title: `Check in on ${a.company}`,
        detail: `Applied ${age} days ago with no response — follow up or find a contact there.` });
    }
  }
  // 4. Long-dead applications: offer one-click cleanup to Never Heard Back.
  for (const a of apps) {
    if (a.status !== 'In Progress' || a.interview_landed || a.followup_date || futureRound(a.id)) continue;
    const age = ageOf(a.applied_date);
    if (age !== null && age >= 45) {
      suggestions.push({ priority: 4, type: 'stale_nhb', stale: age, kind: 'app', target_id: a.id, icon: '🧹', action: 'mark_nhb',
        title: `Mark ${a.company} as Never Heard Back?`,
        detail: `Applied ${age} days ago with no response — clear it out of In Progress.` });
    }
  }
  // 5. Active relationships going cold.
  for (const c of contacts) {
    if (c.status !== 'Active' || c.followup_date) continue;
    const age = ageOf(c.last_contact_date);
    if (age === null || age >= 21) {
      suggestions.push({ priority: 5, type: 'cold_contact', stale: age == null ? 999 : age, kind: 'net', target_id: c.id, icon: '🤝',
        title: `Reconnect with ${c.name}`,
        detail: age === null ? `No contact logged yet${c.company ? ` at ${c.company}` : ''} — reach out to keep it warm.` : `${age} days since you last connected${c.company ? ` at ${c.company}` : ''}.` });
    }
  }
  // 6. Saved jobs sitting unapplied.
  for (const s of savedJobs) {
    const age = ageOf(s.saved_date);
    if (age !== null && age >= 7) {
      suggestions.push({ priority: 6, type: 'saved_aging', stale: age, kind: 'saved', target_id: s.id, icon: '🔖',
        title: `Apply to ${s.company} or drop it`,
        detail: `Saved ${age} days ago${s.role ? ` (${s.role})` : ''} and not applied yet.` });
    }
  }
  // 7. Pipeline pace: few recent applications.
  const last7 = apps.filter(a => { const g = ageOf(a.applied_date); return g !== null && g >= 0 && g <= 7; }).length;
  if (last7 < 5) {
    suggestions.push({ priority: 7, type: 'pace', stale: 0, kind: 'general', target_id: null, icon: '🚀',
      title: 'Keep the pipeline full',
      detail: `Only ${last7} application${last7 === 1 ? '' : 's'} in the last 7 days — aim for a few more this week.` });
  }
  // Stable key per suggestion; drop any the user has dismissed.
  // Dismissals expire after 14 days so a still-worsening situation resurfaces.
  for (const s of suggestions) s.key = s.target_id != null ? `${s.type}:${s.target_id}` : s.type;
  const expiryCutoff = new Date(Date.parse(today + 'T00:00:00Z') - 14 * 86400000).toISOString().slice(0, 10);
  db.prepare('DELETE FROM dismissed_suggestions WHERE dismissed_at IS NULL OR dismissed_at < ?').run(expiryCutoff);
  const dismissedKeys = new Set(db.prepare('SELECT key FROM dismissed_suggestions').all().map(r => r.key));
  const liveSuggestions = suggestions.filter(s => !dismissedKeys.has(s.key));
  liveSuggestions.sort((a, b) => a.priority - b.priority || b.stale - a.stale);
  // Order so a varied set leads (no single category buries networking nudges),
  // but return EVERYTHING — the client shows a few by default and can expand.
  const PER_PRIORITY_CAP = { 3: 4, 4: 3, 5: 4, 6: 3 };
  const seenByPriority = {};
  const diverse = [], overflow = [];
  for (const s of liveSuggestions) {
    const cap = PER_PRIORITY_CAP[s.priority];
    seenByPriority[s.priority] = (seenByPriority[s.priority] || 0) + 1;
    (cap && seenByPriority[s.priority] > cap ? overflow : diverse).push(s);
  }
  const suggestionsAll = diverse.concat(overflow).map(({ stale, priority, ...rest }) => rest);
  const suggestionsTotal = suggestionsAll.length;
  const suggestionsDismissed = dismissedKeys.size;

  res.json({
    totals: {
      applied: total,
      interviews_landed: interviewsLanded,
      companies_interviewed: companiesInterviewed,
      interviews_completed: interviewsCompleted,
      in_progress: inProgress,
      closed,
      offers
    },
    rates: {
      interview_rate: pct(interviewsLanded),
      offer_rate: pct(offers),
      waiting_rate: pct(inProgress)
    },
    todays_actions: {
      interviews: rounds.filter(r => r.interview_date === today)
        .sort((a, b) => (a.interview_time || '99').localeCompare(b.interview_time || '99'))
        .map(r => ({ id: r.id, application_id: r.application_id, company: r.company, role: r.role, round_number: r.round_number, interview_type: r.interview_type, interview_time: r.interview_time })),
      applications: apps.filter(a => a.followup_date && a.followup_date <= today)
        .map(a => ({ id: a.id, company: a.company, role: a.role, followup_date: a.followup_date })),
      networking: contacts.filter(c => c.followup_date && c.followup_date <= today)
        .map(c => ({ id: c.id, name: c.name, company: c.company, followup_date: c.followup_date })),
      suggestions: suggestionsAll,
      suggestions_total: suggestionsTotal,
      suggestions_dismissed: suggestionsDismissed
    },
    upcoming: {
      interviews: rounds.filter(r => r.interview_date && r.interview_date > today)
        .sort((a, b) => a.interview_date.localeCompare(b.interview_date) || (a.interview_time || '99').localeCompare(b.interview_time || '99'))
        .map(r => ({ id: r.id, application_id: r.application_id, company: r.company, round_number: r.round_number, interview_type: r.interview_type, date: r.interview_date, interview_time: r.interview_time })),
      applications: apps.filter(a => a.followup_date && a.followup_date > today)
        .map(a => ({ id: a.id, company: a.company, role: a.role, date: a.followup_date })),
      networking: contacts.filter(c => c.followup_date && c.followup_date > today)
        .map(c => ({ id: c.id, name: c.name, company: c.company, date: c.followup_date }))
    },
    velocity: weeks,
    by_status: groupBy('status'),
    by_source: groupBy('source'),
    by_priority: groupBy('priority'),
    networking: {
      total: contacts.length,
      active: contacts.filter(c => c.status === 'Active').length,
      awaiting_reply: contacts.filter(c => c.status === 'Awaiting Reply').length,
      referred: contacts.filter(c => c.referred_job).length
    },
    today
  });
});

// --- suggested-action dismissals ---

app.post('/api/suggestions/dismiss', (req, res) => {
  const key = req.body && req.body.key;
  if (!key) return res.status(400).json({ error: 'key is required' });
  db.prepare('INSERT OR REPLACE INTO dismissed_suggestions (key, dismissed_at) VALUES (?, ?)').run(key, todayISO());
  res.json({ ok: true, key });
});

// Undo a single dismissal.
app.post('/api/suggestions/restore', (req, res) => {
  const key = req.body && req.body.key;
  if (!key) return res.status(400).json({ error: 'key is required' });
  db.prepare('DELETE FROM dismissed_suggestions WHERE key=?').run(key);
  res.json({ ok: true, key });
});

// Clear all dismissals (bring every suggestion back).
app.delete('/api/suggestions/dismissals', (req, res) => {
  const info = db.prepare('DELETE FROM dismissed_suggestions').run();
  res.json({ ok: true, restored: info.changes });
});

// --- export / import ---

app.get('/api/export', (req, res) => {
  res.json({
    exported_at: new Date().toISOString(),
    applications: db.prepare('SELECT * FROM applications ORDER BY id').all().map(appFromDb),
    networking: db.prepare('SELECT * FROM networking ORDER BY id').all().map(netFromDb),
    interview_rounds: db.prepare('SELECT * FROM interview_rounds ORDER BY id').all(),
    activity_log: db.prepare('SELECT * FROM activity_log ORDER BY id').all(),
    saved_jobs: db.prepare('SELECT * FROM saved_jobs ORDER BY id').all(),
    dismissed_suggestions: db.prepare('SELECT * FROM dismissed_suggestions ORDER BY key').all()
  });
});

app.post('/api/import', (req, res) => {
  const b = req.body || {};
  const apps = b.applications, nets = b.networking;
  const ints = b.interview_rounds || b.interviews || [];
  const acts = b.activity_log || [];
  const saved = b.saved_jobs || [];
  const dismissed = b.dismissed_suggestions || [];
  if (!Array.isArray(apps) || !Array.isArray(nets)) {
    return res.status(400).json({ error: 'import payload must include applications[] and networking[]' });
  }
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM activity_log').run();
      db.prepare('DELETE FROM interview_rounds').run();
      db.prepare('DELETE FROM networking').run();
      db.prepare('DELETE FROM applications').run();
      db.prepare('DELETE FROM saved_jobs').run();
      db.prepare('DELETE FROM dismissed_suggestions').run();
      const ia = db.prepare(`INSERT INTO applications (id,${APP_FIELDS.join(',')}) VALUES (@id,${APP_FIELDS.map(f => '@' + f).join(',')})`);
      const inn = db.prepare(`INSERT INTO networking (id,${NET_FIELDS.join(',')}) VALUES (@id,${NET_FIELDS.map(f => '@' + f).join(',')})`);
      const ii = db.prepare(`INSERT INTO interview_rounds (id,${INT_FIELDS.join(',')}) VALUES (@id,${INT_FIELDS.map(f => '@' + f).join(',')})`);
      const il = db.prepare('INSERT INTO activity_log (id, application_id, event_date, event_type, note) VALUES (@id,@application_id,@event_date,@event_type,@note)');
      apps.forEach((a, i) => ia.run({ ...appToDb(a), id: a.id || i + 1 }));
      nets.forEach((n, i) => inn.run({ ...netToDb(n), id: n.id || i + 1 }));
      ints.forEach((r, i) => ii.run({ ...intToDb(r), id: r.id || i + 1 }));
      acts.forEach((l, i) => il.run({ id: l.id || i + 1, application_id: l.application_id ?? null, event_date: l.event_date ?? null, event_type: l.event_type ?? null, note: l.note ?? null }));
      const isv = db.prepare(`INSERT INTO saved_jobs (id,${SAVED_FIELDS.join(',')}) VALUES (@id,${SAVED_FIELDS.map(f => '@' + f).join(',')})`);
      saved.forEach((s, i) => {
        const out = { id: s.id || i + 1 };
        for (const f of SAVED_FIELDS) out[f] = s[f] === undefined ? null : s[f];
        isv.run(out);
      });
      const ids = db.prepare('INSERT OR REPLACE INTO dismissed_suggestions (key, dismissed_at) VALUES (@key, @dismissed_at)');
      dismissed.forEach(d => { if (d && d.key) ids.run({ key: d.key, dismissed_at: d.dismissed_at ?? null }); });
    })();
    res.json({ ok: true, counts: { applications: apps.length, networking: nets.length, interview_rounds: ints.length, activity_log: acts.length, saved_jobs: saved.length } });
  } catch (e) {
    res.status(400).json({ error: 'import failed: ' + e.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Job tracker listening on 0.0.0.0:${PORT} (db: ${dbPath})`);
});
