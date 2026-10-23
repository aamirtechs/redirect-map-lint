# redirect-map-lint
Live page: https://aamirtechs.github.io/redirect-map-lint/
Use it in your browser: the Pages site above runs the full tool locally, no install needed.

Validate a store migration redirect CSV before import: chains, loops, duplicate sources, self-redirects and homepage dumping, with chains collapsed to final destinations automatically. Outputs a fixed CSV and a report.

## Why

A redirect map that imports cleanly can still be wrong. Chains slow every click and can be dropped by platforms, loops break pages outright, and sending a third of a catalog to the homepage throws away the ranking value the redirects were meant to keep. This tool audits the file before import, fixes what can be fixed safely, and lists everything it excluded with a reason.

## Install

Requires Node.js 20 or later. There are no dependencies.

```bash
git clone https://github.com/aamirtechs/redirect-map-lint.git
cd redirect-map-lint
node src/cli.js --help
```

You can also link the CLI globally from the cloned folder:

```bash
npm link
redirect-map-lint redirects.csv --out-dir output
```

## Usage

```bash
node src/cli.js <input.csv> [--out-dir DIR] [--homepage-threshold 0.3]
```

- Input is a two column CSV. Accepted headers are `source,target`, `from,to`, and `old,new`. A file with no header is read as source in column 1 and target in column 2.
- Output is `fixed-redirects.csv` and `report.md` in the output directory.
- `--homepage-threshold` is a share between 0 and 1. The default is 0.3, meaning a warning fires when more than 30 percent of targets point at `/`.
- Fully offline. No network calls are made.

### What it detects

- Redirect chains, collapsed so every source points at the final destination.
- Loops, including two node loops and longer cycles. Loop rows are excluded from the fixed CSV.
- Duplicate sources, split into exact duplicates and conflicting duplicates (same source, different targets). Conflicting rows are excluded.
- Self-redirects, where the source and target are the same path.
- Collisions after normalisation, where case, a trailing slash, or percent encoding makes different looking sources resolve to the same path.
- Homepage dumping, measured as the share of targets that point at `/`.

## Example

Real input, from `examples/redirects.csv`:

```csv
source,target
/old-shoes,/shoes
/shoes,/collections/footwear
/legacy-hat,/hats
/hats,/collections/hats
/loop-a,/loop-b
/loop-b,/loop-a
/self-page,/self-page
/dup-page,/first-target
/dup-page,/second-target
/Sale-Items/,/sale
/sale-items,/sale
/home-old,/
/promo-old,/
/blog-old,/
/about-old,/about
/landing-old,/
/offer-old,/
/deal-old,/
```

Real run:

```bash
node src/cli.js examples/redirects.csv --out-dir output
```

Real output:

```text
Input rows: 18
Fixed rows: 12
Excluded rows: 4
Chains collapsed: 2
Loops found: 1
WARNING: homepage target share is above the configured threshold.
Wrote fixed-redirects.csv and report.md to output
```

The generated `fixed-redirects.csv`:

```csv
source,target
/about-old,/about
/blog-old,/
/deal-old,/
/hats,/collections/hats
/home-old,/
/landing-old,/
/legacy-hat,/collections/hats
/offer-old,/
/old-shoes,/collections/footwear
/promo-old,/
/Sale-Items/,/sale
/shoes,/collections/footwear
```

The generated `report.md`:

```markdown
# Redirect Map Report

## Summary

- Input rows: 18
- Fixed rows written: 12
- Excluded rows: 4
- Chains collapsed: 2
- Loops found: 1
- Duplicate source groups: 2
- Conflicting duplicate groups: 1
- Self-redirects: 1
- Normalisation collisions: 1
- Targets pointing at /: 6 (33.3%)
- WARNING: homepage target share 33.3% is above the threshold of 30.0%. This pattern is called homepage dumping and usually loses ranking value.

## Chains collapsed

| Source | Original target | Final target | Steps |
| --- | --- | --- | --- |
| /legacy-hat | /hats | /collections/hats | 2 |
| /old-shoes | /shoes | /collections/footwear | 2 |

## Loops

- /loop-a -> /loop-b -> /loop-a

## Conflicting duplicates

- /dup-page points at: /first-target, /second-target

## Duplicate sources

- /dup-page appears 2 times
- /Sale-Items/ appears 2 times

## Normalisation collisions

- These sources normalise to the same path: /Sale-Items/, /sale-items

## Self-redirects

- /self-page -> /self-page

## Excluded rows

| Source | Target | Reason |
| --- | --- | --- |
| /dup-page | /first-target | conflicting duplicate source |
| /loop-a | /loop-b | part of a redirect loop |
| /loop-b | /loop-a | part of a redirect loop |
| /self-page | /self-page | self-redirect |
```

## Library use

```js
const { parseRedirectCsv, analyzeRedirects, fixedCsv, renderReport } = require('./src');

const rows = parseRedirectCsv('source,target\n/a,/b\n/b,/c\n');
const result = analyzeRedirects(rows, { homepageThreshold: 0.3 });
console.log(fixedCsv(result));
console.log(renderReport(result));
```

## Tests

```bash
npm test
```

Tests use the built in Node.js test runner and cover normalisation, all three header shapes, chain collapsing, loops, conflicts, collisions, self-redirects, the homepage threshold, and the CLI end to end.

## Contributing

See GFIs.md for seeded good first issues.

## License

MIT. Copyright (c) 2026 Amir Hussain. See LICENSE.
