'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  normalizePath,
  parseRedirectCsv,
  analyzeRedirects,
  fixedCsv,
} = require('../src/lint');

test('normalizePath folds case, trailing slash and percent encoding', () => {
  assert.equal(normalizePath('/Sale-Items/'), '/sale-items');
  assert.equal(normalizePath('/sale%2Ditems'), '/sale-items');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('https://example.com/Old//Page/'), '/old/page');
});

test('parseRedirectCsv accepts source/target, from/to and old/new headers', () => {
  assert.equal(parseRedirectCsv('source,target\n/a,/b\n').length, 1);
  assert.equal(parseRedirectCsv('from,to\n/a,/b\n')[0].source, '/a');
  assert.equal(parseRedirectCsv('old,new\n/a,/b\n')[0].target, '/b');
  assert.equal(parseRedirectCsv('/a,/b\n')[0].source, '/a');
});

test('chains collapse to the final destination', () => {
  const rows = parseRedirectCsv('source,target\n/a,/b\n/b,/c\n/c,/d\n');
  const r = analyzeRedirects(rows);
  assert.equal(r.chains.length, 2);
  assert.deepEqual(r.fixed, [
    { source: '/a', target: '/d' },
    { source: '/b', target: '/d' },
    { source: '/c', target: '/d' },
  ]);
});

test('two node and longer loops are detected and excluded', () => {
  const rows = parseRedirectCsv('source,target\n/a,/b\n/b,/a\n/x,/y\n/y,/z\n/z,/x\n/ok,/fine\n');
  const r = analyzeRedirects(rows);
  assert.equal(r.loops.length, 2);
  assert.deepEqual(r.fixed, [{ source: '/ok', target: '/fine' }]);
  assert.equal(r.excluded.length, 5);
});

test('conflicting duplicates are excluded, exact duplicates are kept once', () => {
  const rows = parseRedirectCsv(
    'source,target\n/dup,/one\n/dup,/two\n/same,/x\n/same,/x\n'
  );
  const r = analyzeRedirects(rows);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.duplicates.length, 2);
  assert.deepEqual(r.fixed, [{ source: '/same', target: '/x' }]);
});

test('self redirects are detected and excluded', () => {
  const rows = parseRedirectCsv('source,target\n/me,/me\n/you,/them\n');
  const r = analyzeRedirects(rows);
  assert.equal(r.selfRedirects.length, 1);
  assert.deepEqual(r.fixed, [{ source: '/you', target: '/them' }]);
});

test('normalisation collisions are reported', () => {
  const rows = parseRedirectCsv('source,target\n/Sale/,/clearance\n/sale,/clearance\n');
  const r = analyzeRedirects(rows);
  assert.equal(r.collisions.length, 1);
  assert.equal(r.fixed.length, 1);
});

test('homepage dumping warning respects the threshold', () => {
  const csv = 'source,target\n/a,/\n/b,/\n/c,/x\n';
  const warn = analyzeRedirects(parseRedirectCsv(csv));
  assert.equal(warn.homepageWarning, true);
  const calm = analyzeRedirects(parseRedirectCsv(csv), { homepageThreshold: 0.9 });
  assert.equal(calm.homepageWarning, false);
});

test('fixedCsv emits a header and one row per fixed redirect', () => {
  const r = analyzeRedirects(parseRedirectCsv('source,target\n/a,/b\n'));
  assert.equal(fixedCsv(r), 'source,target\n/a,/b\n');
});

test('CLI writes fixed-redirects.csv and report.md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rml-'));
  const input = path.join(dir, 'in.csv');
  const out = path.join(dir, 'out');
  fs.writeFileSync(input, 'source,target\n/a,/b\n/b,/c\n');
  const stdout = execFileSync(
    process.execPath,
    [path.join(__dirname, '..', 'src', 'cli.js'), input, '--out-dir', out],
    { encoding: 'utf8' }
  );
  assert.match(stdout, /Chains collapsed: 1/);
  assert.equal(fs.readFileSync(path.join(out, 'fixed-redirects.csv'), 'utf8'), 'source,target\n/a,/c\n/b,/c\n');
  assert.match(fs.readFileSync(path.join(out, 'report.md'), 'utf8'), /Redirect Map Report/);
});
