# Changelog

## 1.0.0

Initial release.

- Parses two column redirect CSV files with source/target, from/to, or old/new headers.
- Detects redirect chains and collapses every chain to its final destination.
- Detects loops, duplicate sources, conflicting duplicates, self-redirects, and collisions after normalisation.
- Warns when the share of targets pointing at the homepage passes a configurable threshold, 30 percent by default.
- Writes fixed-redirects.csv and report.md. Fully offline, zero dependencies.
