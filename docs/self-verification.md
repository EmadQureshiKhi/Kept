# Self-verification, and the second target that was withdrawn

Two decisions are recorded here, and they are one decision seen from both ends:
KEPT admits **its own root `README.md`** as a promise source, and the second
application it was going to be pointed at is **withdrawn**. R14.8's `MAY` is not
exercised. The reason is cost, not capability.

This file exists so that a reviewer reading the plan finds a decision rather than a
gap (R19.6, R19.7).

## The withdrawal

The plan reserved a second target: point `kept build` at
[RealWorld/Conduit](https://github.com/gothinkster/realworld)'s README, produce a
promise graph and a coverage figure, and stop. Its purpose was to prove the engine is
not specific to the fixture in this repository.

What it would have cost:

| Cost | Why it is unavoidable for that target |
|---|---|
| a backend and a database | Conduit is not a static application, and a promise about a screen is only checkable against a running one |
| a second application to keep running | the loop verifies against a live origin, so the target has to be up whenever the suite runs |
| a second README to keep honest | every claim admitted from it is a claim someone has to maintain, or the graph accumulates rot the ledger then publishes |
| a second corpus authored with live credits | a designed test is a Kane authoring run, and authoring is the one thing in this system that is not a cached replay |

What the alternative cost: **one entry in `subject.docs` and a `@verifies` tag.**

That is the whole comparison. The self-citation buys the same evidence at a fraction
of the price, and it buys something the Conduit target could not: the document making
the claims is the document being checked. A tool that graphs the promises a codebase
makes and exempts its own README from the graph is making an argument rather than a
demonstration.

**Capability was never the question, and it is worth being precise about why.** The
citation grammar is a path and a line. Nothing in the graph knows what a README is,
nothing in the admission gate parses Markdown, and `promiseId` keys on the citation
path plus the normalised claim. `Property 36` states the consequence and checks it:
no promise record field distinguishes a self-cited promise from a fixture-cited one
except the citation path, and no code path consulted while admitting them tests for
either path. `packages/kept-core/test/self-cited-parity.prop.test.ts` admits the same
claim from both documents and requires the two records to be identical field by
field, then scans the six modules a candidate passes through for any mention of
either path in executable code.

## What was admitted, and where each line is

Five lines of the root `README.md`, chosen because each states something
**observable** rather than prose:

| Line | The claim | What checks it today |
|---|---|---|
| 22 | the demo path invokes Kane zero times and spends zero credits | `packages/kept-core/test/demo-script.test.ts` |
| 68 | `npm run demo` serves the Ledger on 3000 and the fixture on 3100 | `packages/kept-core/test/judge-path.test.ts`, and the demo script itself |
| 89 | the suite passes with no network, no credentials and no Kane | every run of `npm run check` on a bare checkout |
| 301 | the deployed artefact carries no non-GET handler and no server action | `apps/ledger/test/read-only-scan.test.ts` |
| 679 | `/badge.svg` answers a GET with SVG carrying a whole-number percentage | `apps/ledger/test/badge.test.ts`, and since the authoring run below, a real Kane flow against the running Ledger |

The right-hand column is why these five and not five others: something already checks
each of them, so admitting them cost no credits at all. **It is not the same thing as
a designed test**, and the graph does not pretend otherwise. A designed test in
KEPT's sense is a `*_test.md` Kane document, and none of those files is one. The three
corpus documents that carry the tags say so in their own prose:

- `tests/kept_demo_boot_test.md` (line 68),
- `tests/kept_badge_endpoint_test.md` (line 679),
- `tests/kept_self_claims_test.md` (lines 22, 89 and 301, the three no browser flow
  can settle).

For a long time none of the three had a recording under `tests/output-*`, so Kane's
plan reported no identifier for any of them, `kept verify --all` left all five claims
out and said so per member, and a judge's `npm run loop` cost what it always cost.
That was the zero-credit half of the arrangement, and the price of it was the honest
half below: all five claims sat in the graph as debt.

**One of the three has since been authored, and line 679 is proven.** That is recorded
in [its own section](#one-of-the-five-was-paid-off-and-it-cost-1460-credits) below,
because it is the only way this figure is allowed to rise and it is worth separating
from the arrangement that produced the debt. The other two documents still have no
recording, so the remaining four claims are still owed and still counted.

## The coverage figure fell, and it only rises by being earned

The middle two columns are the before and after of admitting the five claims. The
rightmost is the committed file as it stands, after one of the five was verified.

| Metric | Before admission | After admission | Committed now |
|---|---|---|---|
| `totalPromises` | 8 | 13 | 13 |
| `provenCount` | 7 | 7 | 8 |
| `redCount` | 1 | 1 | 1 |
| `staleCount` | 0 | 5 | 4 |
| `provenCoverage` | 0.875 | 0.5384615384615384 | 0.6153846153846154 |
| `designedCoverage` | 1 | 1 | 1 |
| `undesignedCount` | 0 | 0 | 0 |

Five claims entered the graph with nothing behind them, so the published proven
figure fell from 88 percent to 54 percent. **That fall was the deliverable, not a
regression.** A ledger that shows what it owes is the product; one tuned to look
complete is the thing this product exists to prevent (§22.1, §23.2).

It reads 62 percent now, and the only thing that moved it was a claim being verified.
Nothing was dropped from the graph to lift it, which is the distinction the whole
arrangement is built to make visible.

The obvious way to make the number look better is to admit only the claims that
already pass. R19.5 forbids it, and
`packages/kept-cli/test/committed-snapshot.test.ts` forecloses it mechanically: it
pins all five cited lines and asserts the self-cited count cannot fall below five.
Adding a sixth self-cited claim is a one-line edit to that list. Removing one is a
test failure with the requirement quoted in the message.

### Two figures a reader should not misread

**`designedCoverage` still reads `1`, and it is not claiming the five are proven.**
It counts promises with a non-null designed-test reference over the total (R9.1), and
all thirteen have one. In this repository it cannot read anything else, and the reason
is the grammar rather than a choice: a promise enters the graph only through a
`@verifies` tag, and the tag that admits a claim is the same annotation that binds the
document carrying it as that claim's designed test (§5.2). So `designedTest` is never
null on this path, and merge rule 4 never fires.

**`undesignedCount` is therefore `0`, and the debt is `staleCount`.** R19.4 says a
self-cited claim with no designed test is carried as `undesigned` and reported as
outstanding debt. The arm is real, specified and tested over generated providers in
Property 36, and a host repository whose provider supplies an unbound claim gets
exactly that behaviour. It is unreachable *here*, because no provider in this
repository can supply one. What the five claims are instead is `stale`. The Ledger
renders each of them with a `stale` tag beside its citation, and the proven figure they
pulled down is on the same page. Nothing is omitted, which is the requirement's actual
subject.

**And `stale` here is stronger than "not run yet", which is the part this file used to
leave vague.** The identifier a run needs is the one Kane writes into the recording it
keeps beside a document, under `tests/output-<slug>/`, and Kane's plan reports that value.
KEPT reads an identifier only from the plan and never from a path or a filename. A
document that has never been through an authoring run has no recording, so the plan
reports no identifier for it, and a member with no identifier cannot enter a blast radius
however the radius is computed: `verify --changed` cannot select it, and neither can
`verify --all`. Such a claim is not waiting on someone remembering to run it. It is
waiting on the authoring run that would mint the identifier in the first place.

All three self-cited documents were in that state when this was first written. The live
plan capture is where a reader can see it rather than take it on trust,
`docs/kane/loop/t9-testrun-plan-test-ids.json`:

```
tests/kept_badge_endpoint_test.md   testId: null
tests/kept_demo_boot_test.md        testId: null
tests/kept_self_claims_test.md      testId: null
```

That was the whole explanation for `staleCount: 5`, and it was a stable state rather
than a queue: authoring one of the three was what would change it, and authoring costs
credits, which is the price named at the top of this file. It was measured by driving the
documentation-triggered cycle live at task 22.2, it is recorded as assumption A20 beside
A19 and in design §7.2.1, and `packages/kept-cli/test/docs-trigger-loop.test.ts` asserts
those three names against the capture rather than only asserting it in prose.

**The badge document has since been authored, so the first line of that capture is now
out of date, and it is kept as it was on purpose.** It is a transcript of what Kane
reported on the day it ran, and editing a transcript to match a later state is exactly
the habit this repository is built to make unnecessary. The current plan is a
regenerable file, `.kept/plan.json`, and it now reports an identifier for
`tests/kept_badge_endpoint_test.md` and still reports none for the other two. That is
the whole explanation for `staleCount: 4`.

## One of the five was paid off, and it cost 14.60 credits

Line 679 says `/badge.svg` answers a GET request with SVG carrying a whole-number
percentage. It is the smallest of the five claims and the only one a browser flow can
settle without any of the others being true first, which is why it went first.

What was done, in order:

1. **Both applications were started together**, the Ledger on port 3000 and Kepler
   Coffee on 3100, by one harness script so the server outlives nothing it needs to.
2. **Kane authored the test document live** against the running Ledger:
   `kane-cli testmd run tests/kept_badge_endpoint_test.md --agent --bug-detection continue`.
   It passed on the first attempt, 2 of 2 steps, and Kane committed the recording:
   `commit: { committed: true, reason: "ok" }`. **Cost: 14.5994 credits.** The full
   capture is under `docs/kane/self/`, stdout, stderr and exit code kept separately.
3. **The recording landed** at `tests/output-kept_badge_endpoint/` carrying
   `test_id: 3a9bc583-ee27-46d1-b15c-540f5c8cf470`, which is the identifier the section
   above says has to exist before any run can select the document.
4. **The plan cache was deleted** so it would be recaptured. This is the step that was
   missed on the first attempt at the same manoeuvre: a document authored after the plan
   was taken is correctly left out of the run that follows, and the fix is to refresh the
   plan rather than to work around the exclusion.
5. **`kept verify --all` replayed the whole recorded suite** in one run,
   `4af9b061-d3cb-448d-9671-7cd2fd54cf31`. The badge member passed, and
   `README.md:679` moved from `stale` to `proven`.

Two details are worth stating because they read like anomalies and are not:

- **The claim asserts a shape, not a number.** The test document checks that the badge
  carries the `%` character and its label, never that the figure is any particular
  value. A test that pinned 62 percent would have to be edited every time coverage
  moved, and would then be asserting the arithmetic of the page it is measuring rather
  than the promise the README makes.
- **Its assurance-graph id is still null.** The snapshot's `designedTest.testId` field
  holds Kane's `T-n` use-case identifier, read off `cover gaps`. Authoring a document
  does not enrol it as a use case, so the field stays null while the recording
  identifier that made the run possible lives in the plan. Two different name spaces,
  and the committed-snapshot suite now says so where it used to conflate them.

A side effect worth noting, because it made the graph tidier rather than messier:
replaying every recorded member in a single run re-attributed all nine promises that
carry a verdict to that one run and to the one evidence pack it sealed,
`ev_4af9b061-d3cb-448d-9671-7cd2fd54cf31.evidence`, holding 59 artefacts. The graph had
been carrying references to an evidence directory a cloud-sync conflict copy had renamed,
which the projection was correctly refusing to publish as edges. Those references are
gone, so the committed file now drops no edge at all.

**Four claims are still owed**, lines 22, 68, 89 and 301, and they are still on the page
as `stale` beside their citations. Authoring the two remaining documents is what would
settle them, at roughly the price recorded above per document.

Reaching `undesigned` from a `@verifies` tag would need a second annotation meaning
"this document admits the claim and does not design a test for it". That is a new
grammar, and a new grammar used only by this repository's own claims is precisely the
special case §23.1 and Property 36 exist to forbid. The honest arrangement was the
one that added no grammar.

## What a reviewer can check in one minute

```bash
node -e 'console.log(require("./apps/ledger/data/ledger.snapshot.json").metrics)'
node -e 'const s=require("./apps/ledger/data/ledger.snapshot.json");
  console.log(s.promises.filter(p=>p.citation.file==="README.md")
    .map(p=>[p.citation.line,p.verdict,p.citation.text].join("  ")).join("\n"))'
```

The second command prints five lines: one `proven` and four `stale`. Each is a claim
this repository makes about itself, the verdict it currently carries, and the text read
off `README.md` verbatim by the admission gate. Open the file at those line numbers and
the words are the same, or the build would have refused the citation.
