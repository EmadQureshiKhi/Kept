---
mode: testing
url: http://localhost:3000/badge.svg
tags: [kept, badge, self-cited]
---

# The badge endpoint answers a GET with an SVG carrying a whole-number percentage

<!-- @verifies README.md:679 the badge endpoint claim -->

**Cited to KEPT's own README** (design §23.1, R19.1). Line 679 is the row of the Ledger's
route table that states what `/badge.svg` returns: GET only, `image/svg+xml`, and proven
coverage as a whole-number percentage. That is a claim about observable behaviour rather than
prose, which is why it is one of the five lines admitted rather than one of the hundreds that
describe the design.

**Zero credits, and unproven for the same reason.** No recording exists under
`tests/output-*/` for this document, so `testrun_plan` mints no `test_id` for it, so
`kept verify --all` excludes it and spends nothing. The promise is in the graph without a
verdict behind it, which is the state the Ledger is supposed to show rather than hide.

`n/a` is a legitimate rendering of the same route: the value plate reads `n/a` on the neutral
fill whenever `provenCoverage` is withheld, with no division performed. So the assertion below
is on the percent sign and the label rather than on a specific figure, because pinning a figure
here would make the document fail the day the coverage figure moves, which is the one thing a
coverage figure is supposed to do.

No `@covers` globs: the route lives under `apps/ledger/`, which no repair branch may write and
no blast radius may reach.

## Step 1: request the badge

Navigate to http://localhost:3000/badge.svg and wait until the image has rendered.

## Step 2: assert the badge carries its label and a percentage

Assert that the rendered image shows the text "promises kept" and that the value beside it
ends with the character "%".
