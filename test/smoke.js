'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const Database = require('better-sqlite3');
const Stripe = require('stripe');

const ROOT = path.join(__dirname, '..');
const stripe = new Stripe('sk_test_smoke');
const WEBHOOK_SECRET = 'whsec_smoke';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('server start timed out\n' + log));
    }, 10000);
    const onData = (buf) => {
      log += buf.toString();
      if (!settled && log.includes('listening on')) {
        settled = true;
        clearTimeout(timer);
        resolve({
          child,
          log: () => log,
          stop() {
            child.kill('SIGTERM');
          },
        });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const err = new Error('server exited ' + code + '\n' + log);
        err.code = code;
        err.log = log;
        reject(err);
      }
    });
  });
}

class Jar {
  constructor() { this.cookies = {}; }
  store(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of list) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      if (i === -1) continue;
      this.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
  }
  header() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  csrf() { return this.cookies.csrf || ''; }
}

async function request(base, jar, method, urlPath, body, { csrf = true } = {}) {
  const headers = {};
  if (jar) headers.cookie = jar.header();
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrf && jar && method !== 'GET' && method !== 'HEAD') headers['x-csrf-token'] = jar.csrf();
  const res = await fetch(base + urlPath, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  if (jar) jar.store(res);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { res, text, json, status: res.status };
}

async function signIn(base, email) {
  const jar = new Jar();
  const sent = await request(base, jar, 'POST', '/api/auth/magic-link', { email }, { csrf: false });
  assert.equal(sent.status, 200, sent.text);
  assert.ok(sent.json.dev_link, 'expected dev magic link');
  const verify = await fetch(sent.json.dev_link, { redirect: 'manual' });
  jar.store(verify);
  assert.equal(verify.status, 302, 'verify should redirect');
  assert.ok(jar.cookies.sid, 'session cookie missing');
  assert.ok(jar.csrf(), 'csrf cookie missing');
  return jar;
}

function stripeEvent(id, type, object, extra = {}) {
  return JSON.stringify({ id, object: 'event', type, livemode: false, data: { object }, ...extra });
}

async function postWebhook(base, payload) {
  const res = await fetch(base + '/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }),
    },
    body: payload,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json };
}

const BACKGROUND = ('Shipped search and billing features. ').repeat(12);
const POSTING = ('Product manager role. Responsibilities include writing specs, talking to customers, and SQL. ').repeat(3);

function legacySchema(db) {
  db.exec(`
    CREATE TABLE applications (
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
      job_link TEXT,
      fit_analysis TEXT,
      fit_analysis_date TEXT,
      closed_date TEXT
    );
    CREATE TABLE networking (
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
    CREATE TABLE interview_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
      company TEXT,
      role TEXT,
      round_number INTEGER,
      interview_type TEXT,
      interview_date TEXT,
      interview_time TEXT,
      duration_minutes INTEGER,
      interviewers TEXT,
      interviewer_titles TEXT,
      notes TEXT,
      outcome TEXT
    );
    CREATE TABLE saved_jobs (
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
    CREATE TABLE activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER,
      event_date TEXT,
      event_type TEXT,
      note TEXT
    );
    CREATE TABLE dismissed_suggestions (
      key TEXT PRIMARY KEY,
      dismissed_at TEXT
    );
    CREATE TABLE analyzer_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      profile_text TEXT NOT NULL,
      updated_at TEXT
    );
  `);
}

test('isolation, plan limits, and Stripe webhook', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /intEnv\('APPLICATION_LIMIT_FREE', 25\)/);
  assert.match(src, /intEnv\('ANALYZE_QUOTA_FREE', 3\)/);
  assert.match(src, /intEnv\('ANALYZE_QUOTA_PAID', 100\)/);
  assert.match(src, /intEnv\('ANALYZE_HOURLY_LIMIT', 10\)/);
  assert.match(src, /intEnv\('ANALYZE_GLOBAL_DAILY_CAP', 500\)/);
  assert.match(src, /intEnv\('LIFETIME_DEAL_LIMIT', 50\)/);

  const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-bare-'));
  const bareDb = new Database(path.join(bareDir, 'tracker.db'));
  bareDb.exec(`CREATE TABLE applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'In Progress',
    interview_landed INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]'
  )`);
  bareDb.prepare(`INSERT INTO applications (company, role) VALUES ('Orphan Co', 'Role')`).run();
  bareDb.close();
  const barePort = await freePort();
  await assert.rejects(
    () => startServer({
      PORT: String(barePort),
      DATA_DIR: bareDir,
      SEED_DEMO: '0',
      NODE_ENV: 'test',
      COOKIE_SECURE: '0',
    }),
    (err) => {
      assert.equal(err.code, 1);
      assert.match(err.log, /MIGRATION_OWNER_EMAIL/);
      return true;
    }
  );

  const migDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-mig-'));
  const migDb = new Database(path.join(migDir, 'tracker.db'));
  legacySchema(migDb);
  migDb.prepare(`INSERT INTO applications (company, role, status, tags) VALUES ('Legacy Co', 'Engineer', 'In Progress', '[]')`).run();
  migDb.prepare(`INSERT INTO networking (name, company, status) VALUES ('Casey Example', 'Legacy Co', 'Active')`).run();
  migDb.prepare(`INSERT INTO interview_rounds (application_id, company, role, round_number) VALUES (1, 'Legacy Co', 'Engineer', 1)`).run();
  migDb.prepare(`INSERT INTO dismissed_suggestions (key, dismissed_at) VALUES ('pace', '2026-01-01')`).run();
  migDb.prepare(`INSERT INTO analyzer_profile (id, name, profile_text, updated_at) VALUES (1, 'Legacy', ?, '2026-01-01')`).run(BACKGROUND);
  migDb.close();

  const migPort = await freePort();
  const migBase = `http://127.0.0.1:${migPort}`;
  const mig = await startServer({
    PORT: String(migPort),
    DATA_DIR: migDir,
    SEED_DEMO: '0',
    NODE_ENV: 'test',
    COOKIE_SECURE: '0',
    APP_BASE_URL: migBase,
    AUTH_DEBUG_RETURN_LINK: '1',
    EMAIL_PROVIDER: 'console',
    MIGRATION_OWNER_EMAIL: 'owner@example.com',
    ADMIN_EMAIL: 'admin@example.com',
  });
  try {
    assert.match(mig.log(), /owner@example.com/);
    const owner = await signIn(migBase, 'owner@example.com');
    const apps = await request(migBase, owner, 'GET', '/api/applications');
    assert.equal(apps.status, 200);
    assert.ok(apps.json.some(a => a.company === 'Legacy Co'));
    const nets = await request(migBase, owner, 'GET', '/api/networking');
    assert.ok(nets.json.some(n => n.name === 'Casey Example'));
    const profile = await request(migBase, owner, 'GET', '/api/profile');
    assert.match(profile.json.profile_text, /Shipped search/);
    const exported = await request(migBase, owner, 'GET', '/api/export');
    assert.ok(exported.json.dismissed_suggestions.some(d => d.key === 'pace'));
    const created = await request(migBase, owner, 'POST', '/api/applications', { company: 'After Migration', role: 'Role' });
    assert.equal(created.status, 201, created.text);
    const stranger = await signIn(migBase, 'stranger@example.com');
    const hidden = await request(migBase, stranger, 'GET', '/api/applications');
    assert.deepEqual(hidden.json, []);
    const strangerProfile = await request(migBase, stranger, 'GET', '/api/profile');
    assert.equal(strangerProfile.json.profile_text, '');
    const legacyId = apps.json.find(a => a.company === 'Legacy Co').id;
    const del = await request(migBase, owner, 'DELETE', '/api/applications/' + legacyId);
    assert.equal(del.status, 200);
    const rounds = await request(migBase, owner, 'GET', '/api/interviews');
    assert.ok(!rounds.json.some(r => r.application_id === legacyId));
  } finally {
    mig.stop();
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-smoke-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = await startServer({
    PORT: String(port),
    DATA_DIR: dir,
    SEED_DEMO: '0',
    NODE_ENV: 'test',
    COOKIE_SECURE: '0',
    APP_BASE_URL: base,
    AUTH_DEBUG_RETURN_LINK: '1',
    EMAIL_PROVIDER: 'console',
    ADMIN_EMAIL: 'admin@example.com',
    STRIPE_SECRET_KEY: 'sk_test_smoke',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_PASS: 'price_pass',
    STRIPE_PRICE_SUBSCRIPTION: 'price_sub',
    STRIPE_PRICE_LIFETIME: 'price_life',
    APPLICATION_LIMIT_FREE: '3',
    ANALYZE_QUOTA_FREE: '2',
    ANALYZE_QUOTA_PAID: '10',
    ANALYZE_HOURLY_LIMIT: '2',
    ANALYZE_GLOBAL_DAILY_CAP: '6',
    ANALYZE_DRY_RUN: '1',
    LIFETIME_DEAL_LIMIT: '2',
    PRIVACY_EMAIL: 'privacy@example.com',
  });

  try {
    const home = await request(base, null, 'GET', '/');
    assert.equal(home.status, 200);
    assert.match(home.text, /Teal/);
    assert.match(home.text, /\$29/);
    assert.match(home.text, /Huntr/);
    assert.match(home.text, /\$40/);
    assert.match(home.text, /Simplify/);
    assert.match(home.text, /\$39\.99/);
    const terms = await request(base, null, 'GET', '/terms');
    assert.match(terms.text, /Anthropic/);
    const privacy = await request(base, null, 'GET', '/privacy');
    assert.match(privacy.text, /Anthropic/);
    assert.match(privacy.text, /export/i);
    assert.match(privacy.text, /delet/i);
    assert.match(privacy.text, /privacy@example.com/);
    const appPage = await request(base, null, 'GET', '/app');
    assert.match(appPage.text, /\/app\.js/);
    const open = await request(base, null, 'GET', '/api/applications');
    assert.equal(open.status, 401);
    const google = await request(base, null, 'GET', '/api/auth/google');
    assert.equal(google.status, 404);

    const alice = await signIn(base, 'alice@example.com');
    const bob = await signIn(base, 'bob@example.com');
    const noCsrf = await request(base, alice, 'POST', '/api/applications', { company: 'Nope', role: 'Role' }, { csrf: false });
    assert.equal(noCsrf.status, 403);

    const a1 = await request(base, alice, 'POST', '/api/applications', { company: 'Alice Co', role: 'PM' });
    assert.equal(a1.status, 201, a1.text);
    const bobList = await request(base, bob, 'GET', '/api/applications');
    assert.deepEqual(bobList.json, []);
    const bobGet = await request(base, bob, 'GET', '/api/applications/' + a1.json.id);
    assert.equal(bobGet.status, 404);
    const bobPut = await request(base, bob, 'PUT', '/api/applications/' + a1.json.id, { company: 'Hijack' });
    assert.equal(bobPut.status, 404);
    const bobDel = await request(base, bob, 'DELETE', '/api/applications/' + a1.json.id);
    assert.equal(bobDel.status, 404);
    const still = await request(base, alice, 'GET', '/api/applications/' + a1.json.id);
    assert.equal(still.json.company, 'Alice Co');

    const contact = await request(base, alice, 'POST', '/api/networking', { name: 'Ada Contact' });
    assert.equal(contact.status, 201);
    assert.equal((await request(base, bob, 'GET', '/api/networking/' + contact.json.id)).status, 404);
    const round = await request(base, bob, 'POST', '/api/interviews', { application_id: a1.json.id, round_number: 1 });
    assert.equal(round.status, 400);
    const aliceRound = await request(base, alice, 'POST', '/api/interviews', { application_id: a1.json.id, round_number: 1 });
    assert.equal(aliceRound.status, 201, aliceRound.text);
    assert.equal((await request(base, bob, 'GET', '/api/interviews/' + aliceRound.json.id)).status, 404);
    const note = await request(base, alice, 'POST', '/api/applications/' + a1.json.id + '/activity', { event_type: 'Note', note: 'secret note' });
    assert.equal(note.status, 201);
    assert.equal((await request(base, bob, 'GET', '/api/applications/' + a1.json.id + '/activity')).status, 404);

    const saved = await request(base, alice, 'POST', '/api/saved-jobs', { company: 'Saved Co', role: 'Designer' });
    assert.equal(saved.status, 201);
    assert.equal((await request(base, bob, 'PUT', '/api/saved-jobs/' + saved.json.id, { role: 'Stolen' })).status, 404);

    await request(base, alice, 'PUT', '/api/profile', { profile_text: BACKGROUND, name: 'Alice' });
    const bobProfile = await request(base, bob, 'GET', '/api/profile');
    assert.equal(bobProfile.json.profile_text, '');
    await request(base, bob, 'PUT', '/api/profile', { profile_text: BACKGROUND.replace('Shipped', 'Bob shipped'), name: 'Bob' });
    const aliceProfile = await request(base, alice, 'GET', '/api/profile');
    assert.match(aliceProfile.json.profile_text, /^Shipped/);
    assert.doesNotMatch(aliceProfile.json.profile_text, /Bob shipped/);

    const bobImport = await request(base, bob, 'POST', '/api/import', {
      applications: [{ id: a1.json.id, company: 'Bob Only', role: 'Role', status: 'In Progress' }],
      networking: [],
    });
    assert.equal(bobImport.status, 200, bobImport.text);
    const aliceAfter = await request(base, alice, 'GET', '/api/applications');
    assert.ok(aliceAfter.json.some(a => a.company === 'Alice Co'));
    assert.ok(!aliceAfter.json.some(a => a.company === 'Bob Only'));
    const bobExport = await request(base, bob, 'GET', '/api/export');
    assert.ok(bobExport.json.applications.some(a => a.company === 'Bob Only'));
    assert.ok(!JSON.stringify(bobExport.json).includes('Alice Co'));
    assert.ok(!JSON.stringify(bobExport.json).includes('secret note'));

    const paceAlice = await request(base, alice, 'GET', '/api/dashboard');
    const paceBob = await request(base, bob, 'GET', '/api/dashboard');
    assert.ok(paceBob.json.todays_actions.suggestions.some(s => s.key === 'pace'));
    await request(base, alice, 'POST', '/api/suggestions/dismiss', { key: 'pace' });
    const aliceDash = await request(base, alice, 'GET', '/api/dashboard');
    const bobDash = await request(base, bob, 'GET', '/api/dashboard');
    assert.ok(!aliceDash.json.todays_actions.suggestions.some(s => s.key === 'pace'));
    assert.ok(bobDash.json.todays_actions.suggestions.some(s => s.key === 'pace'));
    assert.ok(paceAlice.status === 200);

    const limited = await signIn(base, 'limited@example.com');
    for (let i = 0; i < 3; i++) {
      const made = await request(base, limited, 'POST', '/api/applications', { company: 'Cap ' + i, role: 'Role' });
      assert.equal(made.status, 201, made.text);
    }
    const over = await request(base, limited, 'POST', '/api/applications', { company: 'Cap over', role: 'Role' });
    assert.equal(over.status, 402, over.text);
    assert.match(over.json.error, /Free plan includes 3/);
    const doomed = await request(base, limited, 'POST', '/api/import', {
      applications: [1, 2, 3, 4].map(n => ({ company: 'Imp ' + n, role: 'Role' })),
      networking: [],
    });
    assert.equal(doomed.status, 402);
    const stillThree = await request(base, limited, 'GET', '/api/applications');
    assert.equal(stillThree.json.length, 3);
    await request(base, limited, 'DELETE', '/api/applications/' + stillThree.json[0].id);
    const again = await request(base, limited, 'POST', '/api/applications', { company: 'Cap again', role: 'Role' });
    assert.equal(again.status, 201);

    async function analyze(jar) {
      return request(base, jar, 'POST', '/api/analyze', { jobDescription: POSTING });
    }
    await request(base, alice, 'PUT', '/api/profile', { profile_text: BACKGROUND });
    const fit1 = await analyze(alice);
    assert.equal(fit1.status, 200, fit1.text);
    assert.equal(fit1.json.ok, true);
    assert.equal(fit1.json.result.verdict, 'Partial fit');
    assert.equal(fit1.json.result.score, 58);
    assert.ok(fit1.json.result.strengths.length >= 3);
    assert.ok(fit1.json.result.gaps.length >= 3);
    assert.equal(fit1.json.result.fixture, true);
    const meAfter = await request(base, alice, 'GET', '/api/billing/status');
    assert.equal(meAfter.json.usage.analyze_input_tokens, 11);
    assert.equal(meAfter.json.usage.analyze_output_tokens, 22);
    const fit2 = await analyze(alice);
    assert.equal(fit2.status, 200, fit2.text);
    const fit3 = await analyze(alice);
    assert.equal(fit3.status, 429, fit3.text);
    assert.match(fit3.json.error, /Free accounts include 2/);

    const paid = await signIn(base, 'paid@example.com');
    const paidMe = await request(base, paid, 'GET', '/api/auth/me');
    const passPayload = stripeEvent('evt_pass_1', 'checkout.session.completed', {
      id: 'cs_pass_1',
      object: 'checkout.session',
      payment_status: 'paid',
      mode: 'payment',
      customer: 'cus_pass',
      client_reference_id: String(paidMe.json.id),
      metadata: { user_id: String(paidMe.json.id), product: 'pass' },
    });
    const hooked = await postWebhook(base, passPayload);
    assert.equal(hooked.status, 200, hooked.text);
    const paidStatus = await request(base, paid, 'GET', '/api/billing/status');
    assert.equal(paidStatus.json.effective_plan, 'pass');
    const days = (Date.parse(paidStatus.json.access_until) - Date.now()) / 86400000;
    assert.ok(days > 89 && days < 91, 'pass should last about 90 days, got ' + days);
    const againHook = await postWebhook(base, passPayload);
    assert.equal(againHook.status, 200);
    assert.equal(againHook.json.duplicate, true);
    const paidStatus2 = await request(base, paid, 'GET', '/api/billing/status');
    assert.equal(paidStatus2.json.access_until, paidStatus.json.access_until);

    const badSig = await fetch(base + '/api/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
      body: passPayload,
    });
    assert.equal(badSig.status, 400);
    const livePayload = JSON.stringify({ id: 'evt_live', object: 'event', type: 'checkout.session.completed', livemode: true, data: { object: {} } });
    const live = await postWebhook(base, livePayload);
    assert.equal(live.status, 400);
    assert.match(live.text, /Live mode/);

    await request(base, paid, 'PUT', '/api/profile', { profile_text: BACKGROUND });
    assert.equal((await analyze(paid)).status, 200);
    assert.equal((await analyze(paid)).status, 200);
    const hourly = await analyze(paid);
    assert.equal(hourly.status, 429, hourly.text);
    assert.match(hourly.json.error, /Hourly Role Fit limit/);
    for (let i = 0; i < 4; i++) {
      const extra = await request(base, paid, 'POST', '/api/applications', { company: 'Paid ' + i, role: 'Role' });
      assert.equal(extra.status, 201, extra.text);
    }

    const subUser = await signIn(base, 'sub@example.com');
    const subMe = await request(base, subUser, 'GET', '/api/auth/me');
    const periodEnd = Math.floor(Date.now() / 1000) + 10 * 86400;
    const subUp = await postWebhook(base, stripeEvent('evt_sub_up', 'customer.subscription.updated', {
      id: 'sub_test_1',
      object: 'subscription',
      status: 'active',
      customer: 'cus_sub',
      current_period_end: periodEnd,
      metadata: { user_id: String(subMe.json.id) },
    }));
    assert.equal(subUp.status, 200, subUp.text);
    const subStatus = await request(base, subUser, 'GET', '/api/billing/status');
    assert.equal(subStatus.json.effective_plan, 'subscription');
    const subDown = await postWebhook(base, stripeEvent('evt_sub_down', 'customer.subscription.deleted', {
      id: 'sub_test_1',
      object: 'subscription',
      status: 'canceled',
      customer: 'cus_sub',
      current_period_end: Math.floor(Date.now() / 1000) - 60,
      metadata: { user_id: String(subMe.json.id) },
    }));
    assert.equal(subDown.status, 200, subDown.text);
    const subFree = await request(base, subUser, 'GET', '/api/billing/status');
    assert.equal(subFree.json.effective_plan, 'free');

    const life = await signIn(base, 'life@example.com');
    const lifeMe = await request(base, life, 'GET', '/api/auth/me');
    const lifeHook = await postWebhook(base, stripeEvent('evt_life_1', 'checkout.session.completed', {
      id: 'cs_life_1',
      object: 'checkout.session',
      payment_status: 'paid',
      mode: 'payment',
      customer: 'cus_life',
      metadata: { user_id: String(lifeMe.json.id), product: 'lifetime' },
    }));
    assert.equal(lifeHook.status, 200, lifeHook.text);
    const life2 = await signIn(base, 'life2@example.com');
    const life2Me = await request(base, life2, 'GET', '/api/auth/me');
    assert.equal((await postWebhook(base, stripeEvent('evt_life_2', 'checkout.session.completed', {
      id: 'cs_life_2',
      object: 'checkout.session',
      payment_status: 'paid',
      mode: 'payment',
      customer: 'cus_life_2',
      metadata: { user_id: String(life2Me.json.id), product: 'lifetime' },
    }))).status, 200);
    const stillLife = await postWebhook(base, stripeEvent('evt_life_sub_del', 'customer.subscription.deleted', {
      id: 'sub_should_not_downgrade',
      object: 'subscription',
      status: 'canceled',
      customer: 'cus_life',
      current_period_end: Math.floor(Date.now() / 1000) - 60,
      metadata: { user_id: String(lifeMe.json.id) },
    }));
    assert.equal(stillLife.status, 200, stillLife.text);
    const lifeStatus = await request(base, life, 'GET', '/api/billing/status');
    assert.equal(lifeStatus.json.effective_plan, 'lifetime');

    const shopper = await signIn(base, 'shopper@example.com');
    const portal = await request(base, shopper, 'POST', '/api/billing/portal');
    assert.equal(portal.status, 400);
    const soldOut = await request(base, shopper, 'POST', '/api/billing/checkout', { product: 'lifetime' });
    assert.equal(soldOut.status, 403, soldOut.text);
    assert.match(soldOut.json.error, /sold out/i);

    const globalUser = await signIn(base, 'global@example.com');
    await request(base, globalUser, 'PUT', '/api/profile', { profile_text: BACKGROUND });
    // Alice 2 + paid 2 = 4. Two more fill the daily cap of 6. The next one is the global cap.
    assert.equal((await analyze(globalUser)).status, 200, 'global user first');
    assert.equal((await analyze(globalUser)).status, 200, 'global user second');
    const capped = await analyze(globalUser);
    assert.equal(capped.status, 429, capped.text);
    assert.match(capped.json.error, /at capacity for today/);

    const admin = await signIn(base, 'admin@example.com');
    const overview = await request(base, admin, 'GET', '/api/admin/overview');
    assert.equal(overview.status, 200, overview.text);
    const emails = overview.json.users.map(u => u.email);
    assert.ok(emails.includes('alice@example.com'));
    assert.ok(emails.includes('life@example.com'));
    assert.ok(overview.json.users.find(u => u.email === 'admin@example.com').is_admin);
    assert.equal((await request(base, bob, 'GET', '/api/admin/overview')).status, 403);

    const doomedUser = await signIn(base, 'gone@example.com');
    const goneApp = await request(base, doomedUser, 'POST', '/api/applications', { company: 'Gone Co', role: 'Role' });
    assert.equal(goneApp.status, 201);
    const removed = await request(base, doomedUser, 'DELETE', '/api/account', { confirm: 'DELETE' });
    assert.equal(removed.status, 200, removed.text);
    const dead = await request(base, doomedUser, 'GET', '/api/auth/me');
    assert.equal(dead.status, 401);
    const bobStill = await request(base, bob, 'GET', '/api/applications');
    assert.ok(bobStill.json.some(a => a.company === 'Bob Only'));
    const reborn = await signIn(base, 'gone@example.com');
    const empty = await request(base, reborn, 'GET', '/api/applications');
    assert.deepEqual(empty.json, []);
    assert.equal((await request(base, reborn, 'GET', '/api/applications/' + goneApp.json.id)).status, 404);
  } finally {
    server.stop();
  }
});
