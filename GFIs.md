# Good First Issues

These are seeded starter issues for new contributors. Each one is self contained and needs no extra services.

## 1. WooCommerce and .htaccess style export format

WooCommerce exports and hand written server rules often use full URLs, RewriteRule lines, or a status code column instead of a plain two column CSV. Add an input adapter that reads one of those shapes and converts it into the internal source and target row format, with tests built from synthetic examples. Keep the existing CSV path unchanged so current users see no behaviour change.

## 2. Optional live-check mode with HEAD requests, clearly separated from offline mode

The default mode is fully offline and must stay that way. Add an opt in flag that, only when passed, sends HEAD requests for each final target and records the returned status in a separate column of the report. The flag, its network behaviour, and its slower runtime should be called out in the help text and the README so nobody triggers network calls by accident.

## 3. Market subfolder (/en-ca/ style) duplicate detection

Stores that migrate market subfolders such as /en-ca/ or /fr/ often ship the same redirect twice, once with the subfolder prefix and once without. Add a check that groups sources which differ only by a leading market subfolder segment and reports them as a separate finding type. Include fixtures with at least two different subfolders and one control row that must not be grouped.
