#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseRedirectCsv, analyzeRedirects, fixedCsv, renderReport } = require('./lint');

function usage() {
  return [
    'Usage: redirect-map-lint <input.csv> [--out-dir DIR] [--homepage-threshold 0.3]',
    '',
    'Reads a two column redirect CSV (source,target or from,to or old,new),',
    'writes fixed-redirects.csv and report.md into the output directory.',
    'Fully offline. The homepage threshold is a share between 0 and 1.',
  ].join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(usage());
    return args.length === 0 ? 1 : 0;
  }
  let input = null;
  let outDir = '.';
  let homepageThreshold = 0.3;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out-dir') outDir = args[++i];
    else if (args[i] === '--homepage-threshold') homepageThreshold = Number(args[++i]);
    else if (!args[i].startsWith('--')) input = args[i];
    else throw new Error('Unknown option: ' + args[i]);
  }
  if (!input) throw new Error('Missing input CSV path.\n' + usage());
  if (Number.isNaN(homepageThreshold) || homepageThreshold < 0 || homepageThreshold > 1) {
    throw new Error('--homepage-threshold must be a number between 0 and 1');
  }
  const text = fs.readFileSync(input, 'utf8');
  const rows = parseRedirectCsv(text);
  const result = analyzeRedirects(rows, { homepageThreshold });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'fixed-redirects.csv'), fixedCsv(result));
  fs.writeFileSync(path.join(outDir, 'report.md'), renderReport(result));
  console.log('Input rows: ' + result.totalRows);
  console.log('Fixed rows: ' + result.fixed.length);
  console.log('Excluded rows: ' + result.excluded.length);
  console.log('Chains collapsed: ' + result.chains.length);
  console.log('Loops found: ' + result.loops.length);
  if (result.homepageWarning) {
    console.log('WARNING: homepage target share is above the configured threshold.');
  }
  console.log('Wrote fixed-redirects.csv and report.md to ' + outDir);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exitCode = 1;
  }
}

module.exports = { main };
