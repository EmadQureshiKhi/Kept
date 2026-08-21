# KEPT

**Every promise your product makes, and continuous proof it's still kept.**

<!-- DEPLOY, one edit: on line 9, replace `LEDGER_URL_PENDING_DEPLOY` — backticks included — with the HTTPS URL Vercel gives you. Nothing else in this file changes. Settings, in order: docs/deploy-ledger.md -->

## Start here

- **Live Ledger** — `LEDGER_URL_PENDING_DEPLOY`
- **Or run it yourself** — `npm run demo`, then open `http://localhost:3000`

`npm run demo` is the whole judge path. It boots the Ledger and the fixture
application from a snapshot committed in this repository: Kane is invoked zero times,
zero credits are spent, no credential is read and nothing beyond localhost is reached.
Measured worst case from the command to the rendered landing view is **3.6 s** for the
Ledger and 4.6 s for the fixture, with warm reloads around 38 ms. Figures, method and
the one 383 s cold outlier are in [docs/judge-path.md](docs/judge-path.md).

The live Kane loop is a separate command with prerequisites, documented below. You do
not need it, or an account, to see everything the Ledger shows.

## The idea in one paragraph

A product's promises live in its README, its landing page, and its changelog.
Its behaviour lives in code. The two drift apart silently. KEPT builds a single
graph of every promise — each one cited back to the exact source line that
claims it — designs a Kane test per promise, and then keeps that graph honest
from two directions: when code changes, it re-verifies the promises in the
blast radius; when docs change, it reconciles what the suite now owes.

When a promise goes red there are exactly three possible causes, and Kane's own
failure verdict picks between them:

| Cause | Signal | Repair |
|---|---|---|
| The code broke | result code `740` — confirmed product bug | agent patches the code |
| The test drifted | verdict: test issue | suite self-heals |
| The claim was never true | test fails, not a product bug | agent amends the docs |

That third branch is the interesting one, and `npm run loop` demonstrates it.

## The live loop

```bash
npm run loop     # node bin/kept verify --all --member-debug
```

**Prerequisites: a local Chrome installation and Kane CLI credentials.** Kane drives a
real browser, which is why the deployed Ledger cannot run this and does not try to.

The loop replays the Kane recordings committed under `tests/output-*/`, so it authors
nothing. Every figure below is read out of the captured run in
[docs/kane/replay/README.md](docs/kane/replay/README.md):

- **Nine members, eight pass, one fails.** The failure is the deliverable. T-7 —
  `tests/cart_discount_test.md` — asserts the never-true ten-percent-discount claim in
  the fixture's README, so it fails against a *correct* application. That is the
  docs-lie demonstration, and it routes to the `docs-lie` repair branch.
- **Eight verdicts move: seven `proven`, T-7 `red`.** Kane's `authored` list is `[]`.
  Every step came back from a recording.
- **Wall clock: 215–242 s** for the nine cached members.
- **Cost: free where a member passes, and a Kane judgement where one fails.** Measured
  with `kane-cli balance` either side of the run — one passing member replayed alone
  moved the balance **0.0000**; the failing member alone moved it **9.85**. Full
  accounting, including where Kane hides the figure, is in
  [docs/kane/credits.md](docs/kane/credits.md).

`--member-debug` is **not** a debugging flag. It echoes each member's own `testmd`
stream, and that stream is where the classification signal lives: the failing member's
`run_end` carries the result code and the reason code that decide which of the three
repair branches runs. Without it the loop still runs and the branch selection loses the
evidence it routes on.

### Bootstrapping the Kane context store, headless

Two commands, in this order, and the order is not cosmetic:

```bash
kane-cli context ingest apps/fixture/README.md --mode ci
kane-cli context extract --mode agent
```

`context ingest` **lands only**. A piped or headless stdin never continues into
extraction, so an ingest that looks like it did nothing has in fact succeeded: its
stdout is a single plain-text line, not NDJSON, and the remedy — *run `kane-cli context
extract` to extract them* — arrives on **stderr**. `context extract --mode agent` then
extracts perfectly well headless; it is not a TTY-only command, and the two-step
bootstrap exists because ingest stops early rather than because extraction needs a
human.

Two more things a headless caller has to know:

- `design tests` refuses a freshly extracted use-case with `code: UC_UNREVIEWED` and
  names its own remedy, so it needs `--allow-unreviewed` or a prior
  `kane-cli context review --approve <id>`.
- `context list` has **no `--mode` flag at all**. It takes `--json`, and passing
  `--mode agent` exits 1 on an unknown option.

Every stream quoted there is committed verbatim:
[docs/kane/context-bootstrap.md](docs/kane/context-bootstrap.md).

## Repository

Public source: <https://github.com/EmadQureshiKhi/Kept>

## Documents

- [docs/submission-summary.md](docs/submission-summary.md) — the project in 120
  words or fewer, which is the count the test suite holds it to.
- [docs/judge-path.md](docs/judge-path.md) — the measured time from `npm run demo`
  to the rendered landing view, and what the judge path does not spend.
- [docs/deploy-ledger.md](docs/deploy-ledger.md) — how the Ledger deploys with zero
  environment variables, and why its Vercel root is the monorepo root.
- [docs/kane/replay/README.md](docs/kane/replay/README.md) — the recorded full-suite
  replay: nine members, the deliberate failure, and what it cost.
- [docs/kane/credits.md](docs/kane/credits.md) — measured credit consumption, and the
  three different field names Kane spells it with.
- [docs/kane/context-bootstrap.md](docs/kane/context-bootstrap.md) — the headless
  bootstrap, recorded against a live Kane.
- [docs/commit-history-audit.md](docs/commit-history-audit.md) — what the commit
  history measures against R14.2, counted rather than claimed.

## Licence

MIT
