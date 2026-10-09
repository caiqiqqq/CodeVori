# Context panel Token units

## Product rule and boundary

Match Codeg's chat composer `src/lib/token-format.ts` decimal Token notation:
values below 1,000 are whole counts; values from 1,000 use K (divide by 1,000);
values from 1,000,000 use M (divide by 1,000,000). Round to one decimal and remove
a trailing `.0`. These technical units do not switch to 万/亿 with Chinese locale.
Both context used/max values and the ACP input/output/cache/total statistics use
the same formatter. For example 181,000 / 260,000 becomes 181K / 260K,
70,997,350 becomes 71M and 326,330 becomes 326.3K.

This changes only the shared UI context panel. Other localized compact numbers,
settings usage charts and model badges keep their existing rules. Exact counts
remain available in the capacity trigger's accessible label and each statistic's
title. Unknown dimensions still display —; confirmed zero displays 0. Percentages
retain their localized formatting and derive from raw counts, never rounded text.

## Owner and delivery

```text
Host raw snapshot (desktop live / mobile replay)
  → existing context / ACP usage projection
  → shared UI Token formatter → capacity and cumulative-stat labels
```

The Host remains the count owner. The formatter is pure presentation; no protocol,
provider attribution, token summation, persistence or cache-rate changes are made.

## Acceptance

- Unit tests cover Codeg thresholds, one-decimal rounding, trimming `.0`, zero,
  screenshot values, both locales and unchanged localized compact formatting.
- Shared composer E2E covers K/M capacity and statistics, precise count titles,
  missing vs zero cache dimensions, unchanged percentages, desktop/mobile and themes.
- Execute typecheck, lint, architecture and changed-file formatting checks.
