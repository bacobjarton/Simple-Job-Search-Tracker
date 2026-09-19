/* Job Application Tracker — vanilla JS SPA */
(function () {
'use strict';

// ---------------- constants ----------------

const STATUSES = ['In Progress', 'Offer Received', 'Rejected', 'Withdrawn', 'Never Heard Back'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const LOCATIONS = ['Remote', 'Hybrid', 'On-site'];
const SOURCES = ['LinkedIn', 'Company Website', 'Referral', 'Indeed', 'Glassdoor', 'Other'];
const INT_TYPES = ['Recruiter Screening', 'Hiring Manager', 'Technical', 'Panel', 'Take-Home', 'Executive', 'Case Study', 'Final', 'Self-Recorded', 'Other'];
const NET_STATUSES = ['Active', 'Dormant', 'Awaiting Reply', 'Closed'];
const EVENT_TYPES = ['Applied', 'Recruiter Screen', 'Interview', 'Follow-up', 'Offer', 'Rejection', 'Note', 'Status Change'];

const STATUS_COLORS = {
  'In Progress': '#3b82f6', 'Offer Received': '#22c55e', 'Rejected': '#ef4444',
  'Withdrawn': '#6b7280', 'Never Heard Back': '#f97316'
};
const PRIORITY_COLORS = { 'High': '#f43f5e', 'Medium': '#f59e0b', 'Low': '#64748b' };
const NET_COLORS = { 'Active': '#22c55e', 'Awaiting Reply': '#eab308', 'Dormant': '#6b7280', 'Closed': '#64748b' };

const NAV = [
  { route: 'dashboard', label: 'Dashboard', ico: '📊' },
  { route: 'applications', label: 'Applications', ico: '📋' },
  { route: 'saved', label: 'Saved Jobs', ico: '🔖' },
  { route: 'networking', label: 'Networking', ico: '🤝' },
  { route: 'interviews', label: 'Interviews', ico: '🎤' },
  { route: 'rolefit', label: 'Role Fit', ico: '🎯' },
];

const RF_MIN_CHARS = 120, RF_MAX_CHARS = 6000;
const RF_STREAM_ERROR = ' STREAM_ERROR';

// ---------------- state ----------------

const S = {
  apps: [], contacts: [], interviews: [], saved: [], dash: null,
  route: 'dashboard',
  viewMode: window.innerWidth < 768 ? 'kanban' : 'table',
  filtersOpen: false,
  filters: { status: '', priority: '', interview: '', location: '', source: '', tag: '' },
  sort: { key: 'applied_date', dir: -1 },
  selected: new Set(),
  netFilters: { status: '', referred: '', company: '' },
  netSort: 'last_contact',
  expandedInt: new Set(),
  detailId: null,
  detailActivity: [],
  velMetric: localStorage.getItem('velMetric') || 'apps',
  velRange: localStorage.getItem('velRange') || '12w',
  velStyle: localStorage.getItem('velStyle') || 'bar',
  rf: { text: '', output: '', status: 'idle', error: null, config: null, profile: null, editingProfile: false },
  suggestCollapsed: localStorage.getItem('suggestCollapsed') === '1',
  suggestShowAll: localStorage.getItem('suggestShowAll') === '1',
};

const SUGGEST_DEFAULT_VISIBLE = 6;

// ---------------- utilities ----------------

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h)) return '';
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${ap}`;
}
// Company names get typed inconsistently across applications and rounds
// ("Base" vs "Base.ai"), so group on a normalized key rather than raw text.
function companyKey(name) {
  const cleaned = String(name || '').toLowerCase()
    .replace(/[.,'’`"]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\b(inc|llc|ltd|corp|corporation)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(ai|io|com|app|hq)$/, '')
    .trim();
  return cleaned || String(name || '').toLowerCase().trim() || 'unknown';
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
function daysSince(iso) { return iso ? daysBetween(iso, todayISO()) : null; }

async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch (e) {}
    toast('Error: ' + msg);
    throw new Error(msg);
  }
  return res.json();
}

let toastTimer = null;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = '';
  t.appendChild(document.createTextNode(msg));
  if (action && action.label && action.fn) {
    const b = document.createElement('button');
    b.className = 'btn ghost sm';
    b.style.marginLeft = '12px';
    b.textContent = action.label;
    b.onclick = () => { t.hidden = true; clearTimeout(toastTimer); action.fn(); };
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 5000 : 2200);
}

function badge(text, color, light) {
  return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}55">${esc(text)}</span>`;
}
function statusBadge(s) { return badge(s || '—', STATUS_COLORS[s] || '#64748b'); }
function priorityBadge(p) { return p ? badge(p, PRIORITY_COLORS[p] || '#64748b') : ''; }
function netBadge(s) { return badge(s || '—', NET_COLORS[s] || '#64748b'); }
function outcomeBadge(o) {
  if (!o) return '<span class="badge outline">Pending</span>';
  const low = o.toLowerCase();
  let c = '#64748b';
  if (low.includes('pass') || low.includes('referred')) c = '#22c55e';
  else if (low.includes('reject')) c = '#ef4444';
  else if (low.includes('withdr')) c = '#6b7280';
  return badge(o, c);
}
function options(list, selected, includeBlank) {
  let html = includeBlank ? `<option value="">${esc(includeBlank === true ? '' : includeBlank)}</option>` : '';
  const items = list.slice();
  if (selected && !items.includes(selected)) items.push(selected);
  for (const v of items) html += `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(v)}</option>`;
  return html;
}

// ---------------- data loading ----------------

async function loadAll() {
  const [apps, contacts, interviews, saved] = await Promise.all([
    api('GET', '/api/applications'),
    api('GET', '/api/networking'),
    api('GET', '/api/interviews'),
    api('GET', '/api/saved-jobs'),
  ]);
  S.apps = apps; S.contacts = contacts; S.interviews = interviews; S.saved = saved;
}
async function loadDash() { S.dash = await api('GET', '/api/dashboard'); }

// ---------------- router / nav ----------------

function setRoute(route) {
  if (!NAV.some(n => n.route === route)) route = 'dashboard';
  if (location.hash !== '#/' + route) { location.hash = '#/' + route; return; }
  S.route = route;
  renderNav();
  render();
}
function routeFromHash() {
  return (location.hash.replace(/^#\//, '') || 'dashboard').split('?')[0];
}
window.addEventListener('hashchange', () => setRoute(routeFromHash()));

function renderNav() {
  const link = n => `<a href="#/${n.route}" class="${S.route === n.route ? 'active' : ''}"><span class="ico">${n.ico}</span><span>${n.label}</span></a>`;
  $('#sidenav').innerHTML = NAV.map(link).join('');
  $('#bottomnav').innerHTML = NAV.map(link).join('');
  $('#pageTitle').textContent = NAV.find(n => n.route === S.route).label;
  $('#fab').hidden = !(S.route === 'applications' && window.innerWidth < 768);
}

async function render() {
  const main = $('#main');
  try {
    if (S.route === 'dashboard') { await Promise.all([loadDash(), loadAll()]); renderDashboard(main); }
    else if (S.route === 'applications') { await loadAll(); renderApplications(main); }
    else if (S.route === 'saved') { await loadAll(); renderSaved(main); }
    else if (S.route === 'networking') { await loadAll(); renderNetworking(main); }
    else if (S.route === 'interviews') { await loadAll(); renderInterviews(main); }
    else if (S.route === 'rolefit') { await loadAll(); renderRoleFit(main); }
  } catch (e) {
    main.innerHTML = `<div class="empty-state">Failed to load: ${esc(e.message)}</div>`;
  }
}

// ---------------- dashboard ----------------

function renderDashboard(main) {
  const d = S.dash;
  // Velocity module: one chart, switchable between applications and interviews.
  const velArgs = () => {
    const isInt = S.velMetric === 'interviews';
    const buckets = computeVelocity(S.velRange, isInt ? S.interviews : S.apps, isInt ? 'interview_date' : 'applied_date');
    return [buckets, S.velStyle, isInt ? 'interview' : 'application'];
  };
  const ta = d.todays_actions;
  const taInterviews = ta.interviews || [];
  const taSuggestions = ta.suggestions || [];
  const taHard = ta.applications.length + ta.networking.length + taInterviews.length;
  const taCount = taHard + taSuggestions.length;
  const suggestAct = { app: 'openapp', net: 'opencontact', saved: 'opensaved', general: 'route-apps' };
  // Suggested Actions: collapsible, and capped to a few until "Show all".
  const visibleSuggestions = S.suggestCollapsed ? []
    : (S.suggestShowAll ? taSuggestions : taSuggestions.slice(0, SUGGEST_DEFAULT_VISIBLE));
  const hiddenSuggestions = taSuggestions.length - visibleSuggestions.length;

  const up = d.upcoming || { interviews: [], applications: [], networking: [] };
  const upcoming = [
    ...up.interviews.map(e => ({ date: e.date, icon: '🎤', kind: 'Interview', title: e.company, sub: `Round ${e.round_number ?? '?'}${e.interview_type ? ' · ' + e.interview_type : ''}${e.interview_time ? ' · ' + fmtTime(e.interview_time) : ''}`, act: 'openapp', id: e.application_id })),
    ...up.applications.map(e => ({ date: e.date, icon: '📋', kind: 'Follow-up', title: e.company, sub: e.role, act: 'openapp', id: e.id })),
    ...up.networking.map(e => ({ date: e.date, icon: '🤝', kind: 'Follow-up', title: e.name, sub: e.company || '', act: 'opencontact', id: e.id })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);

  const dueLabel = (date) => {
    const days = daysSince(date);
    return days <= 0 ? '<span class="due-today">Due today</span>'
      : `<span class="overdue">${days} day${days === 1 ? '' : 's'} overdue</span>`;
  };

  const actionItem = (kind, it) => `
    <div class="action-item">
      <div class="ai-main">
        <div class="t">${esc(kind === 'app' ? it.company : it.name)}</div>
        <div class="s">${esc(kind === 'app' ? it.role : (it.company || ''))}</div>
      </div>
      ${dueLabel(it.followup_date)}
      <button class="btn ghost sm" data-act="snooze" data-kind="${kind}" data-id="${it.id}" title="Snooze 3 days">💤 3d</button>
      <button class="btn ghost sm" data-act="clearfu" data-kind="${kind}" data-id="${it.id}" title="Clear follow-up">✓ Done</button>
    </div>`;

  const bdTable = (title, rows, fkey) => `
    <details class="panel" ${window.innerWidth >= 768 ? 'open' : ''}>
      <summary>${title}</summary>
      <table class="bd-table">${rows.map(r => `<tr ${fkey && r.key !== '—' ? `data-goto="applications" data-${fkey}="${esc(r.key)}" title="View these applications"` : ''}><td>${esc(r.key)}</td><td>${r.count}</td><td>${r.pct}%</td></tr>`).join('') || '<tr><td class="muted">No data</td></tr>'}</table>
    </details>`;

  main.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card" data-goto="applications" title="View all applications"><div class="num">${d.totals.applied}</div><div class="lbl">Total Applied</div></div>
      <div class="stat-card" data-goto="applications" data-finterview="yes" title="View applications with interviews"><div class="num" style="color:#22c55e">${d.totals.companies_interviewed ?? d.totals.interviews_landed}</div><div class="lbl">Companies Interviewed</div></div>
      <div class="stat-card" data-goto="interviews" title="View interview log"><div class="num" style="color:#818cf8">${d.totals.interviews_completed ?? 0}</div><div class="lbl">Interviews Completed</div></div>
      <div class="stat-card" data-goto="applications" data-fstatus="In Progress" title="View in-progress applications"><div class="num" style="color:#3b82f6">${d.totals.in_progress}</div><div class="lbl">In Progress</div></div>
      <div class="stat-card" data-goto="applications" data-fstatus="__closed" title="View closed applications"><div class="num" style="color:#94a3b8">${d.totals.closed}</div><div class="lbl">Closed</div></div>
    </div>
    <div class="rates-row">
      <div class="rate-card"><span class="num">${d.rates.interview_rate}%</span><span class="lbl">Interview Rate</span></div>
      <div class="rate-card"><span class="num">${d.rates.offer_rate}%</span><span class="lbl">Offer Rate</span></div>
      <div class="rate-card"><span class="num">${d.rates.waiting_rate}%</span><span class="lbl">Waiting to Hear</span></div>
    </div>

    <div class="panel actions-panel">
      <h3>⏰ Today's Actions ${taCount ? `<span class="badge" style="background:#f9731622;color:#fb923c;border:1px solid #f9731655">${taCount}</span>` : ''}</h3>
      ${taCount === 0 ? '<div class="muted">Nothing due. You\'re all caught up 🎉</div>' : `
        ${taInterviews.length ? `<div class="search-group-label">Interviews Today</div>${taInterviews.map(it => `
          <div class="action-item">
            <div class="ai-main">
              <div class="t">🎤 ${esc(it.company)}</div>
              <div class="s">Round ${it.round_number ?? '?'}${it.interview_type ? ' · ' + esc(it.interview_type) : ''}</div>
            </div>
            <span class="due-today">${it.interview_time ? fmtTime(it.interview_time) : 'Today'}</span>
            <button class="btn ghost sm" data-act="openapp" data-id="${it.application_id || ''}">Open</button>
          </div>`).join('')}` : ''}
        ${ta.applications.length ? `<div class="search-group-label">Applications</div>${ta.applications.map(it => actionItem('app', it)).join('')}` : ''}
        ${ta.networking.length ? `<div class="search-group-label">Networking</div>${ta.networking.map(it => actionItem('net', it)).join('')}` : ''}
        ${taSuggestions.length ? `
          <div class="suggest-head" data-act="toggle-suggestions" title="${S.suggestCollapsed ? 'Expand' : 'Collapse'} suggestions">
            <span class="chev">${S.suggestCollapsed ? '▸' : '▾'}</span> Suggested Actions <span class="muted">(${taSuggestions.length})</span>
          </div>
          ${visibleSuggestions.map(s => `
            <div class="action-item">
              <div class="ai-main">
                <div class="t">${s.icon} ${esc(s.title)}</div>
                <div class="s">${esc(s.detail)}</div>
              </div>
              ${s.action === 'mark_nhb' ? `<button class="btn sm" data-act="mark-nhb" data-id="${s.target_id}">✔ Mark NHB</button>` : ''}
              <button class="btn ghost sm" data-act="${suggestAct[s.kind]}" data-id="${s.target_id || ''}">${s.kind === 'general' ? 'View' : 'Open'}</button>
              <button class="btn ghost sm" data-act="dismiss-suggestion" data-key="${esc(s.key)}" title="Dismiss this suggestion">✕</button>
            </div>`).join('')}
          ${!S.suggestCollapsed && taSuggestions.length > SUGGEST_DEFAULT_VISIBLE
            ? `<div style="padding-top:8px"><button class="btn ghost sm" data-act="toggle-suggest-all">${S.suggestShowAll ? '▴ Show fewer' : `▾ Show all ${taSuggestions.length}`}</button></div>`
            : ''}
        ` : ''}
      `}
      ${(ta.suggestions_dismissed || 0) > 0 ? `<div style="padding-top:10px"><button class="btn ghost sm" data-act="restore-suggestions">↩ Restore ${ta.suggestions_dismissed} dismissed</button></div>` : ''}
    </div>

    <div class="panel">
      <h3>📅 Upcoming Events</h3>
      ${upcoming.length === 0 ? '<div class="muted">Nothing scheduled. Add interview dates or follow-up dates and they\'ll show here.</div>'
        : upcoming.map(e => {
          const inDays = -daysSince(e.date);
          return `
          <div class="action-item">
            <div class="up-date">
              <div class="ud-day">${fmtDate(e.date)}</div>
              <div class="ud-in">${inDays === 1 ? 'tomorrow' : 'in ' + inDays + ' days'}</div>
            </div>
            <div class="ai-main">
              <div class="t">${e.icon} ${esc(e.title)}</div>
              <div class="s">${esc(e.sub)}</div>
            </div>
            ${badge(e.kind, e.kind === 'Interview' ? '#6366f1' : '#64748b')}
            <button class="btn ghost sm" data-act="${e.act}" data-id="${e.id || ''}">Open</button>
          </div>`;
        }).join('')}
    </div>

    <div class="panel">
      <div class="vel-head">
        <div class="vel-tabs" id="velMetric">
          <span class="vel-tab ${S.velMetric === 'apps' ? 'active' : ''}" data-metric="apps">Application Velocity</span>
          <span class="vel-tab ${S.velMetric === 'interviews' ? 'active' : ''}" data-metric="interviews">Interview Velocity</span>
        </div>
        <div class="vel-controls">
          <select id="velRange">${VEL_RANGES.map(([v, l]) => `<option value="${v}" ${S.velRange === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <div class="seg" id="velStyle">
            <button data-style="bar" class="${S.velStyle === 'bar' ? 'active' : ''}">▮ Bar</button>
            <button data-style="line" class="${S.velStyle === 'line' ? 'active' : ''}">⟋ Line</button>
          </div>
        </div>
      </div>
      <div id="velChart">${velocityChart(...velArgs())}</div>
    </div>

    <div class="bd-grid">
      ${bdTable('Applications by Status', d.by_status, 'fstatus')}
      ${bdTable('Applications by Source', d.by_source, 'fsource')}
      ${bdTable('Applications by Priority', d.by_priority, 'fpriority')}
      <details class="panel" ${window.innerWidth >= 768 ? 'open' : ''}>
        <summary>Networking</summary>
        <table class="bd-table">
          <tr data-goto="networking" title="View all contacts"><td>Total Contacts</td><td>${d.networking.total}</td><td></td></tr>
          <tr data-goto="networking" data-nstatus="Active" title="View active contacts"><td>Active</td><td>${d.networking.active}</td><td></td></tr>
          <tr data-goto="networking" data-nstatus="Awaiting Reply" title="View awaiting-reply contacts"><td>Awaiting Reply</td><td>${d.networking.awaiting_reply}</td><td></td></tr>
          <tr data-goto="networking" data-nreferred="yes" title="View contacts who referred a job"><td>Referred a Job</td><td>${d.networking.referred}</td><td></td></tr>
        </table>
      </details>
    </div>`;

  const redrawVel = () => {
    $('#velChart').innerHTML = velocityChart(...velArgs());
    $$('#velStyle button').forEach(b => b.classList.toggle('active', b.dataset.style === S.velStyle));
    $$('#velMetric .vel-tab').forEach(t => t.classList.toggle('active', t.dataset.metric === S.velMetric));
  };
  $$('#velMetric .vel-tab').forEach(t => t.onclick = () => {
    if (S.velMetric === t.dataset.metric) return;
    S.velMetric = t.dataset.metric;
    localStorage.setItem('velMetric', S.velMetric);
    redrawVel();
  });
  $('#velRange').onchange = (e) => {
    S.velRange = e.target.value;
    localStorage.setItem('velRange', S.velRange);
    redrawVel();
  };
  $$('#velStyle button').forEach(b => b.onclick = () => {
    S.velStyle = b.dataset.style;
    localStorage.setItem('velStyle', S.velStyle);
    redrawVel();
  });

  main.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) {
      // Clickable stats: stat cards / breakdown rows jump to a pre-filtered view.
      const nav = e.target.closest('[data-goto]');
      if (!nav) return;
      const g = nav.dataset;
      if (g.goto === 'applications') {
        S.filters = {
          status: g.fstatus || '', priority: g.fpriority || '',
          interview: g.finterview || '', location: '', source: g.fsource || '', tag: ''
        };
        S.filtersOpen = !!(g.fstatus || g.fpriority || g.finterview || g.fsource);
      } else if (g.goto === 'networking') {
        S.netFilters = { status: g.nstatus || '', referred: g.nreferred || '', company: '' };
      }
      setRoute(g.goto);
      return;
    }
    const { act, kind, id } = btn.dataset;
    if (act === 'mark-nhb') {
      const app = S.apps.find(a => a.id === Number(id));
      await api('PUT', '/api/applications/' + id, { status: 'Never Heard Back' });
      toast(`${app ? app.company : 'Application'} marked Never Heard Back`);
      await Promise.all([loadDash(), loadAll()]);
      renderDashboard(main);
      return;
    }
    if (act === 'openapp') {
      if (id) openDetail(Number(id)); else toast('No linked application');
      return;
    }
    if (act === 'opencontact') {
      const c = S.contacts.find(x => x.id === Number(id));
      if (c) openContactModal(c);
      return;
    }
    if (act === 'opensaved') {
      const j = S.saved.find(x => x.id === Number(id));
      if (j) { setRoute('saved'); setTimeout(() => openSavedModal(j), 120); }
      return;
    }
    if (act === 'route-apps') { setRoute('applications'); return; }
    if (act === 'dismiss-suggestion') {
      const key = btn.dataset.key;
      await api('POST', '/api/suggestions/dismiss', { key });
      await loadDash(); renderDashboard(main);
      toast('Suggestion dismissed', { label: 'Undo', fn: async () => {
        await api('POST', '/api/suggestions/restore', { key });
        await loadDash(); renderDashboard(main);
      } });
      return;
    }
    if (act === 'restore-suggestions') {
      await api('DELETE', '/api/suggestions/dismissals');
      toast('Suggestions restored');
      await loadDash(); renderDashboard(main);
      return;
    }
    if (act === 'toggle-suggestions') {
      S.suggestCollapsed = !S.suggestCollapsed;
      localStorage.setItem('suggestCollapsed', S.suggestCollapsed ? '1' : '0');
      renderDashboard(main);
      return;
    }
    if (act === 'toggle-suggest-all') {
      S.suggestShowAll = !S.suggestShowAll;
      localStorage.setItem('suggestShowAll', S.suggestShowAll ? '1' : '0');
      renderDashboard(main);
      return;
    }
    const url = (kind === 'app' ? '/api/applications/' : '/api/networking/') + id;
    if (act === 'clearfu') {
      await api('PUT', url, { followup_date: null });
      toast('Follow-up cleared');
    } else if (act === 'snooze') {
      const d3 = new Date(); d3.setDate(d3.getDate() + 3);
      const iso = `${d3.getFullYear()}-${String(d3.getMonth() + 1).padStart(2, '0')}-${String(d3.getDate()).padStart(2, '0')}`;
      await api('PUT', url, { followup_date: iso });
      toast('Snoozed 3 days');
    }
    await loadDash(); renderDashboard(main);
  };
}

const VEL_RANGES = [
  ['7d', 'Last week'],
  ['30d', 'Last month'],
  ['12w', 'Last 12 weeks'],
  ['6m', 'Last 6 months'],
  ['1y', 'Last year'],
];

function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Bucket records by a date field for the chart. Bucket size adapts to the
// range: days for week/month, Monday-start weeks for 12w/6m, months for a year.
// Defaults to applications by applied_date; pass items/dateField for interviews.
function computeVelocity(range, items, dateField) {
  items = items || S.apps;
  dateField = dateField || 'applied_date';
  const today = todayISO();
  const buckets = [];
  const lbl = iso => { const [, m, d] = iso.split('-').map(Number); return `${m}/${d}`; };
  if (range === '7d' || range === '30d') {
    const days = range === '7d' ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      const s = addDaysISO(today, -i);
      buckets.push({ start: s, end: addDaysISO(s, 1), label: lbl(s), unit: 'Day' });
    }
  } else if (range === '12w' || range === '6m') {
    const weeks = range === '12w' ? 12 : 26;
    const [y, m, d] = today.split('-').map(Number);
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
    const monday = addDaysISO(today, -dow);
    for (let i = weeks - 1; i >= 0; i--) {
      const s = addDaysISO(monday, -7 * i);
      buckets.push({ start: s, end: addDaysISO(s, 7), label: lbl(s), unit: 'Week of' });
    }
  } else { // 1y: monthly
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const [y, m] = today.split('-').map(Number);
    for (let i = 11; i >= 0; i--) {
      let yy = y, mm = m - i;
      while (mm < 1) { mm += 12; yy--; }
      let ny = yy, nm = mm + 1;
      if (nm > 12) { nm = 1; ny++; }
      buckets.push({
        start: `${yy}-${String(mm).padStart(2, '0')}-01`,
        end: `${ny}-${String(nm).padStart(2, '0')}-01`,
        label: `${MONTHS[mm - 1]}${mm === 1 ? ' ' + yy : ''}`, unit: 'Month of'
      });
    }
  }
  for (const b of buckets) {
    b.count = items.filter(it => it[dateField] && it[dateField] >= b.start && it[dateField] < b.end).length;
  }
  return buckets;
}

function velocityChart(buckets, style, noun) {
  noun = noun || 'application';
  const W = 720, H = 200, padL = 30, padB = 34, padT = 26;
  const max = Math.max(1, ...buckets.map(b => b.count));
  const n = buckets.length;
  const slot = (W - padL - 10) / n;
  const baseY = H - padB;
  const yFor = c => baseY - (H - padB - padT) * (c / max);
  const labelStep = Math.ceil(n / 13);
  const showVals = n <= 31;

  let grid = '', labels = '', marks = '';
  const steps = Math.min(max, 4);
  for (let i = 0; i <= steps; i++) {
    const v = Math.round((max / steps) * i);
    const y = yFor(v);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - 10}" y2="${y}" stroke="#334155" stroke-width="1" stroke-dasharray="3 4"/>
             <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#64748b">${v}</text>`;
  }
  buckets.forEach((b, i) => {
    if (i % labelStep === 0) {
      labels += `<text x="${(padL + i * slot + slot / 2).toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-size="10" fill="#64748b">${esc(b.label)}</text>`;
    }
  });

  if (style === 'line') {
    const pts = buckets.map((b, i) => [padL + i * slot + slot / 2, yFor(b.count)]);
    const lineStr = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const area = `M${pts[0][0].toFixed(1)},${baseY} L${lineStr.split(' ').join(' L')} L${pts[pts.length - 1][0].toFixed(1)},${baseY} Z`;
    marks += `<path d="${area}" fill="#6366f1" opacity="0.12"/>`;
    marks += `<polyline points="${lineStr}" fill="none" stroke="#6366f1" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    buckets.forEach((b, i) => {
      marks += `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="${n > 30 ? 2 : 3}" fill="#818cf8">
                  <title>${esc(b.unit)} ${fmtDate(b.start)}: ${b.count} ${noun}${b.count === 1 ? '' : 's'}</title>
                </circle>`;
      if (showVals && b.count) marks += `<text x="${pts[i][0].toFixed(1)}" y="${(pts[i][1] - 8).toFixed(1)}" text-anchor="middle" font-size="10" fill="#94a3b8">${b.count}</text>`;
    });
  } else {
    buckets.forEach((b, i) => {
      const h = (H - padB - padT) * (b.count / max);
      const x = padL + i * slot + slot * 0.15;
      const y = baseY - h;
      marks += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(slot * 0.7).toFixed(1)}" height="${Math.max(h, b.count ? 2 : 0).toFixed(1)}" rx="${slot > 12 ? 3 : 1}" fill="#6366f1">
                  <title>${esc(b.unit)} ${fmtDate(b.start)}: ${b.count} ${noun}${b.count === 1 ? '' : 's'}</title>
                </rect>`;
      if (showVals && b.count) marks += `<text x="${(x + slot * 0.35).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="#94a3b8">${b.count}</text>`;
    });
  }
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(noun.charAt(0).toUpperCase() + noun.slice(1))}s over time">${grid}${marks}${labels}</svg>`;
}

// ---------------- applications ----------------

function distinctTags() {
  const s = new Set();
  for (const a of S.apps) (a.tags || []).forEach(t => s.add(t));
  return Array.from(s).sort();
}

const CLOSED_STATUSES = ['Rejected', 'Withdrawn', 'Never Heard Back'];

function filteredApps() {
  const f = S.filters;
  return S.apps.filter(a => {
    if (f.status === '__closed') { if (!CLOSED_STATUSES.includes(a.status)) return false; }
    else if (f.status && a.status !== f.status) return false;
    if (f.priority && a.priority !== f.priority) return false;
    if (f.interview === 'yes' && !a.interview_landed) return false;
    if (f.interview === 'no' && a.interview_landed) return false;
    if (f.location && a.location_type !== f.location) return false;
    if (f.source && a.source !== f.source) return false;
    if (f.tag && !(a.tags || []).includes(f.tag)) return false;
    return true;
  });
}

function sortedApps(list) {
  const { key, dir } = S.sort;
  const prioRank = { High: 0, Medium: 1, Low: 2 };
  return list.slice().sort((a, b) => {
    let va = a[key], vb = b[key];
    if (key === 'priority') { va = prioRank[va] ?? 9; vb = prioRank[vb] ?? 9; }
    if (key === 'interview_landed') { va = va ? 0 : 1; vb = vb ? 0 : 1; }
    if (va === null || va === undefined || va === '') return 1;
    if (vb === null || vb === undefined || vb === '') return -1;
    if (typeof va === 'string') { va = va.toLowerCase(); vb = String(vb).toLowerCase(); }
    return va < vb ? -dir : va > vb ? dir : 0;
  });
}

function renderApplications(main) {
  const list = sortedApps(filteredApps());
  const f = S.filters;
  const anyFilter = Object.values(f).some(Boolean);

  main.innerHTML = `
    <div class="toolbar">
      <button class="btn ghost sm" id="filterToggle">⚲ Filters${anyFilter ? ' •' : ''}</button>
      <span class="muted">${list.length} of ${S.apps.length}</span>
      <div class="spacer"></div>
      <button class="btn ghost sm" id="csvBtn" title="Download the current (filtered) list as CSV">⬇ CSV</button>
      <button class="btn ghost sm" id="viewToggle">${S.viewMode === 'table' ? '🗂 Kanban' : '☰ Table'}</button>
      <button class="btn" id="addAppBtn">＋ Add Application</button>
    </div>
    <div id="filterBar"></div>
    <div id="bulkBar"></div>
    <div id="appList"></div>`;

  if (S.filtersOpen) renderFilterBar();
  renderBulkBar();
  if (S.viewMode === 'table') renderAppTable(list); else renderKanban(list);

  $('#filterToggle').onclick = () => { S.filtersOpen = !S.filtersOpen; renderApplications(main); };
  $('#csvBtn').onclick = () => exportCSV(list);
  $('#viewToggle').onclick = () => { S.viewMode = S.viewMode === 'table' ? 'kanban' : 'table'; S.selected.clear(); renderApplications(main); };
  $('#addAppBtn').onclick = () => openAppModal();
}

function renderFilterBar() {
  const f = S.filters;
  $('#filterBar').innerHTML = `
    <div class="filter-bar">
      <label class="fld">Status<select data-f="status">${options(STATUSES, f.status === '__closed' ? '' : f.status, 'All')}<option value="__closed" ${f.status === '__closed' ? 'selected' : ''}>Closed (any)</option></select></label>
      <label class="fld">Priority<select data-f="priority">${options(PRIORITIES, f.priority, 'All')}</select></label>
      <label class="fld">Interview<select data-f="interview">
        <option value="">All</option>
        <option value="yes" ${f.interview === 'yes' ? 'selected' : ''}>Landed</option>
        <option value="no" ${f.interview === 'no' ? 'selected' : ''}>Not landed</option>
      </select></label>
      <label class="fld">Location<select data-f="location">${options(LOCATIONS, f.location, 'All')}</select></label>
      <label class="fld">Source<select data-f="source">${options(SOURCES, f.source, 'All')}</select></label>
      <label class="fld">Tag<select data-f="tag">${options(distinctTags(), f.tag, 'All')}</select></label>
      <label class="fld">&nbsp;<button class="btn ghost sm" id="clearFilters">Clear</button></label>
    </div>`;
  $$('#filterBar select').forEach(sel => sel.onchange = () => {
    S.filters[sel.dataset.f] = sel.value;
    renderApplications($('#main'));
  });
  $('#clearFilters').onclick = () => {
    S.filters = { status: '', priority: '', interview: '', location: '', source: '', tag: '' };
    renderApplications($('#main'));
  };
}

function renderBulkBar() {
  const el = $('#bulkBar');
  if (!S.selected.size || S.viewMode !== 'table') { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="bulk-bar">
      <strong>${S.selected.size} selected</strong>
      <select id="bulkStatus"><option value="">Set status…</option>${STATUSES.map(s => `<option>${s}</option>`).join('')}</select>
      <button class="btn sm" id="bulkApply">Apply</button>
      <button class="btn danger sm" id="bulkDelete">Delete</button>
      <button class="btn ghost sm" id="bulkClear">Cancel</button>
    </div>`;
  $('#bulkApply').onclick = async () => {
    const st = $('#bulkStatus').value;
    if (!st) return toast('Pick a status first');
    for (const id of S.selected) await api('PUT', '/api/applications/' + id, { status: st });
    toast(`Updated ${S.selected.size} application(s)`);
    S.selected.clear();
    await loadAll(); renderApplications($('#main'));
  };
  $('#bulkDelete').onclick = async () => {
    if (!confirm(`Delete ${S.selected.size} application(s)? This also removes their interviews and activity.`)) return;
    for (const id of S.selected) await api('DELETE', '/api/applications/' + id);
    toast('Deleted');
    S.selected.clear();
    await loadAll(); renderApplications($('#main'));
  };
  $('#bulkClear').onclick = () => { S.selected.clear(); renderApplications($('#main')); };
}

function renderAppTable(list) {
  const cols = [
    ['company', 'Company'], ['role', 'Role'], ['applied_date', 'Applied'],
    ['priority', 'Priority'], ['status', 'Status'], ['interview_landed', 'Interview?'], ['followup_date', 'Follow-up'],
  ];
  const arrow = k => S.sort.key === k ? (S.sort.dir === 1 ? ' ▲' : ' ▼') : '';
  const allChecked = list.length && list.every(a => S.selected.has(a.id));
  $('#appList').innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th style="width:34px"><input type="checkbox" id="selAll" ${allChecked ? 'checked' : ''}></th>
          ${cols.map(([k, l]) => `<th class="sortable" data-sort="${k}">${l}${arrow(k)}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${list.map(a => `
            <tr data-id="${a.id}">
              <td><input type="checkbox" class="rowSel" data-id="${a.id}" ${S.selected.has(a.id) ? 'checked' : ''}></td>
              <td><strong>${esc(a.company)}</strong>${(a.tags || []).map(t => ` <span class="tag-chip">${esc(t)}</span>`).join('')}</td>
              <td class="muted">${esc(a.role)}</td>
              <td>${fmtDate(a.applied_date)}</td>
              <td>${priorityBadge(a.priority)}</td>
              <td>${statusBadge(a.status)}</td>
              <td>${a.interview_landed ? '✅' : '<span class="muted">—</span>'}</td>
              <td>${a.followup_date ? fmtDate(a.followup_date) : '<span class="muted">—</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${!list.length ? '<div class="empty-state">No applications match.</div>' : ''}
    </div>`;

  $$('#appList th.sortable').forEach(th => th.onclick = () => {
    const k = th.dataset.sort;
    if (S.sort.key === k) S.sort.dir *= -1; else S.sort = { key: k, dir: k.includes('date') ? -1 : 1 };
    renderApplications($('#main'));
  });
  $('#selAll') && ($('#selAll').onchange = (e) => {
    list.forEach(a => e.target.checked ? S.selected.add(a.id) : S.selected.delete(a.id));
    renderApplications($('#main'));
  });
  $$('#appList .rowSel').forEach(cb => cb.onclick = (e) => {
    e.stopPropagation();
    const id = Number(cb.dataset.id);
    cb.checked ? S.selected.add(id) : S.selected.delete(id);
    renderBulkBar();
  });
  $$('#appList tbody tr').forEach(tr => tr.onclick = (e) => {
    if (e.target.closest('input')) return;
    openDetail(Number(tr.dataset.id));
  });
}

function renderKanban(list) {
  $('#appList').innerHTML = `
    <div class="kanban">
      ${STATUSES.map(st => {
        const items = list.filter(a => a.status === st);
        return `
        <div class="kanban-col" data-status="${esc(st)}">
          <h4><span style="color:${STATUS_COLORS[st]}">${esc(st)}</span><span class="cnt">${items.length}</span></h4>
          ${items.map(a => {
            const days = daysSince(a.applied_date);
            return `
            <div class="kcard" draggable="true" data-id="${a.id}">
              <div class="kc-company">${esc(a.company)}</div>
              <div class="kc-role">${esc(a.role)}</div>
              <div class="kc-foot">${priorityBadge(a.priority)}<span>${days !== null ? days + 'd ago' : ''}</span></div>
              <select class="kmove" data-id="${a.id}" title="Move to another status">
                <option value="">Move to…</option>
                ${STATUSES.filter(x => x !== st).map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}
              </select>
            </div>`;
          }).join('')}
        </div>`;
      }).join('')}
    </div>`;

  let dragId = null;
  $$('#appList .kcard').forEach(card => {
    card.addEventListener('dragstart', () => { dragId = Number(card.dataset.id); card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { dragId = null; card.classList.remove('dragging'); });
    card.addEventListener('click', (e) => {
      if (e.target.closest('.kmove')) return;
      openDetail(Number(card.dataset.id));
    });
  });
  // Touch fallback: HTML5 drag-and-drop doesn't work on touchscreens.
  $$('#appList .kmove').forEach(sel => {
    sel.onclick = (e) => e.stopPropagation();
    sel.onchange = async (e) => {
      const st = e.target.value;
      if (!st) return;
      const id = Number(sel.dataset.id);
      const app = S.apps.find(a => a.id === id);
      await api('PUT', '/api/applications/' + id, { status: st });
      toast(`${app ? app.company : 'Application'} → ${st}`);
      await loadAll();
      renderApplications($('#main'));
    };
  });
  $$('#appList .kanban-col').forEach(col => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('dragover'); });
    col.addEventListener('dragleave', () => col.classList.remove('dragover'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('dragover');
      if (dragId == null) return;
      const st = col.dataset.status;
      const app = S.apps.find(a => a.id === dragId);
      if (!app || app.status === st) return;
      await api('PUT', '/api/applications/' + dragId, { status: st });
      toast(`${app.company} → ${st}`);
      await loadAll(); renderApplications($('#main'));
    });
  });
}

// ---------------- company detail drawer ----------------

const DRAWER_MIN = 400, DRAWER_DEF = 480;
function drawerMax() { return Math.min(Math.round(window.innerWidth * 0.92), 1100); }
function setDrawerWidth(w, save) {
  const d = $('#drawer');
  const clamped = Math.max(DRAWER_MIN, Math.min(Math.round(w), drawerMax()));
  d.style.width = clamped + 'px';
  if (save) localStorage.setItem('drawerW', clamped);
}
function toggleDrawerWide() {
  const cur = $('#drawer').getBoundingClientRect().width;
  setDrawerWidth(cur < drawerMax() - 60 ? drawerMax() : DRAWER_DEF, true);
}
function startDrawerResize(e) {
  const d = $('#drawer'), h = e.currentTarget;
  e.preventDefault();
  try { h.setPointerCapture(e.pointerId); } catch (err) {}
  h.classList.add('active');
  d.classList.add('resizing');
  h.onpointermove = ev => setDrawerWidth(window.innerWidth - ev.clientX, false);
  h.onpointerup = h.onpointercancel = ev => {
    try { h.releasePointerCapture(ev.pointerId); } catch (err) {}
    h.onpointermove = h.onpointerup = h.onpointercancel = null;
    h.classList.remove('active');
    d.classList.remove('resizing');
    localStorage.setItem('drawerW', parseInt(d.style.width) || DRAWER_DEF);
  };
}

async function openDetail(id) {
  S.detailId = id;
  S.detailActivity = await api('GET', `/api/applications/${id}/activity`);
  if (window.innerWidth >= 768) {
    const w = Number(localStorage.getItem('drawerW'));
    if (w) setDrawerWidth(w, false);
  }
  renderDrawer();
  $('#drawerOverlay').hidden = false;
  setTimeout(() => {
    $('#drawerOverlay').classList.add('show');
    $('#drawer').classList.add('open');
  }, 10);
}
function closeDetail() {
  S.detailId = null;
  $('#drawerOverlay').classList.remove('show');
  $('#drawer').classList.remove('open');
  setTimeout(() => { $('#drawerOverlay').hidden = true; $('#drawer').innerHTML = ''; }, 160);
}

function renderDrawer() {
  const a = S.apps.find(x => x.id === S.detailId);
  if (!a) return closeDetail();
  const rounds = S.interviews.filter(r => r.application_id === a.id)
    .sort((x, y) => (x.round_number || 0) - (y.round_number || 0));
  const contacts = S.contacts.filter(c => (c.company || '').toLowerCase() === a.company.toLowerCase());

  const fld = (label, field, type, listOpts) => {
    if (type === 'select') return `<label class="fld">${label}<select data-field="${field}">${options(listOpts, a[field], '—')}</select></label>`;
    if (type === 'check') return `<label class="chk" style="align-self:end;padding-bottom:6px"><input type="checkbox" data-field="${field}" ${a[field] ? 'checked' : ''}> ${label}</label>`;
    if (type === 'textarea') return `<label class="fld full">${label}<textarea data-field="${field}" rows="3">${esc(a[field])}</textarea></label>`;
    return `<label class="fld ${type === 'full' ? 'full' : ''}">${label}<input type="${type === 'date' ? 'date' : 'text'}" data-field="${field}" value="${esc(a[field])}"></label>`;
  };

  $('#drawer').innerHTML = `
    <div class="drawer-resize" id="drawerResize" title="Drag to resize"></div>
    <div class="drawer-body">
    <div class="drawer-head">
      <div style="flex:1">
        <h2>${esc(a.company)}</h2>
        <div class="sub">${esc(a.role)}</div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${statusBadge(a.status)}${priorityBadge(a.priority)}${(a.tags || []).map(t => `<span class="tag-chip">${esc(t)}</span>`).join('')}</div>
      </div>
      <button class="btn ghost icon" id="drawerExpand" title="Expand / shrink panel">⛶</button>
      <button class="btn ghost icon" id="drawerClose" title="Close">✕</button>
    </div>

    <section>
      <h3>Overview <span class="muted" style="text-transform:none;letter-spacing:0">— saves on change</span></h3>
      <div class="field-grid">
        ${fld('Company', 'company', 'text')}
        ${fld('Role', 'role', 'text')}
        ${fld('Applied Date', 'applied_date', 'date')}
        <label class="fld">Follow-up Date<input type="date" data-field="followup_date" value="${esc(a.followup_date)}">
          <span class="chip-row">${[['3', '+3d'], ['7', '+1w'], ['14', '+2w']].map(([days, label]) => `<button type="button" class="chip" data-chip="${days}">${label}</button>`).join('')}</span>
        </label>
        ${fld('Status', 'status', 'select', STATUSES)}
        ${fld('Priority', 'priority', 'select', PRIORITIES)}
        ${fld('Location', 'location_type', 'select', LOCATIONS)}
        ${fld('Source', 'source', 'select', SOURCES)}
        ${fld('Salary Range', 'salary_range', 'text')}
        ${fld('Recruiter Contact', 'recruiter_contact', 'text')}
        <label class="fld full">Tags (comma-separated)<input type="text" data-field="tags" value="${esc((a.tags || []).join(', '))}"></label>
        ${fld('Job Link', 'job_link', 'full')}
        ${a.job_link ? `<div class="full"><a href="${esc(a.job_link)}" target="_blank" rel="noopener">Open job posting ↗</a></div>` : ''}
        ${fld('Interview landed', 'interview_landed', 'check')}
        ${fld('Notes', 'notes', 'textarea')}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn sm" id="saveAll">Save</button>
        <button class="btn danger sm" id="deleteApp" style="margin-left:auto">Delete Application</button>
      </div>
    </section>

    <section>
      <h3>Interview Prep Notes</h3>
      <textarea id="prepNotes" rows="5" placeholder="Research, talking points, questions to ask…">${esc(a.interview_prep_notes)}</textarea>
      <button class="btn sm" id="savePrep" style="margin-top:8px">Save Prep Notes</button>
    </section>

    ${a.fit_analysis ? `
    <section>
      <h3>Role Fit Read ${a.fit_analysis_date ? `<span class="muted" style="text-transform:none;letter-spacing:0">— ${fmtDate(a.fit_analysis_date)}</span>` : ''}</h3>
      <div class="rf-result">${rfRenderResult(rfParse(a.fit_analysis))}</div>
      <button class="btn ghost sm" id="clearFit" style="margin-top:10px">Remove this read</button>
    </section>` : ''}

    <section>
      <h3>Interview Log (${rounds.length})</h3>
      <div id="roundList">
        ${rounds.map(r => `
          <div class="round-card">
            <div class="rc-head">
              <span class="rn" style="color:#818cf8;font-weight:800">R${r.round_number ?? '?'}</span>
              <strong>${esc(r.interview_type || 'Interview')}</strong>
              ${outcomeBadge(r.outcome)}
              <span style="margin-left:auto;display:flex;gap:4px">
                <button class="btn ghost sm" data-editround="${r.id}">✎</button>
                <button class="btn ghost sm" data-delround="${r.id}">🗑</button>
              </span>
            </div>
            <div class="rc-meta">${fmtDate(r.interview_date)}${r.interview_time ? ` ${fmtTime(r.interview_time)}` : ''}${r.duration_minutes ? ` · ${r.duration_minutes} min` : ''}${r.interviewers ? ` · ${esc(r.interviewers)}` : ''}</div>
            ${r.interviewer_titles ? `<div class="rc-meta">${esc(r.interviewer_titles)}</div>` : ''}
            ${r.notes ? `<div class="rc-notes">${esc(r.notes)}</div>` : ''}
          </div>`).join('') || '<div class="muted">No rounds logged.</div>'}
      </div>
      <div id="roundForm"></div>
      <button class="btn ghost sm" id="addRound" style="margin-top:8px">＋ Add Round</button>
    </section>

    <section>
      <h3>Activity Timeline</h3>
      <div id="noteForm"></div>
      <button class="btn ghost sm" id="addNote" style="margin-bottom:10px">＋ Add Note</button>
      ${S.detailActivity.map(ev => `
        <div class="timeline-item">
          <div class="tl-date">${fmtDate(ev.event_date)}</div>
          <div style="flex:1">
            ${badge(ev.event_type, '#6366f1')}
            ${ev.note ? `<div class="tl-note">${esc(ev.note)}</div>` : ''}
          </div>
        </div>`).join('') || '<div class="muted">No activity yet.</div>'}
    </section>

    <section>
      <h3>Networking @ ${esc(a.company)}</h3>
      ${contacts.map(c => `
        <div class="contact-mini" data-contact="${c.id}">
          <div class="cm-name">${esc(c.name)} ${netBadge(c.status)}</div>
          <div class="cm-sub">${esc(c.title || '')}${c.last_contact_date ? ` · last contact ${fmtDate(c.last_contact_date)}` : ''}</div>
        </div>`).join('') || '<div class="muted">No contacts at this company.</div>'}
    </section>
    </div>`;

  // --- wire up ---
  $('#drawerClose').onclick = closeDetail;
  $('#drawerExpand').onclick = toggleDrawerWide;
  $('#drawerResize').onpointerdown = startDrawerResize;
  $$('#drawer .chip').forEach(ch => ch.onclick = () => {
    const inp = $('#drawer input[data-field="followup_date"]');
    inp.value = addDaysISO(todayISO(), Number(ch.dataset.chip));
    inp.dispatchEvent(new Event('change'));
  });

  const saveField = async (el) => {
    const field = el.dataset.field;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (field === 'tags') value = el.value.split(',').map(t => t.trim()).filter(Boolean);
    else value = el.value === '' ? null : el.value;
    const wasStatus = field === 'status';
    const updated = await api('PUT', '/api/applications/' + a.id, { [field]: value });
    const i = S.apps.findIndex(x => x.id === a.id);
    if (i >= 0) S.apps[i] = updated;
    toast('Saved');
    if (wasStatus) {
      S.detailActivity = await api('GET', `/api/applications/${a.id}/activity`);
      renderDrawer();
    }
    if (S.route === 'applications') refreshListBehindDrawer();
    else if (S.route === 'dashboard') loadDash().then(() => renderDashboard($('#main')));
  };
  $$('#drawer [data-field]').forEach(el => el.onchange = () => saveField(el));
  $('#saveAll').onclick = () => { toast('Saved'); };

  $('#deleteApp').onclick = async () => {
    if (!confirm(`Delete ${a.company} — ${a.role}? This also removes its interviews and activity log.`)) return;
    await api('DELETE', '/api/applications/' + a.id);
    toast('Application deleted');
    closeDetail();
    await loadAll();
    render();
  };

  if ($('#clearFit')) $('#clearFit').onclick = async () => {
    if (!confirm('Remove the saved role fit read from this application?')) return;
    const updated = await api('PUT', '/api/applications/' + a.id, { fit_analysis: null, fit_analysis_date: null });
    const i = S.apps.findIndex(x => x.id === a.id);
    if (i >= 0) S.apps[i] = updated;
    toast('Read removed');
    renderDrawer();
  };

  $('#savePrep').onclick = async () => {
    const updated = await api('PUT', '/api/applications/' + a.id, { interview_prep_notes: $('#prepNotes').value || null });
    const i = S.apps.findIndex(x => x.id === a.id);
    if (i >= 0) S.apps[i] = updated;
    toast('Prep notes saved');
  };

  $('#addRound').onclick = () => showRoundForm(a, null, rounds);
  $$('#drawer [data-editround]').forEach(b => b.onclick = () => {
    const r = rounds.find(x => x.id === Number(b.dataset.editround));
    showRoundForm(a, r, rounds);
  });
  $$('#drawer [data-delround]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this interview round?')) return;
    await api('DELETE', '/api/interviews/' + b.dataset.delround);
    toast('Round deleted');
    await loadAll(); renderDrawer();
  });

  $('#addNote').onclick = () => {
    $('#noteForm').innerHTML = `
      <div class="panel" style="margin-bottom:10px">
        <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <select id="nfType">${options(EVENT_TYPES, 'Note')}</select>
          <input type="date" id="nfDate" value="${todayISO()}">
        </div>
        <textarea id="nfNote" rows="2" placeholder="What happened?"></textarea>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn sm" id="nfSave">Add</button>
          <button class="btn ghost sm" id="nfCancel">Cancel</button>
        </div>
      </div>`;
    $('#nfSave').onclick = async () => {
      await api('POST', `/api/applications/${a.id}/activity`, {
        event_type: $('#nfType').value, event_date: $('#nfDate').value, note: $('#nfNote').value || null
      });
      S.detailActivity = await api('GET', `/api/applications/${a.id}/activity`);
      toast('Note added');
      renderDrawer();
    };
    $('#nfCancel').onclick = () => { $('#noteForm').innerHTML = ''; };
  };

  $$('#drawer [data-contact]').forEach(el => el.onclick = () => {
    openContactModal(S.contacts.find(c => c.id === Number(el.dataset.contact)));
  });
}

function refreshListBehindDrawer() {
  // re-render the applications list without disturbing the open drawer
  const main = $('#main');
  if (S.route === 'applications') renderApplications(main);
}

function showRoundForm(app, round, rounds) {
  const r = round || { round_number: (rounds.reduce((m, x) => Math.max(m, x.round_number || 0), 0) + 1), interview_type: 'Recruiter Screening' };
  $('#roundForm').innerHTML = `
    <div class="panel" style="margin-top:10px">
      <div class="field-grid">
        <label class="fld">Round #<input type="number" id="rfNum" value="${esc(r.round_number)}" min="1"></label>
        <label class="fld">Type<select id="rfType">${options(INT_TYPES, r.interview_type)}</select></label>
        <label class="fld">Date<input type="date" id="rfDate" value="${esc(r.interview_date)}"></label>
        <label class="fld">Time<input type="time" id="rfTime" value="${esc(r.interview_time)}"></label>
        <label class="fld">Duration (min)<input type="number" id="rfDur" value="${esc(r.duration_minutes)}" min="0"></label>
        <label class="fld full">Interviewers<input type="text" id="rfWho" value="${esc(r.interviewers)}"></label>
        <label class="fld full">Interviewer Titles<input type="text" id="rfTitles" value="${esc(r.interviewer_titles)}"></label>
        <label class="fld full">Outcome<input type="text" id="rfOutcome" value="${esc(r.outcome)}" placeholder="Passed / Rejected / Pending…"></label>
        <label class="fld full">Notes<textarea id="rfNotes" rows="2">${esc(r.notes)}</textarea></label>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn sm" id="rfSave">${round ? 'Save Round' : 'Add Round'}</button>
        <button class="btn ghost sm" id="rfCancel">Cancel</button>
      </div>
    </div>`;
  $('#rfSave').onclick = async () => {
    const payload = {
      application_id: app.id,
      round_number: Number($('#rfNum').value) || null,
      interview_type: $('#rfType').value,
      interview_date: $('#rfDate').value || null,
      interview_time: $('#rfTime').value || null,
      duration_minutes: $('#rfDur').value ? Number($('#rfDur').value) : null,
      interviewers: $('#rfWho').value || null,
      interviewer_titles: $('#rfTitles').value || null,
      outcome: $('#rfOutcome').value || null,
      notes: $('#rfNotes').value || null,
    };
    if (round) await api('PUT', '/api/interviews/' + round.id, payload);
    else await api('POST', '/api/interviews', payload);
    toast(round ? 'Round updated' : 'Round added');
    await loadAll(); renderDrawer();
  };
  $('#rfCancel').onclick = () => { $('#roundForm').innerHTML = ''; };
}

// ---------------- modals ----------------

function openModal(html, onMount) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-overlay"><div class="modal">${html}</div></div>`;
  const overlay = $('.modal-overlay', root);
  setTimeout(() => overlay.classList.add('show'), 10);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
  if (onMount) onMount(overlay);
}
function closeModal() {
  const overlay = $('#modalRoot .modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('show');
  setTimeout(() => { $('#modalRoot').innerHTML = ''; }, 160);
}

function openAppModal() {
  openModal(`
    <h2>New Application</h2>
    <div class="form-grid">
      <label class="fld">Company *<input id="mCompany" autofocus></label>
      <div class="full" id="dupWarn" hidden></div>
      <label class="fld">Role *<input id="mRole"></label>
      <label class="fld">Applied Date<input type="date" id="mDate" value="${todayISO()}"></label>
      <label class="fld">Priority<select id="mPriority">${options(PRIORITIES, 'Medium')}</select></label>
      <label class="fld">Status<select id="mStatus">${options(STATUSES, 'In Progress')}</select></label>
      <label class="fld">Location<select id="mLocation">${options(LOCATIONS, '', '—')}</select></label>
      <label class="fld">Source<select id="mSource">${options(SOURCES, 'LinkedIn')}</select></label>
      <label class="fld">Salary Range<input id="mSalary" placeholder="$120k-$150k"></label>
      <label class="fld">Recruiter Contact<input id="mRecruiter"></label>
      <label class="fld">Follow-up Date<input type="date" id="mFollowup"></label>
      <label class="fld full">Job Link<input id="mLink" placeholder="https://…"></label>
      <label class="fld full">Tags (comma-separated)<input id="mTags" placeholder="CSM, AI Strategy"></label>
      <label class="chk"><input type="checkbox" id="mInterview"> Interview landed</label>
      <label class="fld full">Notes<textarea id="mNotes" rows="3"></textarea></label>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" id="mCancel">Cancel</button>
      <button class="btn" id="mSave">Add Application</button>
    </div>`, () => {
    $('#mCancel').onclick = closeModal;
    // Duplicate warning: flag existing applications at the same company.
    $('#mCompany').oninput = () => {
      const v = $('#mCompany').value.trim().toLowerCase();
      const warn = $('#dupWarn');
      const matches = v.length >= 3
        ? S.apps.filter(a => a.company.toLowerCase().includes(v) || v.includes(a.company.toLowerCase())).slice(0, 3)
        : [];
      warn.hidden = !matches.length;
      warn.innerHTML = matches.length ? `<div class="dup-warn">⚠ Already in your tracker:${matches.map(m =>
        `<div class="dup-item">${esc(m.company)} — ${esc(m.role)} (${fmtDate(m.applied_date)}, ${esc(m.status)})</div>`).join('')}</div>` : '';
    };
    $('#mSave').onclick = async () => {
      const company = $('#mCompany').value.trim(), role = $('#mRole').value.trim();
      if (!company || !role) return toast('Company and Role are required');
      await api('POST', '/api/applications', {
        company, role,
        applied_date: $('#mDate').value || null,
        priority: $('#mPriority').value,
        status: $('#mStatus').value,
        location_type: $('#mLocation').value || null,
        source: $('#mSource').value,
        salary_range: $('#mSalary').value || null,
        recruiter_contact: $('#mRecruiter').value || null,
        followup_date: $('#mFollowup').value || null,
        job_link: $('#mLink').value || null,
        tags: $('#mTags').value.split(',').map(t => t.trim()).filter(Boolean),
        interview_landed: $('#mInterview').checked,
        notes: $('#mNotes').value || null,
      });
      toast('Application added');
      closeModal();
      await loadAll();
      if (S.route === 'dashboard') await loadDash();
      render();
    };
    setTimeout(() => $('#mCompany').focus(), 50);
  });
}

function openContactModal(contact) {
  const c = contact || {};
  openModal(`
    <h2>${contact ? esc(c.name) : 'New Contact'}</h2>
    <div class="form-grid">
      <label class="fld">Name *<input id="cName" value="${esc(c.name)}"></label>
      <label class="fld">Company<input id="cCompany" value="${esc(c.company)}"></label>
      <label class="fld">Title<input id="cTitle" value="${esc(c.title)}"></label>
      <label class="fld">How Connected<input id="cHow" value="${esc(c.how_connected)}" placeholder="LinkedIn / Referral / …"></label>
      <label class="fld">Last Contact<input type="date" id="cLast" value="${esc(c.last_contact_date)}"></label>
      <label class="fld">Follow-up Date<input type="date" id="cFollowup" value="${esc(c.followup_date)}">
        <span class="chip-row">${[['3', '+3d'], ['7', '+1w'], ['14', '+2w']].map(([days, label]) => `<button type="button" class="chip" data-chip="${days}">${label}</button>`).join('')}</span>
      </label>
      <label class="fld">Status<select id="cStatus">${options(NET_STATUSES, c.status || 'Active')}</select></label>
      <label class="chk" style="align-self:end;padding-bottom:8px"><input type="checkbox" id="cReferred" ${c.referred_job ? 'checked' : ''}> Referred a job</label>
      <label class="fld full">Job Link<input id="cLink" value="${esc(c.job_link)}"></label>
      <label class="fld full">Notes<textarea id="cNotes" rows="3">${esc(c.notes)}</textarea></label>
    </div>
    <div class="modal-actions">
      ${contact ? '<button class="btn danger left" id="cDelete">Delete</button>' : ''}
      <button class="btn ghost" id="cCancel">Cancel</button>
      <button class="btn" id="cSave">${contact ? 'Save' : 'Add Contact'}</button>
    </div>`, () => {
    $('#cCancel').onclick = closeModal;
    $$('#modalRoot .chip').forEach(ch => ch.onclick = () => {
      $('#cFollowup').value = addDaysISO(todayISO(), Number(ch.dataset.chip));
    });
    if (contact) $('#cDelete').onclick = async () => {
      if (!confirm(`Delete contact ${c.name}?`)) return;
      await api('DELETE', '/api/networking/' + c.id);
      toast('Contact deleted');
      closeModal(); await loadAll(); render();
    };
    $('#cSave').onclick = async () => {
      const name = $('#cName').value.trim();
      if (!name) return toast('Name is required');
      const payload = {
        name,
        company: $('#cCompany').value || null,
        title: $('#cTitle').value || null,
        how_connected: $('#cHow').value || null,
        last_contact_date: $('#cLast').value || null,
        followup_date: $('#cFollowup').value || null,
        status: $('#cStatus').value,
        referred_job: $('#cReferred').checked,
        job_link: $('#cLink').value || null,
        notes: $('#cNotes').value || null,
      };
      if (contact) await api('PUT', '/api/networking/' + c.id, payload);
      else await api('POST', '/api/networking', payload);
      toast(contact ? 'Contact saved' : 'Contact added');
      closeModal(); await loadAll(); render();
      if (S.detailId) renderDrawer();
    };
  });
}

function openInterviewModal() {
  if (!S.apps.length) return toast('Add an application first');
  const appOpts = S.apps.slice()
    .sort((a, b) => a.company.localeCompare(b.company))
    .map(a => `<option value="${a.id}">${esc(a.company)} — ${esc(a.role)}</option>`).join('');
  openModal(`
    <h2>New Interview Round</h2>
    <div class="form-grid">
      <label class="fld full">Application *<select id="iApp">${appOpts}</select></label>
      <label class="fld">Round #<input type="number" id="iNum" value="1" min="1"></label>
      <label class="fld">Type<select id="iType">${options(INT_TYPES, 'Recruiter Screening')}</select></label>
      <label class="fld">Date<input type="date" id="iDate"></label>
      <label class="fld">Time<input type="time" id="iTime"></label>
      <label class="fld">Duration (min)<input type="number" id="iDur" min="0"></label>
      <label class="fld full">Interviewers<input id="iWho"></label>
      <label class="fld full">Interviewer Titles<input id="iTitles"></label>
      <label class="fld full">Outcome<input id="iOutcome" placeholder="Passed / Rejected / leave blank if pending"></label>
      <label class="fld full">Notes<textarea id="iNotes" rows="3"></textarea></label>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" id="iCancel">Cancel</button>
      <button class="btn" id="iSave">Add Round</button>
    </div>`, () => {
    const syncRound = () => {
      const appId = Number($('#iApp').value);
      const next = S.interviews.filter(r => r.application_id === appId)
        .reduce((m, r) => Math.max(m, r.round_number || 0), 0) + 1;
      $('#iNum').value = next;
    };
    syncRound();
    $('#iApp').onchange = syncRound;
    $('#iCancel').onclick = closeModal;
    $('#iSave').onclick = async () => {
      await api('POST', '/api/interviews', {
        application_id: Number($('#iApp').value),
        round_number: Number($('#iNum').value) || null,
        interview_type: $('#iType').value,
        interview_date: $('#iDate').value || null,
        interview_time: $('#iTime').value || null,
        duration_minutes: $('#iDur').value ? Number($('#iDur').value) : null,
        interviewers: $('#iWho').value || null,
        interviewer_titles: $('#iTitles').value || null,
        outcome: $('#iOutcome').value || null,
        notes: $('#iNotes').value || null,
      });
      toast('Interview round added');
      closeModal(); await loadAll(); render();
    };
  });
}

// ---------------- saved jobs tab ----------------

function renderSaved(main) {
  const list = S.saved;
  main.innerHTML = `
    <div class="toolbar">
      <span class="muted">${list.length} saved job${list.length === 1 ? '' : 's'} to apply to later</span>
      <div class="spacer"></div>
      <button class="btn" id="addSavedBtn">＋ Save a Job</button>
    </div>
    ${list.map(j => `
      <div class="net-row" data-id="${j.id}">
        <div class="nr-main">
          <div class="nr-name">${esc(j.company)} ${priorityBadge(j.priority)}</div>
          <div class="nr-sub">${esc(j.role)}${j.salary_range ? ` · ${esc(j.salary_range)}` : ''}${j.location_type ? ` · ${esc(j.location_type)}` : ''}</div>
          ${j.notes ? `<div class="nr-sub">${esc(j.notes)}</div>` : ''}
        </div>
        ${j.job_link ? `<a href="${esc(j.job_link)}" target="_blank" rel="noopener" class="btn ghost sm" onclick="event.stopPropagation()">↗ Posting</a>` : ''}
        <button class="btn sm" data-apply="${j.id}">Apply Now</button>
        <div class="nr-date">saved ${fmtDate(j.saved_date)}</div>
      </div>`).join('') || `
      <div class="empty-state">
        No saved jobs yet.<br><br>
        When you find a posting you want to apply to later, hit <strong>Save a Job</strong> —
        when you apply, click <strong>Apply Now</strong> and it moves into Applications automatically.
      </div>`}`;

  $('#addSavedBtn').onclick = () => openSavedModal(null);
  $$('.net-row', main).forEach(row => row.onclick = (e) => {
    if (e.target.closest('[data-apply]') || e.target.closest('a')) return;
    openSavedModal(S.saved.find(j => j.id === Number(row.dataset.id)));
  });
  $$('[data-apply]', main).forEach(btn => btn.onclick = async (e) => {
    e.stopPropagation();
    const j = S.saved.find(x => x.id === Number(btn.dataset.apply));
    if (!confirm(`Move "${j.company} — ${j.role}" to Applications as applied today?`)) return;
    const newApp = await api('POST', `/api/saved-jobs/${j.id}/apply`);
    toast(`${j.company} moved to Applications`);
    await loadAll();
    setRoute('applications');
    setTimeout(() => openDetail(newApp.id), 250);
  });
}

function openSavedModal(saved) {
  const j = saved || {};
  openModal(`
    <h2>${saved ? 'Edit Saved Job' : 'Save a Job for Later'}</h2>
    <div class="form-grid">
      <label class="fld">Company *<input id="sjCompany" value="${esc(j.company)}"></label>
      <label class="fld">Role *<input id="sjRole" value="${esc(j.role)}"></label>
      <label class="fld">Priority / Interest<select id="sjPriority">${options(PRIORITIES, j.priority || 'Medium')}</select></label>
      <label class="fld">Location<select id="sjLocation">${options(LOCATIONS, j.location_type, '—')}</select></label>
      <label class="fld">Salary Range<input id="sjSalary" value="${esc(j.salary_range)}" placeholder="$120k-$150k"></label>
      <label class="fld">Source<select id="sjSource">${options(SOURCES, j.source, '—')}</select></label>
      <label class="fld full">Job Link<input id="sjLink" value="${esc(j.job_link)}" placeholder="https://…"></label>
      <label class="fld full">Notes<textarea id="sjNotes" rows="3" placeholder="Why it's interesting, deadline, referral plan…">${esc(j.notes)}</textarea></label>
    </div>
    <div class="modal-actions">
      ${saved ? '<button class="btn danger left" id="sjDelete">Delete</button>' : ''}
      <button class="btn ghost" id="sjCancel">Cancel</button>
      <button class="btn" id="sjSave">${saved ? 'Save' : 'Add to Saved Jobs'}</button>
    </div>`, () => {
    $('#sjCancel').onclick = closeModal;
    if (saved) $('#sjDelete').onclick = async () => {
      if (!confirm(`Delete saved job at ${j.company}?`)) return;
      await api('DELETE', '/api/saved-jobs/' + j.id);
      toast('Saved job deleted');
      closeModal(); await loadAll(); render();
    };
    $('#sjSave').onclick = async () => {
      const company = $('#sjCompany').value.trim(), role = $('#sjRole').value.trim();
      if (!company || !role) return toast('Company and Role are required');
      const payload = {
        company, role,
        priority: $('#sjPriority').value,
        location_type: $('#sjLocation').value || null,
        salary_range: $('#sjSalary').value || null,
        source: $('#sjSource').value || null,
        job_link: $('#sjLink').value || null,
        notes: $('#sjNotes').value || null,
      };
      if (saved) await api('PUT', '/api/saved-jobs/' + j.id, payload);
      else await api('POST', '/api/saved-jobs', payload);
      toast(saved ? 'Saved job updated' : 'Job saved for later');
      closeModal(); await loadAll(); render();
    };
    setTimeout(() => $('#sjCompany').focus(), 50);
  });
}

// ---------------- role fit analyzer ----------------

// Parses the analyzer's plain-text contract. Runs on every streamed chunk, so
// it has to tolerate a half-written response.
function rfParse(raw) {
  const blocks = [];
  let verdict = null, summaryParts = [], readingSummary = false;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t.toUpperCase().startsWith('VERDICT:')) { verdict = t.slice(8).trim(); readingSummary = false; continue; }
    if (t.toUpperCase().startsWith('SUMMARY:')) { summaryParts.push(t.slice(8).trim()); readingSummary = true; continue; }
    if (t.startsWith('##')) { readingSummary = false; blocks.push({ kind: 'heading', text: t.replace(/^#+\s*/, '') }); continue; }
    if (t.startsWith('- ') || t.startsWith('* ')) {
      readingSummary = false;
      const item = t.slice(2).trim();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'list') last.items.push(item);
      else blocks.push({ kind: 'list', items: [item] });
      continue;
    }
    if (!t) { readingSummary = false; continue; }
    if (readingSummary) { summaryParts.push(t); continue; }
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'paragraph') last.text += ' ' + t;
    else blocks.push({ kind: 'paragraph', text: t });
  }
  return { verdict, summary: summaryParts.join(' '), blocks };
}

// Escape first, then promote **bold**, so pasted text can never inject markup.
function rfInline(text) {
  return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function rfVerdictColor(v) {
  const s = (v || '').toLowerCase();
  if (s.startsWith('strong') || s.startsWith('solid')) return '#22c55e';
  if (s.startsWith('partial')) return '#f59e0b';
  if (s.startsWith('weak')) return '#f97316';
  if (s.startsWith('not a fit')) return '#ef4444';
  return '#64748b';
}

function rfRenderResult(parsed) {
  if (!parsed) return '';
  return `
    ${parsed.verdict ? badge(parsed.verdict, rfVerdictColor(parsed.verdict)) : ''}
    ${parsed.summary ? `<p class="rf-summary">${rfInline(parsed.summary)}</p>` : ''}
    ${parsed.blocks.map(b => {
      if (b.kind === 'heading') return `<h4 class="rf-heading">${esc(b.text)}</h4>`;
      if (b.kind === 'list') return `<ul class="rf-list">${b.items.map(i => `<li>${rfInline(i)}</li>`).join('')}</ul>`;
      return `<p class="rf-para">${rfInline(b.text)}</p>`;
    }).join('')}`;
}

// The setup panel doubles as the background editor: it is where someone with a
// fresh clone gets the analyzer working, and where they revise it later.
function rfProfilePanel(cfg, rf) {
  const fileBased = cfg.profile_source === 'file';
  const saved = rf.profile || {};
  const editing = rf.editingProfile || (!cfg.has_profile && !fileBased);
  const out = [];

  if (cfg.profile_error) {
    out.push(`<div class="rf-unconfigured">
      <strong>profile.js could not be loaded.</strong>
      <div>${esc(cfg.profile_error)}</div>
      <div class="muted">Fix the file, or save a background below and the app will use that instead.</div>
    </div>`);
  }
  if (!cfg.has_key) {
    out.push(`<div class="rf-unconfigured">
      <strong>No API key yet.</strong>
      <div>Set <code>ANTHROPIC_API_KEY</code> in the environment and reload. Keys come from
        <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>.</div>
    </div>`);
  }
  if (fileBased) {
    out.push(`<div class="rf-profile-note muted">Reading your background from <code>profile.js</code>, which takes precedence over anything saved in the app.</div>`);
  } else if (cfg.has_profile && !editing) {
    out.push(`<div class="rf-profile-note">
      <span>Background saved${saved.updated_at ? ` · updated ${fmtDate(saved.updated_at.slice(0, 10))}` : ''}.</span>
      <button class="btn ghost sm" id="rfpEdit">Edit background</button>
    </div>`);
  }
  if (editing && !fileBased) {
    out.push(`<div class="rf-setup">
      <strong>${cfg.has_profile ? 'Your background' : 'Add your background to get started'}</strong>
      <p class="muted">Paste your resume, or write it out: the roles you have held, what you actually did, numbers where you have them, and the tools you have genuinely used. The analyzer treats this as the complete record, so anything missing here shows up as a gap rather than being assumed.</p>
      <input type="text" id="rfpName" placeholder="Your name (optional)" value="${esc(saved.name || '')}">
      <textarea id="rfpText" rows="12" placeholder="Paste your resume here, or write a summary of your background.">${esc(saved.profile_text || '')}</textarea>
      <div class="rf-meta"><span id="rfpCount" class="muted"></span><span class="muted">Stored in your database, never committed</span></div>
      <div class="rf-setup-actions">
        <button class="btn" id="rfpSave">Save background</button>
        ${cfg.has_profile ? '<button class="btn ghost" id="rfpCancel">Cancel</button>' : ''}
        ${cfg.has_profile ? '<button class="btn danger sm" id="rfpDelete">Remove</button>' : ''}
      </div>
    </div>`);
  }
  return out.join('');
}

async function renderRoleFit(main) {
  if (!S.rf.config) {
    try { S.rf.config = await api('GET', '/api/analyze/status'); }
    catch (e) { S.rf.config = { configured: false, has_profile: false, has_key: false }; }
  }
  if (!S.rf.profile) {
    try { S.rf.profile = await api('GET', '/api/profile'); }
    catch (e) { S.rf.profile = { profile_text: '', name: null }; }
  }
  const cfg = S.rf.config;
  const rf = S.rf;

  // Anything analyzed can be filed against an application or a saved job.
  const targets = [
    ...S.apps.map(a => ({ kind: 'app', id: a.id, label: `${a.company} — ${a.role}` })),
    ...S.saved.map(j => ({ kind: 'saved', id: j.id, label: `${j.company} — ${j.role} (saved)` })),
  ];

  main.innerHTML = `
    <div class="rf-grid">
      <div class="panel">
        <h3>Job description</h3>
        <p class="muted" style="margin:-4px 0 10px;font-size:12.5px">
          Paste the posting. The analyzer reads it against your background and is told to name the gaps as plainly as the matches.
        </p>
        ${rfProfilePanel(cfg, rf)}
        <textarea id="rfInput" rows="16" placeholder="Paste the full job description here, including responsibilities and requirements."
          ${cfg.configured ? '' : 'disabled'}>${esc(rf.text)}</textarea>
        <div class="rf-meta">
          <span id="rfCount" class="muted"></span>
          <span class="muted">Ctrl+Enter to run</span>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn" id="rfRun" ${cfg.configured ? '' : 'disabled'}>Analyze fit</button>
          <button class="btn ghost" id="rfClear">Clear</button>
        </div>
      </div>

      <div class="panel">
        <h3>The read</h3>
        <div id="rfResult" class="rf-result" aria-live="polite"></div>
        <div id="rfSave"></div>
      </div>
    </div>`;

  const input = $('#rfInput'), result = $('#rfResult'), saveBox = $('#rfSave');

  // --- background editor ---
  const refreshProfile = async () => {
    S.rf.config = await api('GET', '/api/analyze/status');
    S.rf.profile = await api('GET', '/api/profile');
  };
  const pText = $('#rfpText');
  if (pText) {
    const pMin = cfg.profile_min_chars || 200;
    const pCount = () => {
      const n = pText.value.trim().length;
      $('#rfpCount').textContent = n < pMin
        ? `${n.toLocaleString()} characters, ${pMin} minimum`
        : `${n.toLocaleString()} characters`;
      $('#rfpCount').style.color = n && n < pMin ? '#fb923c' : '';
    };
    pText.oninput = pCount;
    pCount();
  }
  const bind = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  bind('#rfpEdit', () => { rf.editingProfile = true; renderRoleFit(main); });
  bind('#rfpCancel', () => { rf.editingProfile = false; renderRoleFit(main); });
  bind('#rfpSave', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api('PUT', '/api/profile', { profile_text: pText.value, name: $('#rfpName').value });
      await refreshProfile();
      rf.editingProfile = false;
      toast('Background saved');
      renderRoleFit(main);
    } catch (err) {
      btn.disabled = false; // api() has already surfaced the reason
    }
  });
  bind('#rfpDelete', async () => {
    if (!confirm('Remove the saved background? The analyzer stops working until you add one again.')) return;
    await api('DELETE', '/api/profile');
    await refreshProfile();
    rf.editingProfile = false;
    toast('Background removed');
    renderRoleFit(main);
  });

  const paintCount = () => {
    const n = input.value.trim().length;
    const over = n > RF_MAX_CHARS;
    $('#rfCount').textContent = `${n.toLocaleString()} / ${RF_MAX_CHARS.toLocaleString()} characters`;
    $('#rfCount').style.color = over ? '#fb923c' : '';
  };

  const paintSave = () => {
    if (rf.status !== 'done' || !targets.length) { saveBox.innerHTML = ''; return; }
    saveBox.innerHTML = `
      <div class="rf-save">
        <label class="fld" style="flex:1;min-width:200px">Save this read to
          <select id="rfTarget">
            <option value="">Choose an application or saved job…</option>
            ${targets.map(t => `<option value="${t.kind}:${t.id}">${esc(t.label)}</option>`).join('')}
          </select>
        </label>
        <button class="btn sm" id="rfSaveBtn">Save</button>
      </div>`;
    $('#rfSaveBtn').onclick = async () => {
      const v = $('#rfTarget').value;
      if (!v) return toast('Pick where to save it first');
      const [kind, id] = v.split(':');
      const url = (kind === 'app' ? '/api/applications/' : '/api/saved-jobs/') + id;
      await api('PUT', url, { fit_analysis: rf.output, fit_analysis_date: todayISO() });
      toast('Saved to record');
      await loadAll();
    };
  };

  const paint = () => {
    if (rf.status === 'idle' && !rf.output) {
      result.innerHTML = '<p class="muted">The assessment appears here: an overall fit read, where the role lines up with what you have done, where you would be ramping, and what to raise first.</p>';
    } else if (rf.status === 'loading') {
      result.innerHTML = '<p class="muted">Reading the posting…</p>';
    } else {
      result.innerHTML = rfRenderResult(rfParse(rf.output));
    }
    if (rf.error) {
      result.innerHTML += `<div class="rf-error"><strong>Not this time.</strong> ${esc(rf.error)}</div>`;
    }
    paintSave();
  };

  input.oninput = () => { rf.text = input.value; paintCount(); };
  input.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } };
  $('#rfClear').onclick = () => {
    Object.assign(rf, { text: '', output: '', status: 'idle', error: null });
    input.value = ''; paintCount(); paint();
  };
  $('#rfRun').onclick = () => run();

  async function run() {
    const text = input.value.trim();
    if (!text) return toast('Paste a job description first');
    if (text.length > RF_MAX_CHARS) return toast('That posting is over the character limit');
    if (text.length < RF_MIN_CHARS) return toast('That is too short to read as a job description');

    Object.assign(rf, { text, output: '', status: 'loading', error: null });
    $('#rfRun').disabled = true;
    paint();

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDescription: text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        rf.error = (data && data.error) || 'Something went wrong. Try again.';
        rf.status = 'error';
        paint();
        return;
      }
      rf.status = 'streaming';
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (acc.endsWith(RF_STREAM_ERROR)) {
          rf.output = acc.slice(0, -RF_STREAM_ERROR.length);
          rf.error = 'The response was cut off partway through. What is above is incomplete.';
          rf.status = 'error';
          paint();
          return;
        }
        rf.output = acc;
        paint();
      }
      rf.status = 'done';
      paint();
    } catch (e) {
      rf.error = 'Could not reach the analyzer. Check the connection and try again.';
      rf.status = 'error';
      paint();
    } finally {
      const btn = $('#rfRun');
      if (btn) btn.disabled = !cfg.configured;
    }
  }

  paintCount();
  paint();
}

// ---------------- networking tab ----------------

function renderNetworking(main) {
  const f = S.netFilters;
  let list = S.contacts.filter(c => {
    if (f.status && c.status !== f.status) return false;
    if (f.referred === 'yes' && !c.referred_job) return false;
    if (f.referred === 'no' && c.referred_job) return false;
    if (f.company && !(c.company || '').toLowerCase().includes(f.company.toLowerCase())) return false;
    return true;
  });
  const within = (a, b) => {
    if (S.netSort === 'name') return a.name.localeCompare(b.name);
    if (S.netSort === 'company') return (a.company || '').localeCompare(b.company || '');
    return (b.last_contact_date || '').localeCompare(a.last_contact_date || '');
  };
  // Active contacts always float to the top; chosen sort applies within each group.
  list.sort((a, b) => ((a.status === 'Active' ? 0 : 1) - (b.status === 'Active' ? 0 : 1)) || within(a, b));

  main.innerHTML = `
    <div class="toolbar">
      <label class="fld" style="min-width:130px">Status<select id="nfStatus">${options(NET_STATUSES, f.status, 'All')}</select></label>
      <label class="fld" style="min-width:130px">Referred a job<select id="nfReferred">
        <option value="">All</option>
        <option value="yes" ${f.referred === 'yes' ? 'selected' : ''}>Yes</option>
        <option value="no" ${f.referred === 'no' ? 'selected' : ''}>No</option>
      </select></label>
      <label class="fld" style="min-width:160px">Company<input id="nfCompany" value="${esc(f.company)}" placeholder="Search company…"></label>
      <label class="fld" style="min-width:150px">Sort<select id="nfSort">
        <option value="last_contact" ${S.netSort === 'last_contact' ? 'selected' : ''}>Last Contact (newest)</option>
        <option value="name" ${S.netSort === 'name' ? 'selected' : ''}>Name</option>
        <option value="company" ${S.netSort === 'company' ? 'selected' : ''}>Company</option>
      </select></label>
      <div class="spacer"></div>
      <button class="btn" id="addContactBtn">＋ Add Contact</button>
    </div>
    <div class="muted" style="margin-bottom:10px">${list.length} of ${S.contacts.length} contacts</div>
    ${list.map(c => `
      <div class="net-row" data-id="${c.id}">
        <div class="nr-main">
          <div class="nr-name">${esc(c.name)} ${c.referred_job ? '<span class="tag-chip" title="Referred a job">Referred ⭐</span>' : ''}</div>
          <div class="nr-sub">${esc(c.title || '')}${c.title && c.company ? ' · ' : ''}${esc(c.company || '')}</div>
        </div>
        ${netBadge(c.status)}
        <div class="nr-date">${c.last_contact_date ? fmtDate(c.last_contact_date) : 'never'}</div>
      </div>`).join('') || '<div class="empty-state">No contacts match.</div>'}`;

  $('#nfStatus').onchange = (e) => { S.netFilters.status = e.target.value; renderNetworking(main); };
  $('#nfReferred').onchange = (e) => { S.netFilters.referred = e.target.value; renderNetworking(main); };
  $('#nfCompany').oninput = (e) => { S.netFilters.company = e.target.value; renderNetworking(main); $('#nfCompany').focus(); const v = $('#nfCompany'); v.setSelectionRange(v.value.length, v.value.length); };
  $('#nfSort').onchange = (e) => { S.netSort = e.target.value; renderNetworking(main); };
  $('#addContactBtn').onclick = () => openContactModal(null);
  $$('.net-row', main).forEach(row => row.onclick = () => {
    openContactModal(S.contacts.find(c => c.id === Number(row.dataset.id)));
  });
}

// ---------------- interviews tab ----------------

function renderInterviews(main) {
  // Group by company (normalized), taking the label from the parent application
  // when there is one so renames and stale round copies don't split a company.
  const byCompany = new Map();
  for (const r of S.interviews) {
    const app = S.apps.find(a => a.id === r.application_id);
    const label = (app ? app.company : r.company) || r.company || 'Unknown';
    const role = (app ? app.role : r.role) || r.role || '';
    const key = companyKey(label);
    if (!byCompany.has(key)) byCompany.set(key, { labels: [], rounds: [] });
    const g = byCompany.get(key);
    g.labels.push(label);
    g.rounds.push({ ...r, _label: label, _role: role });
  }
  const groups = Array.from(byCompany.values()).map(({ labels, rounds }) => {
    rounds.sort((a, b) => (a.round_number || 0) - (b.round_number || 0) || (a.interview_date || '').localeCompare(b.interview_date || ''));
    const latest = rounds.reduce((m, r) => (r.interview_date || '') > m ? r.interview_date : m, '');
    // Display the most-used spelling, breaking ties toward the more specific one.
    const tally = {};
    labels.forEach(l => { tally[l] = (tally[l] || 0) + 1; });
    const company = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || b.length - a.length)[0];
    const roles = [...new Set(rounds.map(r => r._role).filter(Boolean))];
    return { company, rounds, latest, roles };
  }).sort((a, b) => b.latest.localeCompare(a.latest));

  main.innerHTML = `
    <div class="toolbar">
      <span class="muted">${S.interviews.length} rounds across ${groups.length} companies</span>
      <div class="spacer"></div>
      <button class="btn" id="addIntBtn">＋ Add Interview Round</button>
    </div>
    ${groups.map(g => `
      <div class="int-company">
        <h3>${esc(g.company)} <span class="muted">— ${esc(g.roles.join(' · '))}</span></h3>
        ${g.rounds.map(r => `
          <div class="int-row" data-id="${r.id}">
            <div class="ir-head">
              <span class="rn">R${r.round_number ?? '?'}</span>
              <span class="typ">${esc(r.interview_type || 'Interview')}</span>
              ${g.roles.length > 1 && r._role ? `<span class="badge outline">${esc(r._role)}</span>` : ''}
              <span class="when">${fmtDate(r.interview_date)}${r.interview_time ? ` ${fmtTime(r.interview_time)}` : ''}${r.duration_minutes ? ` · ${r.duration_minutes} min` : ''}</span>
              <span class="when">${esc(r.interviewers || '')}</span>
              <span style="margin-left:auto">${outcomeBadge(r.outcome)}</span>
            </div>
            ${S.expandedInt.has(r.id) ? `
              <div class="ir-detail">${r.interviewer_titles ? `<div class="muted">${esc(r.interviewer_titles)}</div>` : ''}${r.notes ? esc(r.notes) : '<span class="muted">No notes.</span>'}
                <div style="margin-top:8px"><button class="btn ghost sm" data-open-app="${r.application_id}">Open application →</button></div>
              </div>` : ''}
          </div>`).join('')}
      </div>`).join('') || '<div class="empty-state">No interview rounds yet.</div>'}`;

  $('#addIntBtn').onclick = openInterviewModal;
  $$('.int-row', main).forEach(row => row.onclick = (e) => {
    const openApp = e.target.closest('[data-open-app]');
    if (openApp) {
      e.stopPropagation();
      const id = Number(openApp.dataset.openApp);
      if (id) openDetail(id);
      return;
    }
    const id = Number(row.dataset.id);
    S.expandedInt.has(id) ? S.expandedInt.delete(id) : S.expandedInt.add(id);
    renderInterviews(main);
  });
}

// ---------------- global search ----------------

function doSearch(q) {
  const box = $('#searchResults');
  q = q.trim().toLowerCase();
  if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  const has = (...fields) => fields.some(f => (f || '').toLowerCase().includes(q));

  const apps = S.apps.filter(a => has(a.company, a.role, a.notes)).slice(0, 8);
  const nets = S.contacts.filter(c => has(c.name, c.company, c.notes)).slice(0, 8);
  const ints = S.interviews.filter(r => has(r.company, r.interviewers, r.notes)).slice(0, 8);
  const savedHits = S.saved.filter(j => has(j.company, j.role, j.notes)).slice(0, 8);

  if (!apps.length && !nets.length && !ints.length && !savedHits.length) {
    box.innerHTML = '<div class="search-empty">No results</div>';
    box.hidden = false;
    return;
  }
  box.innerHTML = `
    ${apps.length ? `<div class="search-group-label">Applications</div>${apps.map(a => `
      <div class="search-item" data-type="app" data-id="${a.id}">
        <div class="si-main">${hiText(a.company, q)} ${statusBadge(a.status)}</div>
        <div class="si-sub">${hiText(a.role, q)}</div>
      </div>`).join('')}` : ''}
    ${nets.length ? `<div class="search-group-label">Networking</div>${nets.map(c => `
      <div class="search-item" data-type="net" data-id="${c.id}">
        <div class="si-main">${hiText(c.name, q)} ${netBadge(c.status)}</div>
        <div class="si-sub">${hiText(c.company || '', q)} ${esc(c.title || '')}</div>
      </div>`).join('')}` : ''}
    ${ints.length ? `<div class="search-group-label">Interviews</div>${ints.map(r => `
      <div class="search-item" data-type="int" data-id="${r.id}">
        <div class="si-main">${hiText(r.company, q)} — R${r.round_number ?? '?'} ${esc(r.interview_type || '')}</div>
        <div class="si-sub">${fmtDate(r.interview_date)} ${hiText(r.interviewers || '', q)}</div>
      </div>`).join('')}` : ''}
    ${savedHits.length ? `<div class="search-group-label">Saved Jobs</div>${savedHits.map(j => `
      <div class="search-item" data-type="saved" data-id="${j.id}">
        <div class="si-main">${hiText(j.company, q)}</div>
        <div class="si-sub">${hiText(j.role, q)}</div>
      </div>`).join('')}` : ''}`;
  box.hidden = false;

  $$('.search-item', box).forEach(item => item.onclick = async () => {
    const { type, id } = item.dataset;
    hideSearch();
    if (type === 'app') {
      if (S.route !== 'applications') { setRoute('applications'); await new Promise(r => setTimeout(r, 100)); }
      openDetail(Number(id));
    } else if (type === 'net') {
      if (S.route !== 'networking') setRoute('networking');
      openContactModal(S.contacts.find(c => c.id === Number(id)));
    } else if (type === 'saved') {
      if (S.route !== 'saved') setRoute('saved');
      openSavedModal(S.saved.find(j => j.id === Number(id)));
    } else {
      S.expandedInt.add(Number(id));
      setRoute('interviews');
      if (S.route === 'interviews') renderInterviews($('#main'));
    }
  });
}
function hideSearch() {
  $('#searchResults').hidden = true;
  $('#globalSearch').value = '';
}

// Escape-then-highlight: wraps case-insensitive matches of q in <mark>.
function hiText(text, q) {
  text = String(text ?? '');
  if (!q) return esc(text);
  const lower = text.toLowerCase();
  let out = '', i = 0;
  for (;;) {
    const idx = lower.indexOf(q, i);
    if (idx < 0) { out += esc(text.slice(i)); break; }
    out += esc(text.slice(i, idx)) + '<mark>' + esc(text.slice(idx, idx + q.length)) + '</mark>';
    i = idx + q.length;
  }
  return out;
}

// ---------------- export / import ----------------

function exportCSV(list) {
  const cols = [
    ['Company', a => a.company], ['Role', a => a.role], ['Applied Date', a => a.applied_date],
    ['Priority', a => a.priority], ['Location', a => a.location_type], ['Salary Range', a => a.salary_range],
    ['Source', a => a.source], ['Interview Landed', a => a.interview_landed ? 'Yes' : 'No'],
    ['Status', a => a.status], ['Recruiter Contact', a => a.recruiter_contact],
    ['Follow-up Date', a => a.followup_date], ['Tags', a => (a.tags || []).join('; ')],
    ['Notes', a => a.notes], ['Job Link', a => a.job_link],
  ];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.map(c => cell(c[0])).join(',')]
    .concat(list.map(a => cols.map(c => cell(c[1](a))).join(',')))
    .join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `applications-${todayISO()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast(`Exported ${list.length} application${list.length === 1 ? '' : 's'} to CSV`);
}

async function doExport() {
  const data = await api('GET', '/api/export');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `job-tracker-export-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Export downloaded');
}
function doImport(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!confirm('Importing REPLACES all current data. Continue?')) return;
      const result = await api('POST', '/api/import', data);
      toast(`Imported ${result.counts.applications} applications`);
      await loadAll(); if (S.route === 'dashboard') await loadDash();
      render();
    } catch (e) {
      toast('Import failed: ' + e.message);
    }
  };
  reader.readAsText(file);
}

// ---------------- global wiring ----------------

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (e.key === '/' && !typing) {
    e.preventDefault();
    $('#globalSearch').focus();
  } else if ((e.key === 'n' || e.key === 'N') && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if ($('#modalRoot .modal-overlay')) return;
    e.preventDefault();
    openAppModal();
  } else if (e.key === 'Escape') {
    if ($('#modalRoot .modal-overlay')) closeModal();
    else if (S.detailId) closeDetail();
    else hideSearch();
  }
});

$('#globalSearch').addEventListener('input', (e) => doSearch(e.target.value));
$('#globalSearch').addEventListener('focus', (e) => { if (e.target.value) doSearch(e.target.value); });
$('#globalSearch').addEventListener('keydown', (e) => {
  const box = $('#searchResults');
  if (box.hidden) return;
  const items = $$('.search-item', box);
  if (!items.length) return;
  let idx = items.findIndex(it => it.classList.contains('sel'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    idx = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items.forEach((it, i) => it.classList.toggle('sel', i === idx));
    items[idx].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    items[idx >= 0 ? idx : 0].click();
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) $('#searchResults').hidden = true;
});

$('#drawerOverlay').addEventListener('click', closeDetail);
$('#fab').addEventListener('click', openAppModal);
$('#exportBtn').addEventListener('click', doExport);
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', (e) => {
  if (e.target.files[0]) doImport(e.target.files[0]);
  e.target.value = '';
});

// Keep the sticky table-header offset in sync with the real topbar height
// (it wraps to two rows on narrow screens).
function syncTopbarHeight() {
  document.documentElement.style.setProperty('--topbar-h', $('#topbar').offsetHeight + 'px');
}
syncTopbarHeight();

window.addEventListener('resize', () => {
  $('#fab').hidden = !(S.route === 'applications' && window.innerWidth < 768);
  syncTopbarHeight();
});

// boot
setRoute(routeFromHash());
})();
