'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAnalyzeResponse, analyzeFixture, VERDICTS } = require('../analyze-format');

test('fixture is a complete structured read', () => {
  const result = analyzeFixture();
  assert.ok(VERDICTS.includes(result.verdict));
  assert.equal(result.score, 58);
  assert.ok(result.strengths.length >= 3 && result.strengths.length <= 5);
  assert.ok(result.gaps.length >= 3 && result.gaps.length <= 5);
  assert.ok(result.next_steps.length >= 1);
  assert.ok(result.keywords.includes('SQL'));
  assert.equal(JSON.stringify(result).includes('sk-'), false);
});

test('parses a JSON object and clamps the score', () => {
  const parsed = parseAnalyzeResponse(JSON.stringify({
    verdict: 'Solid fit',
    score: 140,
    summary: 'Close enough to pursue.',
    strengths: [{ title: 'SQL', detail: 'Used it weekly.' }],
    gaps: ['**Quota** No number on file.'],
    keywords: ['sql', ''],
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.result.verdict, 'Solid fit');
  assert.equal(parsed.result.score, 100);
  assert.equal(parsed.result.strengths[0].title, 'SQL');
  assert.equal(parsed.result.gaps[0].title, 'Quota');
  assert.deepEqual(parsed.result.keywords, ['sql']);
  assert.equal(parsed.result.fallback, false);
});

test('reads fenced JSON and prose wrapped around it', () => {
  const raw = 'Here is the read:\n```json\n{"verdict":"Weak fit","summary":"Thin overlap.","strengths":["Writing"],"gaps":["Healthcare","Quota","Management"]}\n```\nThanks.';
  const parsed = parseAnalyzeResponse(raw);
  assert.equal(parsed.result.verdict, 'Weak fit');
  assert.equal(parsed.result.score, 35);
  assert.equal(parsed.result.strengths.length, 1);
  assert.equal(parsed.result.gaps.length, 3);
});

test('derives a verdict from the score when the label is missing', () => {
  const parsed = parseAnalyzeResponse('{"score":90,"summary":"This matches the work."}');
  assert.equal(parsed.result.verdict, 'Strong fit');
  assert.equal(parsed.result.score, 90);
});

test('treats a non-job as an empty structured read', () => {
  const parsed = parseAnalyzeResponse('{"verdict":"Not a job description","score":80,"summary":"This is a recipe.","strengths":["Salt"]}');
  assert.equal(parsed.result.verdict, 'Not a job description');
  assert.equal(parsed.result.score, null);
});

test('falls back without dumping raw JSON', () => {
  const parsed = parseAnalyzeResponse('{"verdict":');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.result.fallback, true);
  assert.match(parsed.result.summary, /could not be structured/);
  assert.equal(parsed.result.sections.length, 0);
  assert.equal(parsed.result.summary.includes('{"verdict":'), false);
});

test('keeps a plain-text model reply as a collapsible read', () => {
  const parsed = parseAnalyzeResponse('VERDICT: Partial fit\nSUMMARY: Adjacent, not the same job.');
  assert.equal(parsed.result.fallback, true);
  assert.match(parsed.result.summary, /Adjacent/);
  assert.equal(parsed.result.sections[0].title, 'Full read');
});

test('rejects an empty body', () => {
  const parsed = parseAnalyzeResponse('   ');
  assert.equal(parsed.ok, false);
});

test('caps lists at five points', () => {
  const strengths = [1, 2, 3, 4, 5, 6, 7].map(n => ({ title: 'S' + n, detail: 'd' }));
  const parsed = parseAnalyzeResponse(JSON.stringify({ verdict: 'Partial fit', summary: 'Ok.', strengths }));
  assert.equal(parsed.result.strengths.length, 5);
});
