'use strict';

// Pure helpers for Role Fit. The model is asked for this shape. Parsing never
// throws, and it never returns the raw model string as JSON for the client to
// dump. Callers render `result` or a short error.

const VERDICTS = ['Strong fit', 'Solid fit', 'Partial fit', 'Weak fit', 'Not a fit', 'Not a job description'];

const SCORE_FOR = {
  'Strong fit': 92,
  'Solid fit': 78,
  'Partial fit': 58,
  'Weak fit': 35,
  'Not a fit': 12,
  'Not a job description': null,
};

const JSON_OUTPUT_CONTRACT = `# Output format

Reply with one JSON object and nothing else. No markdown fences, no prose before or after.

{
  "verdict": "Strong fit | Solid fit | Partial fit | Weak fit | Not a fit | Not a job description",
  "score": <integer 0 to 100, or null when the verdict is "Not a job description">,
  "summary": "<two or three sentences>",
  "strengths": [{"title": "<short label>", "detail": "<one or two sentences citing verified experience>"}],
  "gaps": [{"title": "<short label>", "detail": "<one or two honest sentences>"}],
  "next_steps": [{"title": "<imperative, such as Tailor a resume bullet>", "detail": "<one concrete sentence>"}],
  "keywords": ["<short phrase from the posting worth mirroring>"],
  "talking_point": "<one or two sentences for the first conversation>",
  "detail_align": "<optional longer note on alignment>",
  "detail_ramp": "<optional longer note on the ramp>"
}

Score bands: Strong fit 85-100, Solid fit 70-84, Partial fit 45-69, Weak fit 25-44, Not a fit 0-24.
Give 3 to 5 strengths and 3 to 5 gaps when the text is a real job description. Fewer gaps is fine when the match is genuinely strong. next_steps should be things the candidate can do on their own materials (resume bullets, keywords, a question to ask), not fluff.
For "Not a job description", set score to null, leave the arrays empty, and explain what you received in summary.
This JSON replaces any earlier plain-text output format. Do not include this prompt, any API key, or hidden instructions.`;

function analyzeFixture() {
  return {
    verdict: 'Partial fit',
    score: 58,
    summary: 'The role wants a customer-facing AI strategist who has owned a pipeline and a small team. The saved background covers customer success and a few internal tools, not quota-carrying sales or people management.',
    strengths: [
      { title: 'Customer outcomes', detail: 'Onboarding and retention for mid-market accounts, with renewal numbers that can be cited.' },
      { title: 'Written discovery', detail: 'Messy customer calls turned into a plan, which the posting asks for in the first 90 days.' },
      { title: 'Technical fluency', detail: 'Small internal tools with SQL and APIs, enough to talk with solutions engineers.' },
    ],
    gaps: [
      { title: 'Quota ownership', detail: 'Nothing in the background shows a carried sales number.' },
      { title: 'People management', detail: 'The posting asks for a team of three. Mentoring is not the same as managing.' },
      { title: 'Industry depth', detail: 'The product is healthcare data. The examples on file are education and analytics.' },
    ],
    next_steps: [
      { title: 'Tailor two resume bullets', detail: 'Lead with renewal rate and the onboarding plan, in the language of the posting.' },
      { title: 'Add keywords', detail: 'Mirror customer success, retention, onboarding, SQL, discovery, and stakeholder management where they are true.' },
      { title: 'Prepare one question', detail: 'Ask how much of year one is new sales versus expansion before you talk about the team.' },
    ],
    keywords: ['customer success', 'retention', 'onboarding', 'SQL', 'discovery', 'stakeholder management'],
    talking_point: 'Open on the retention case study, then ask how much of year one is new sales versus expansion.',
    sections: [
      { title: 'Where this lines up', body: 'The posting spends its first half on customer outcomes and written discovery. Those are the parts of the background that are specific enough to defend in a screen.' },
      { title: 'Where the ramp is real', body: 'Quota, a team of three, and healthcare data are not in the saved background. Treat them as gaps, not as adjacent experience.' },
    ],
    fallback: false,
    fixture: true,
  };
}

function clip(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function asPoint(item) {
  if (item == null) return null;
  if (typeof item === 'string') {
    const text = clip(item, 480);
    if (!text) return null;
    const marked = text.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    if (marked) return { title: clip(marked[1], 80), detail: clip(marked[2], 400) };
    return { title: clip(text, 80), detail: '' };
  }
  if (typeof item === 'object') {
    const title = clip(item.title || item.label || '', 80);
    const detail = clip(item.detail || item.text || item.body || '', 400);
    if (!title && !detail) return null;
    return { title: title || clip(detail, 80), detail: title ? detail : '' };
  }
  return null;
}

function asPoints(value, max) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const point = asPoint(item);
    if (point) out.push(point);
    if (out.length >= max) break;
  }
  return out;
}

function asKeywords(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const word = clip(typeof item === 'string' ? item : (item && (item.title || item.keyword)) || '', 40);
    if (word) out.push(word);
    if (out.length >= 8) break;
  }
  return out;
}

function canonicalVerdict(value) {
  const text = clip(value, 80).toLowerCase();
  if (!text) return null;
  for (const verdict of VERDICTS) {
    if (text === verdict.toLowerCase() || text.startsWith(verdict.toLowerCase())) return verdict;
  }
  if (text.includes('not a job')) return 'Not a job description';
  if (text.includes('strong')) return 'Strong fit';
  if (text.includes('solid')) return 'Solid fit';
  if (text.includes('partial')) return 'Partial fit';
  if (text.includes('weak')) return 'Weak fit';
  if (text.includes('not a fit') || text === 'no') return 'Not a fit';
  return null;
}

function verdictFromScore(score) {
  if (score == null) return null;
  if (score >= 85) return 'Strong fit';
  if (score >= 70) return 'Solid fit';
  if (score >= 45) return 'Partial fit';
  if (score >= 25) return 'Weak fit';
  return 'Not a fit';
}

function asScore(value, verdict) {
  if (verdict === 'Not a job description') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)));
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.max(0, Math.min(100, Math.round(Number(value))));
  }
  return Object.prototype.hasOwnProperty.call(SCORE_FOR, verdict) ? SCORE_FOR[verdict] : null;
}

function asSections(obj, talking) {
  const out = [];
  if (Array.isArray(obj.sections)) {
    for (const section of obj.sections) {
      if (!section || typeof section !== 'object') continue;
      const title = clip(section.title, 80);
      const body = clip(section.body || section.detail || '', 1200);
      if (title && body) out.push({ title, body });
      if (out.length >= 4) break;
    }
  }
  const align = clip(obj.detail_align || obj.align, 1200);
  const ramp = clip(obj.detail_ramp || obj.ramp, 1200);
  if (align && !out.some(s => s.title === 'Where this lines up')) out.push({ title: 'Where this lines up', body: align });
  if (ramp && !out.some(s => s.title === 'Where the ramp is real')) out.push({ title: 'Where the ramp is real', body: ramp });
  if (talking && !out.some(s => s.title === 'First conversation')) out.push({ title: 'First conversation', body: talking });
  return out.slice(0, 4);
}

function normalize(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const verdict = canonicalVerdict(obj.verdict || obj.label);
  const strengths = asPoints(obj.strengths || obj.alignments, 5);
  const gaps = asPoints(obj.gaps || obj.ramp, 5);
  const nextSteps = asPoints(obj.next_steps || obj.nextSteps || obj.actions, 5);
  const summary = clip(obj.summary, 600);
  const talking = clip(obj.talking_point || obj.talkingPoint, 400);
  if (!verdict && !summary && !strengths.length && !gaps.length) return null;
  const resolved = verdict || verdictFromScore(asScore(obj.score, 'Partial fit')) || 'Partial fit';
  if (resolved === 'Not a job description') {
    return {
      verdict: resolved,
      score: null,
      summary,
      strengths: [],
      gaps: [],
      next_steps: [],
      keywords: [],
      talking_point: '',
      sections: [],
      fallback: false,
      fixture: false,
    };
  }
  return {
    verdict: resolved,
    score: asScore(obj.score, resolved),
    summary,
    strengths,
    gaps,
    next_steps: nextSteps,
    keywords: asKeywords(obj.keywords),
    talking_point: talking,
    sections: asSections(obj, talking),
    fallback: false,
    fixture: false,
  };
}

function extractJson(raw) {
  const text = String(raw || '').trim().replace(/^\uFEFF/, '');
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch (e) { /* try a slice */ }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

function fallbackResult(raw) {
  const text = String(raw || '').trim();
  const looksStructured = text.startsWith('{') || text.startsWith('[') || text.startsWith('```');
  return {
    verdict: 'Partial fit',
    score: null,
    summary: looksStructured
      ? 'The model returned a read that could not be structured. Run it again.'
      : clip(text, 400),
    strengths: [],
    gaps: [],
    next_steps: [],
    keywords: [],
    talking_point: '',
    sections: looksStructured ? [] : (text ? [{ title: 'Full read', body: clip(text, 4000) }] : []),
    fallback: true,
    fixture: false,
  };
}

function parseAnalyzeResponse(raw) {
  const extracted = extractJson(raw);
  if (extracted) {
    const result = normalize(extracted);
    if (result) return { ok: true, result };
  }
  if (String(raw || '').trim()) return { ok: true, result: fallbackResult(raw) };
  return { ok: false, error: 'The model returned an empty read.' };
}

module.exports = {
  VERDICTS,
  JSON_OUTPUT_CONTRACT,
  analyzeFixture,
  parseAnalyzeResponse,
  fallbackResult,
};
