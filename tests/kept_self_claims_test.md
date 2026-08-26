---
mode: testing
url: http://localhost:3000/
tags: [kept, self-cited, unbound]
---

# Three claims KEPT's own README makes that no browser flow can settle

<!-- @verifies README.md:22 the zero Kane invocations claim -->
<!-- @verifies README.md:89 the no network and no credentials claim -->
<!-- @verifies README.md:301 the read-only deployment claim -->

**Read this before reading the steps.** This document exists so that three claims KEPT makes
about itself enter the promise graph. It is not a proof of any of them, and it must not be read
as one.

## Why the three are here at all

R19.5 forbids admitting only the claims that already pass. A `designedCoverage` of `1.0` or a
`provenCoverage` of `0.875` reached by leaving out the inconvenient lines is exactly the failure
mode of an untested README, reproduced one layer up inside the tool built to detect it. So all
five candidate lines of design §23.1 are admitted, including these three, and the coverage
figure falls to whatever the truth is.

## Why no Kane run can settle them

Each of the three is a claim about a *process or a source tree*, not about a rendered screen:

- `README.md:22` says the demo path invokes Kane zero times and spends zero credits. The
  evidence is the absence of a spawn, which a browser cannot observe.
- `README.md:89` says the suite passes with no network, no credentials and no Kane. The evidence
  is a run of the suite under those conditions, which is a process fact.
- `README.md:301` says the deployed artefact carries no non-GET handler, no server action, no
  auth and no `child_process` import. The evidence is a scan of `apps/ledger/`, which is a
  source fact.

This repository's own Vitest suite checks all three today, and a reader who wants the evidence
should go there rather than to Kane: `packages/kept-core/test/demo-script.test.ts` for the
demo path, `packages/kept-core/test/judge-path.test.ts` for the no-network measurement, and
`apps/ledger/test/read-only-scan.test.ts` for the deployment scan. None of those is a
`*_test.md`, so none of them is a designed test in the sense the promise graph means, and the
graph does not pretend otherwise.

## What the graph therefore carries

Three promises, cited verbatim to lines 22, 89 and 301 of `README.md`, with no verdict behind
them. They are the same kind of record as the fixture's eight in every field except the
citation path, which is Property 36's whole claim. Their honest state is unproven, the Ledger
publishes the lower figure because of them, and the count of them may not be reduced to raise
that figure. `committed-snapshot.test.ts` asserts the floor so the temptation is mechanically
foreclosed rather than resisted.

No `assurance.id`, so no `test_id`, so `kept verify --all` excludes this document and spends
nothing on it. No `@covers` globs, so no save pulls it into a blast radius.

## Step 1: read the Ledger rather than this document

Navigate to http://localhost:3000/coverage and assert that the page shows the heading
"Coverage".
