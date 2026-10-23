'use strict';

const { parseCsv, toCsv } = require('./csv');

const HEADER_PAIRS = [
  ['source', 'target'],
  ['from', 'to'],
  ['old', 'new'],
];

// Normalised comparison key for a path or URL.
// Case, trailing slash, duplicate slashes, and percent encoding are folded away.
function normalizePath(value) {
  let p = String(value == null ? '' : value).trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch (err) {
      // Keep the raw value if it is not a parseable URL.
    }
  }
  try {
    p = decodeURIComponent(p);
  } catch (err) {
    // Leave malformed percent sequences as they are.
  }
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p.toLowerCase();
}

function parseRedirectCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const first = rows[0].map((c) => c.trim().toLowerCase());
  const hasHeader = HEADER_PAIRS.some(([a, b]) => first[0] === a && first[1] === b);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const out = [];
  dataRows.forEach((cells, idx) => {
    const source = (cells[0] || '').trim();
    const target = (cells[1] || '').trim();
    if (!source && !target) return;
    out.push({ source, target, line: idx + (hasHeader ? 2 : 1) });
  });
  return out;
}

// Rotate a cycle so its smallest node comes first, for stable de-duplication.
function canonicalCycle(cycle) {
  let best = 0;
  for (let i = 1; i < cycle.length; i += 1) {
    if (cycle[i] < cycle[best]) best = i;
  }
  return cycle.slice(best).concat(cycle.slice(0, best));
}

function analyzeRedirects(rows, options) {
  const opts = options || {};
  const homepageThreshold =
    typeof opts.homepageThreshold === 'number' ? opts.homepageThreshold : 0.3;

  const entries = rows.map((r) => ({
    source: r.source,
    target: r.target,
    line: r.line || null,
    sourceNorm: normalizePath(r.source),
    targetNorm: normalizePath(r.target),
  }));

  // Group by normalised source.
  const bySource = new Map();
  for (const e of entries) {
    if (!bySource.has(e.sourceNorm)) bySource.set(e.sourceNorm, []);
    bySource.get(e.sourceNorm).push(e);
  }

  const duplicates = [];
  const conflicts = [];
  const collisions = [];
  for (const [norm, group] of [...bySource.entries()].sort()) {
    if (group.length < 2) continue;
    const targetSet = new Set(group.map((g) => g.targetNorm));
    const item = {
      sourceNorm: norm,
      sources: group.map((g) => g.source),
      targets: group.map((g) => g.target),
      count: group.length,
    };
    duplicates.push(item);
    if (targetSet.size > 1) conflicts.push(item);
    const rawSet = new Set(group.map((g) => g.source));
    if (rawSet.size > 1) collisions.push(item);
  }

  const conflictSources = new Set(conflicts.map((c) => c.sourceNorm));
  const selfRedirects = entries.filter((e) => e.sourceNorm === e.targetNorm);

  // Unambiguous graph: one target per source, conflicts excluded.
  const graph = new Map();
  for (const [norm, group] of bySource.entries()) {
    if (conflictSources.has(norm)) continue;
    graph.set(norm, { targetNorm: group[0].targetNorm, targetRaw: group[0].target });
  }

  // Loop detection by walking each node with a position map.
  const loopKeys = new Set();
  const loops = [];
  const loopNodes = new Set();
  for (const start of graph.keys()) {
    const path = [];
    const position = new Map();
    let cur = start;
    while (graph.has(cur)) {
      if (position.has(cur)) {
        const cycle = canonicalCycle(path.slice(position.get(cur)));
        const key = cycle.join('>');
        if (!loopKeys.has(key)) {
          loopKeys.add(key);
          loops.push(cycle);
          cycle.forEach((n) => loopNodes.add(n));
        }
        break;
      }
      if (loopNodes.has(cur) && path.length > 0) break;
      position.set(cur, path.length);
      path.push(cur);
      cur = graph.get(cur).targetNorm;
      if (cur === path[path.length - 1]) break; // self step, handled below
    }
  }
  // Self redirects are one node loops for exclusion purposes.
  for (const e of selfRedirects) loopNodes.add(e.sourceNorm);

  function resolveFinal(startNorm) {
    const seen = new Set();
    let cur = startNorm;
    let steps = 0;
    while (graph.has(cur)) {
      if (seen.has(cur) || loopNodes.has(cur)) return null;
      seen.add(cur);
      const next = graph.get(cur);
      steps += 1;
      if (!graph.has(next.targetNorm)) {
        return { finalNorm: next.targetNorm, finalRaw: next.targetRaw, steps };
      }
      cur = next.targetNorm;
    }
    return null;
  }

  const chains = [];
  const fixed = [];
  const excluded = [];
  const sortedSources = [...bySource.keys()].sort();
  for (const norm of sortedSources) {
    const group = bySource.get(norm);
    const rawSource = group[0].source;
    if (conflictSources.has(norm)) {
      excluded.push({ source: rawSource, target: group[0].target, reason: 'conflicting duplicate source' });
      continue;
    }
    if (norm === group[0].targetNorm) {
      excluded.push({ source: rawSource, target: group[0].target, reason: 'self-redirect' });
      continue;
    }
    if (loopNodes.has(norm)) {
      excluded.push({ source: rawSource, target: group[0].target, reason: 'part of a redirect loop' });
      continue;
    }
    const resolved = resolveFinal(norm);
    if (!resolved) {
      excluded.push({ source: rawSource, target: group[0].target, reason: 'leads into a redirect loop' });
      continue;
    }
    if (resolved.steps > 1) {
      chains.push({
        source: rawSource,
        originalTarget: group[0].target,
        finalTarget: resolved.finalRaw,
        steps: resolved.steps,
      });
    }
    fixed.push({ source: rawSource, target: resolved.finalRaw });
  }

  const homepageCount = entries.filter((e) => e.targetNorm === '/').length;
  const homepageRatio = entries.length ? homepageCount / entries.length : 0;
  const homepageWarning = homepageRatio > homepageThreshold;

  return {
    totalRows: entries.length,
    entries,
    duplicates,
    conflicts,
    collisions,
    selfRedirects: selfRedirects.map((e) => ({ source: e.source, target: e.target })),
    loops,
    chains,
    fixed,
    excluded,
    homepageCount,
    homepageRatio,
    homepageThreshold,
    homepageWarning,
  };
}

function fixedCsv(result) {
  const rows = [['source', 'target']];
  for (const f of result.fixed) rows.push([f.source, f.target]);
  return toCsv(rows);
}

function pct(n) {
  return (n * 100).toFixed(1) + '%';
}

function renderReport(result) {
  const lines = [];
  lines.push('# Redirect Map Report');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('- Input rows: ' + result.totalRows);
  lines.push('- Fixed rows written: ' + result.fixed.length);
  lines.push('- Excluded rows: ' + result.excluded.length);
  lines.push('- Chains collapsed: ' + result.chains.length);
  lines.push('- Loops found: ' + result.loops.length);
  lines.push('- Duplicate source groups: ' + result.duplicates.length);
  lines.push('- Conflicting duplicate groups: ' + result.conflicts.length);
  lines.push('- Self-redirects: ' + result.selfRedirects.length);
  lines.push('- Normalisation collisions: ' + result.collisions.length);
  lines.push(
    '- Targets pointing at /: ' + result.homepageCount + ' (' + pct(result.homepageRatio) + ')'
  );
  if (result.homepageWarning) {
    lines.push(
      '- WARNING: homepage target share ' + pct(result.homepageRatio) +
        ' is above the threshold of ' + pct(result.homepageThreshold) +
        '. This pattern is called homepage dumping and usually loses ranking value.'
    );
  }
  lines.push('');
  lines.push('## Chains collapsed');
  lines.push('');
  if (result.chains.length === 0) lines.push('None.');
  else {
    lines.push('| Source | Original target | Final target | Steps |');
    lines.push('| --- | --- | --- | --- |');
    for (const c of result.chains) {
      lines.push('| ' + c.source + ' | ' + c.originalTarget + ' | ' + c.finalTarget + ' | ' + c.steps + ' |');
    }
  }
  lines.push('');
  lines.push('## Loops');
  lines.push('');
  if (result.loops.length === 0) lines.push('None.');
  else {
    for (const loop of result.loops) {
      lines.push('- ' + loop.join(' -> ') + ' -> ' + loop[0]);
    }
  }
  lines.push('');
  lines.push('## Conflicting duplicates');
  lines.push('');
  if (result.conflicts.length === 0) lines.push('None.');
  else {
    for (const c of result.conflicts) {
      lines.push('- ' + c.sources[0] + ' points at: ' + [...new Set(c.targets)].join(', '));
    }
  }
  lines.push('');
  lines.push('## Duplicate sources');
  lines.push('');
  if (result.duplicates.length === 0) lines.push('None.');
  else {
    for (const d of result.duplicates) {
      lines.push('- ' + d.sources[0] + ' appears ' + d.count + ' times');
    }
  }
  lines.push('');
  lines.push('## Normalisation collisions');
  lines.push('');
  if (result.collisions.length === 0) lines.push('None.');
  else {
    for (const c of result.collisions) {
      lines.push('- These sources normalise to the same path: ' + [...new Set(c.sources)].join(', '));
    }
  }
  lines.push('');
  lines.push('## Self-redirects');
  lines.push('');
  if (result.selfRedirects.length === 0) lines.push('None.');
  else {
    for (const s of result.selfRedirects) lines.push('- ' + s.source + ' -> ' + s.target);
  }
  lines.push('');
  lines.push('## Excluded rows');
  lines.push('');
  if (result.excluded.length === 0) lines.push('None.');
  else {
    lines.push('| Source | Target | Reason |');
    lines.push('| --- | --- | --- |');
    for (const e of result.excluded) {
      lines.push('| ' + e.source + ' | ' + e.target + ' | ' + e.reason + ' |');
    }
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  normalizePath,
  parseRedirectCsv,
  analyzeRedirects,
  fixedCsv,
  renderReport,
};
