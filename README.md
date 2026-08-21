# KEPT

**Every promise your product makes, and continuous proof it's still kept.**

Built for the [Kane CLI Online Hackathon](https://www.testmuai.com/kane-cli/) (19–21 Aug 2026).
Agent: **Kiro**. Verification layer: **Kane CLI**.

> Work in progress — this README is scaffolding and will be replaced with
> setup steps, architecture, and demo instructions before submission.

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

That third branch is the interesting one.

## Documents

- [docs/submission-summary.md](docs/submission-summary.md) — the project in 120
  words or fewer, which is the count the test suite holds it to.
- [docs/judge-path.md](docs/judge-path.md) — the measured time from `npm run demo`
  to the rendered landing view, and what the judge path does not spend.
- [docs/commit-history-audit.md](docs/commit-history-audit.md) — what the commit
  history measures against R14.2, counted rather than claimed.

## Status

Setting up. Nothing to run yet.

## Licence

MIT
