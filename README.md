<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="Assets/kept-logo-dark.png"><img src="Assets/kept-logo-light.png" alt="KEPT" width="440"></picture></p>
<p align="center"><strong>Every promise your product makes, and continuous proof it's still kept.</strong></p>
<p align="center"><img src="https://img.shields.io/badge/license-MIT-111111" alt="MIT licensed"> <img src="https://img.shields.io/badge/typescript-5.9-111111" alt="TypeScript 5.9"> <img src="https://img.shields.io/badge/node-20.19%2B-111111" alt="Node 20.19 or newer"> <img src="https://img.shields.io/badge/kane--cli-0.8.4-111111" alt="Kane CLI 0.8.4"> <img src="https://img.shields.io/badge/runtime%20deps-9-111111" alt="Nine runtime dependencies"> <img src="https://img.shields.io/badge/properties-29%20verified-111111" alt="29 correctness properties"> <img src="https://img.shields.io/badge/tests-2406-111111" alt="2406 tests"></p>
<p align="center"><a href="#start-here">Start here</a> · <a href="#the-short-version">The short version</a> · <a href="#run-it-yourself">Run it yourself</a> · <a href="#the-idea">The idea</a> · <a href="#architecture">Architecture</a> · <a href="#the-three-contract-kane-model">Kane model</a> · <a href="#the-code-break-loop">Code-break loop</a> · <a href="#three-way-repair">Three-way repair</a> · <a href="#the-live-loop">Live loop</a> · <a href="#verification">Verification</a> · <a href="#status">Status</a> · <a href="#roadmap">Roadmap</a></p>

---

> Every claim a product makes about itself is an untested promise. KEPT graphs them all, each cited to the file and line that
> states it; a citation that does not resolve never enters it. Each binds to a Kane test: saving code re-verifies the blast
> radius, saving documentation reconciles what the suite owes. When a promise goes red, Kane's verdict picks one of three
> repairs: patch the code, evolve the test, or amend the documentation because the claim was never true. A deployed read-only
> ledger publishes every verdict, coverage and evidence. Kane reads the test as the specification, so it cannot separate a
> regression from a lie. KEPT can: you cannot break what was never proven to work.

## Start here

- **Live Ledger** — [withkept.vercel.app](https://withkept.vercel.app)
- **Or run it yourself** — `npm run demo`, then open `http://localhost:3000`
- **Or produce your own run** — one command, [walked through below](#run-it-yourself)

`npm run demo` is the whole judge path. It boots the Ledger and the fixture application from
a snapshot committed in this repository: **Kane is invoked zero times, zero credits are spent,
no credential is read and nothing beyond localhost is reached.** Measured worst case from the
command to the rendered landing view is **3.6 s** for the Ledger and 4.6 s for the fixture,
with warm reloads around 38 ms. Figures, method and the one 383 s cold outlier are in
[docs/judge-path.md](docs/judge-path.md).

The live Kane loop is a separate command with prerequisites, [documented below](#the-live-loop).
You do not need it, or an account, to see everything the Ledger shows.

**Three-minute demo:** [youtu.be/2dUtE4bwVO0](https://youtu.be/2dUtE4bwVO0), which walks the
deployed Ledger, a code-break repair, and an accepted documentation amendment, in that order.

---

## The short version

Every claim a product makes about itself is an untested promise. KEPT builds a graph of those
claims, cites each one to the file and line that states it, binds each to a Kane CLI test, and
publishes the result in a read-only ledger.

Kepler Coffee, the fixture application in this repository, makes eight claims about itself. All
eight are cited to `apps/fixture/README.md` lines 13 through 20. Eight carry a designed test,
seven are proven, and one is red. That last one was never true.

What Kane CLI does here: it designs the browser flows, drives real Chrome, and returns the
verdict. Every test identifier comes from Kane's own test plan, coverage comes from Kane's
coverage report, and evidence packs are matched back to their run by id.

Three different completion contracts are handled separately, because reading a paused run as a
failed one would corrupt the ledger. Authoring a test measured about 10.35 credits; every
re-verification after that is a cached replay and costs nothing.

When Kane cannot be reached, the ledger withholds the proven number and names the reason rather
than showing a stale one. A ledger that shows what it owes is the product.

---

## Run it yourself

Three levels. Each one stands alone, and only the third needs a Kane account.

### Level 1 — see it, no account (about 30 seconds)

```bash
git clone https://github.com/EmadQureshiKhi/Kept && cd Kept
npm ci
npm run demo          # Ledger on :3000, fixture on :3100
```

Open `http://localhost:3000` for the Ledger and `http://localhost:3100` for Kepler Coffee, the
application under verification. The Ledger reads one committed file, so this spends nothing and
asks for nothing. Every figure on the page can be checked against the file it came from:

```bash
node -e 'console.log(require("./apps/ledger/data/ledger.snapshot.json").metrics)'
```

Eight promises, seven proven, one red. The red one is a claim that was never true, and it is
supposed to be red — that is the demonstration, not a bug.

### Level 2 — check our claims, still no account (about 36 seconds)

```bash
npm test              # 136 files, 2406 tests, about 36 s
npm run check         # the same suite, plus the read-only scan and three type-check passes
```

No network, no credentials, no Kane. Every Kane behaviour under test is replayed from a
committed stream, so this passes on a bare checkout on a plane. `npm run check` also runs the
scan that proves the deployed Ledger cannot spend or mutate anything.

### Level 3 — produce your own run

```bash
npm run loop          # node bin/kept verify --all --member-debug
```

**Two prerequisites: a local Chrome, and Kane CLI credentials.** Kane launches a real browser and
drives it, and the credentials are what it bills — which is also why no button on the deployed
site can do this for you. Nine members replay from the recordings committed under
`tests/output-*/`. Eight pass and one fails on purpose.

**What it costs you:** a member that passes replays from cache and moves your balance `0.0000`;
the one that fails costs a Kane judgement, measured at `9.85`. So a full `npm run loop` is about
ten credits, not a suite's worth. Wall clock is 215–242 s.

Leave `npm run demo` running in a second terminal while you do this. `kept verify` writes the
snapshot at the end of the run, the Ledger imports that file as a module, and the dev server
reloads it — so **the page updates in front of you** with your run in it, your timestamps, your
evidence. Check `/runs` afterwards and the newest entry is yours.

### Break a promise yourself, and watch it come back

This is the loop, by hand, in about a minute of typing. It is the cheapest live run in the
repository because it verifies only the blast radius rather than the whole suite.

```bash
# 1. Break the running-subtotal behaviour: make the subtotal ignore quantity.
#    One line in apps/fixture/lib/cart.ts.

# 2. Verify only what that file can affect.
node bin/kept verify --changed apps/fixture/lib/cart.ts --member-debug

# 3. The Ledger now shows that promise red, with Kane's own verdict behind it.
#    Read what KEPT decided to do about it:
cat .kept/handoff.json

# 4. Put the line back, run step 2 again. The promise returns to proven.
```

Step 3 is the interesting one. The handoff names one repair branch out of three and, for
`code-break`, hands over a fenced list of paths the fix is allowed to touch. It cannot touch the
document that states the claim, and it cannot touch the test — both of those would turn the
promise green by lowering the bar instead of fixing the product.

If you would rather watch it happen on save than type the command, the two hooks under
`.kiro/hooks/` do exactly this: saving code re-verifies the blast radius, saving a document
reconciles what the suite owes.

### If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module '@kept/core'` | `packages/*/dist` is not in git | `npx tsc -b` |
| A port is busy | something else holds 3000 or 3100 | free the port; the tests navigate to these exact numbers |
| `npm run loop` exits 0 but nothing moved | Kane was never reachable | read `.kept/handoff.json` — the exit code is never the signal |
| An ingest looks like it did nothing | `context ingest` lands only | run `context extract` after it, see [the bootstrap](#bootstrapping-the-kane-context-store-headless) |

---

## The idea

A product makes claims about itself in a dozen places: a landing page, a pricing table, a
changelog entry, an onboarding tooltip, an API description, a README. Its behaviour lives in
code. The two drift apart silently, and nothing in a normal test suite notices, because a test
asserts what someone decided to assert — not what the product went and told the world about
itself.

KEPT builds a single graph of every promise, cites each one back to the exact source line that
claims it, binds each to a Kane CLI test, and then keeps that graph honest from two directions:
when code changes it re-verifies the promises in the blast radius, and when documentation
changes it reconciles what the suite now owes.

**A promise can be cited to anything in the repository.** The citation grammar is a path and a
line number — nothing about it is markdown-specific, and nothing in the graph knows what a
README is. A `@verifies` tag points at whatever file states the claim:

| A claim living in | Cited as | Works because |
|---|---|---|
| a hero heading in a React component | `app/page.tsx:34` | the line is read off disk verbatim |
| a row of a pricing constant | `lib/plans.ts:12` | a promise is text plus a location, not prose |
| an OpenAPI `description` | `openapi.yaml:208` | the file is never parsed as a document |
| a changelog entry | `CHANGELOG.md:5` | same grammar as any other path |
| a support-article sentence | `content/help/refunds.mdx:19` | same again |

The fixture in this repository keeps its eight claims in a markdown file, one per line, because
that is the cheapest thing to point at while explaining the idea and the cheapest thing to show
on camera. Every mechanism below — the admission gate, the blast radius, the three repair
branches, the sha256 interlock on an accepted amendment — reads a path and a line and would
behave identically against a JSX string. Where this document says "the document", that is
deliberate: it means whichever file the claim is written in.

> **The headline capability is the third repair branch.**
> When a promise goes red there are exactly three possible causes, and Kane's own failure
> verdict picks between them. Two of the three are things other tools do. The third is
> proposing a documentation amendment because a stated promise was **never true** — and it is
> proposed for a human, never written.

| Cause | The signal | The repair | Autonomy |
|---|---|---|---|
| The code broke | `result_code` 740, or a verdict object confirming a product bug | agent patches product source | applied, inside a path fence, and only to restore a promise KEPT has proven |
| The test drifted | a selector, locator, timing or navigation signal | `kept evolve` stages Kane's own pair diff | held as a review card |
| **The claim was never true** | an assertion failed while the app behaved and every selector resolved | `kept amend propose` renders a diff | proposed, and no documentation byte is written until a human accepts |

|  |  |
|---|---|
| **Problem** | A product's stated promises and its behaviour drift apart with nothing watching the gap |
| **Hard part** | Telling the three causes of a red promise apart — and specifically, telling "the product regressed" from "the claim was a lie", which the test runner structurally cannot know |
| **Answer** | A cited promise graph, a family-gated parser over Kane's real event streams, and a three-way router whose autonomy is fenced per branch |
| **Proof** | 29 correctness properties, a recorded closed loop in both directions, and a committed snapshot a reviewer re-derives every figure from with no credentials |

---

## Contents

- [Start here](#start-here)
- [Run it yourself](#run-it-yourself)
- [The idea](#the-idea)
- [Why this exists](#why-this-exists)
- [Architecture](#architecture)
- [The three-contract Kane model](#the-three-contract-kane-model)
- [The code-break loop](#the-code-break-loop)
- [Three-way repair](#three-way-repair)
- [A promise, and its four states](#a-promise-and-its-four-states)
- [The live loop](#the-live-loop)
- [The fixture and its eight claims](#the-fixture-and-its-eight-claims)
- [Command surface](#command-surface)
- [The Ledger](#the-ledger)
- [Repository layout](#repository-layout)
- [Verification](#verification)
- [Deployment](#deployment)
- [Documentation](#documentation)
- [Status](#status)
- [Roadmap](#roadmap)

---

## Why this exists

Every product ships two artefacts and only tests one of them. The code has a suite. Everything
the product *says about itself* has nobody — so it accumulates claims. A landing page rewritten
for a launch. A changelog entry that overstated what shipped. A pricing table nobody revisited
after the plans changed. A tooltip describing a flow that moved two releases ago. Each one is a
promise the product is making to a reader, with no mechanism behind it at all.

That gap is not merely untested. It is *unowned*, and it fails in a direction ordinary tooling
cannot see. A test suite going green tells you the assertions someone wrote still hold. It
tells you nothing about the sentence on the pricing page, and it cannot, because the sentence
was never an assertion.

Two things make closing that gap harder than pointing a test runner at a document.

**A claim has to be cited, not merely matched.** "The Cart screen shows a running subtotal"
is only checkable if you know exactly which line of which file claims it, and the graph has to
be able to say so verbatim. A promise whose citation does not resolve to a real line in a real
file never enters the graph at all — otherwise the ledger accumulates claims nobody can find,
which is the same problem one layer up.

**A red promise is ambiguous, and the ambiguity is the interesting part.** The test failed.
Did the product break, did the test drift, or was the sentence never true? The three demand
opposite repairs, and getting it wrong is worse than not trying: an agent that "fixes" a
never-true claim by implementing it has been set to work building a feature nobody designed,
and an agent that fixes a real regression by rewriting the sentence has made the documentation
agree with broken code. That second one is the failure mode that would make this entire
project worthless, which is why the fence forbidding it is structural rather than advisory.

Kane's own triage answers part of it and — measured rather than assumed — cannot answer the
rest, because Kane reads the test document as the specification and so has no way to conclude
that the specification is what is wrong. [Three-way repair](#three-way-repair) is where that
is resolved, and the resolution is the most interesting thing in this repository.

---

## Architecture

[![Two Kiro hooks turn a file save into a CLI run. bin/kept dispatches to the kept-cli command
surface, which calls kept-core: the Kane contract layer, the promise model, the two providers,
the verdict routers, the blast radius, the repair surfaces, the single write guard and the
handoff writer. kept-core spawns kane-cli 0.8.4 with stdout piped and consumes its NDJSON.
Working state lands under .kept/ and the committed ledger.snapshot.json is the only seam between
the CLI and the two Next.js applications, the read-only Ledger on port 3000 and the fixture
under verification on port 3100.](Assets/kept-architecture.svg)](Assets/kept-architecture.svg)

<sub>Click the diagram to open it at full size.</sub>

The delivered slice is **cite → design → verify → route → repair → project**.

| Stage | What happens |
|---|---|
| **Cite** | The baseline provider scans every `*_test.md` for `@verifies <file>:<line>` tags, reads the cited line off disk, and hands each candidate to the admission gate. A candidate with no citation, or one citing past the end of its file, is refused with a diagnostic naming the provider that supplied it. This provider cannot fail: it succeeds on every repository state including one with no tests at all, and it never sets the degraded flag. |
| **Design** | The enrichment provider invokes `cover gaps --json --mode agent` under the Assurance family and layers the designed and proven axes on top — accepted only after the `done` event arrives with status `complete`. Anything else degrades the graph with a specific named reason and the build still exits 0. |
| **Verify** | `kept verify` computes the blast radius from `testrun_plan.members[].test_id` and replays exactly those members. Verdicts are written only after `testrun_done`, and only through the write guard. |
| **Route** | Each failing member goes through one strategy interface. The router returns exactly one branch plus the evidence reference that justified it, and it reads `result_code` only through the coercing accessor. |
| **Repair** | `code-break` hands the agent a fenced write path; `test-drift` stages a review card; `docs-lie` proposes an amendment behind a sha256 interlock. The branch decides the autonomy, and one fence table is the only place that mapping is written. |
| **Project** | `kept snapshot` writes canonical bytes to `apps/ledger/data/ledger.snapshot.json`, which the Ledger imports at build time. The deployment has no idea Kane exists. |

Four decisions carry most of the load, and every structural oddity in the codebase follows
from one of them.

1. **A Kane stream cannot be parsed without naming its family.** `parseStream` takes a
   `FamilyContract` as its first argument, `FamilyContract` carries a module-private brand, and
   `contractFor` is the only way to obtain one. Parsing anonymously is a type error rather than
   a review comment.
2. **Verdicts move only on a proven outcome.** One guard, called by every writer, requiring a
   complete stream *and* an exit meaning of success or failure. Every row of the failure matrix
   follows from it instead of from a check somebody has to remember.
3. **`result_code` is compared at exactly one site.** One recorded event carries the code as
   both the number `100` and the string `"100"`, so a raw comparison fires on one path and
   silently never fires on the other. A source scan forbids one outside `coerce.ts`.
4. **The deployed artefact cannot spend or mutate.** No non-GET handler, no server action, no
   auth, no `child_process`, and a scan that fails the build if one appears.

---

## The three-contract Kane model

This is the part that would be easiest to get wrong and most expensive to get wrong quietly.

[![Kane 0.8.4 has three terminal-event contracts rather than one, and both paths KEPT depends on
are the two that are not run_end. ExecutionRun terminates on run_end and is enabled by the agent
flag. ExecutionTestrun terminates on testrun_done and is enabled by piping stdout, with no such
flag existing. Assurance terminates on done, is enabled by mode agent, and its exit code 3 means
paused and resumable rather than failure. Two further commands belong to no family at all. Below
the families sit the complete exit-code matrix and the two-condition write gate that every row
of the failure matrix follows from.](Assets/kept-three-contracts.svg)](Assets/kept-three-contracts.svg)

<sub>Click the diagram to open it at full size.</sub>

Kane 0.8.4 has **three** terminal-event contracts, and both of the paths KEPT actually depends
on are the two that are not `run_end`. A parser built on `run_end` alone reports nothing on
blast-radius verification and nothing on the ledger's data source — not with an error, but by
waiting forever for an event that stream never carries.

| Family | Commands | Terminal | NDJSON by | Exit 3 | Evidence |
|---|---|---|---|---|---|
| `ExecutionRun` | `run`, `testmd run` | `run_end` | `--agent` | timeout or cancelled | `session_dir/evidence/` |
| `ExecutionTestrun` | `testrun run` | `testrun_done` | piped stdout, **no flag exists** | timeout or cancelled | `<cwd>/.testmuai/evidence/` |
| `Assurance` | `cover gaps`, `maintain reconcile`, `context extract`, … | `done` | `--mode agent` | **paused and resumable** | none |

That last cell is the one that matters. Reading an Assurance exit 3 as a failure would
overwrite good verdicts with red ones, and the pause would be unrecoverable because the prior
state is gone. So the meaning is read from the contract rather than re-derived, and the
function that reads it is total over every integer and `null`.

Several facts in this table are corrections to the published documentation, each measured
against the installed binary and recorded with its stream:

- **`testrun run` has no `--agent` flag.** It emits NDJSON whenever stdout is a pipe, and the
  invoker refuses an argv carrying `--agent` anywhere in it, because the flag would be taken as
  a positional and silently change the selection.
- **`context list` takes no `--mode` flag at all.** `--mode agent` exits 1 with an empty stdout
  and `error: unknown option '--mode'`. It was listed as an Assurance command once, which made
  every documentation save resolve to `listing-unreadable` and no source ever match. It now
  goes through `invokePlain`, which appends nothing.
- **A dry run has no terminal event.** `testrun run --dry-run` prints one line — the plan — and
  exits 0, because it executed nothing and so has no execution to report done. Requiring the
  terminal event conjunctively discarded every plan the installed CLI can produce.
- **`cover` reads its depth axis out of a sealed pack** and refuses at exit 2 on a replay pack,
  which is every pack this repository has. `cover gaps` answers the same two axes from the live
  graph instead, and is what the enrichment provider invokes.
- **The `done` envelope is real and always arrives**, even on a refusal that produced no work.
  A refusal is a *complete* stream, not a crashed one, and the committed
  `assurance-cover-refused.ndjson` fixture is those exact two lines.

The whole measured surface, with the stream behind each claim, is in
[docs/kane/command-surface.md](docs/kane/command-surface.md).

---

## The code-break loop

[![A sequence across six lifelines: the Kiro hook, kept verify, the plan cache, kane-cli, the
parser and verdict router, and the state store with the handoff writer. A save fires the hook.
The plan is refreshed by a dry run and cached. The blast radius is computed from the identifiers
the plan supplied, and the argv names the corresponding member paths. kane-cli is spawned with
stdout piped and the member-debug variable set. The NDJSON and the bracketed member stderr
stream come back, failing members are routed to exactly one repair branch, the write guard is
asked before any verdict is written, and the handoff returns to the agent, whose repair re-fires
the hook and closes the loop.](Assets/kept-verify-path.svg)](Assets/kept-verify-path.svg)

<sub>Click the diagram to open it at full size.</sub>

```text
1  edit apps/fixture/lib/cart.ts                 break the subtotal recompute
2  kept-code-verify fires        →  kane-cli testrun run <the radius> --bug-detection continue
3  testrun_done · member failed  →  verdict red, snapshot and handoff written
4  the agent reads the handoff   →  branch code-break, patches only inside allowedPaths
5  saving that patch re-fires the hook
6  testrun_done · member passed  →  verdict proven — the loop is closed
```

Three details are load-bearing and none of them is obvious.

**The identifiers handed to Kane are always Kane's own.** They come from
`testrun_plan.members[].test_id` and from nowhere else. A member the plan gave no identifier is
never selected, and its exclusion is recorded — because a missing identifier means a missing
recording, and replaying it would *author* the document live and spend a judge's credits on a
document that mints no promise.

**`--bug-detection continue` is stated in the argv rather than inherited.** Bug detection is a
profile setting in Kane's own config file, so without the flag the branch KEPT chooses would
depend on ambient state belonging to another tool: changeable by anyone, invisible in the argv,
and absent from the recording. A run that reports `code-break` on Tuesday and `docs-lie` on
Wednesday for the same failure is not a router.

**The handoff is written for every run, including the ones that proved nothing.** A crashed
stream, a paused run, a preflight rejection, a missing binary, an empty radius — each writes a
handoff with `nextAction.branch: null` and a populated `diagnostics` array. If a failure path
wrote nothing, the agent would open the file and read the *previous* run's instruction, and
repair a promise that is no longer red. The invariant is mechanical: there is no path through
the builder that emits a null branch with an empty diagnostics list.

Both hook prompts also tell the agent, in as many words, that **the process exit code is never
the signal**. `kept` exits 0 on a crashed stream, a missing binary and an empty radius alike,
so the handoff is the instruction and the status is not.

---

## Three-way repair

[![The resultCode740 rung ladder and the failureYamlTriage signal lists decide which of three
repair branches a failing promise gets. Each branch carries its own autonomy, its own artefact
and two path fences, and only one of the three ever hands an agent a write path. Beneath them is
the measured reason that write path needs a further condition: Kane reads the test document as
the specification, so a genuine regression and a claim that was never true earn the same triage
category, and one unchanged failure has drawn four different answers across three sealed packs
and six live runs. The discriminator KEPT holds and Kane does not is the promise's own prior
verdict. Last, the eight steps of the documentation-triggered loop, which reaches an amendment
without writing anything.](Assets/kept-repair-branches.svg)](Assets/kept-repair-branches.svg)

<sub>Click the diagram to open it at full size.</sub>

The router is a strategy interface with two implementations, selected by a single string in
`.kept/config.json`. Nothing outside `src/verdict/` imports a concrete router — a source scan
enforces it — so the empirical question the verdict spike settled could only ever change one
value in one file.

`resultCode740` reads the inline verdict object first, because a failing terminal can carry the
confirmed-bug code *and* an object whose `confirmed` flag is false, and the object is both the
richer signal and the later one. Absent an object it reads the coerced code, and absent a
useful code it delegates to `failureYamlTriage` and returns that answer verbatim — so for every
failure with no inline object the two configurations produce byte-identical annotations.

### The one condition on automatic repair

`code-break` is the only branch whose repair an agent applies by itself, so deciding it needs
positive evidence that the product is at fault. The only such evidence that survives to KEPT is
the category in Kane's sealed triage note, and that category **cannot carry the distinction the
repair needs**:

| Source | What Kane said | Implies | Correct? |
|---|---|---|---|
| pack `0944d075` — the broken subtotal | `application_issue/ui_data_defect`, 0.96 | `code-break` | yes, the product regressed |
| pack `57591bff` — the never-true discount claim | `application_issue/ui_data_defect`, 0.89 | `code-break` | **no**, the claim was invented to be false |
| pack `108dbb62` — the same failure again | `automation_bug/state_transition_bug`, 0.91 | `test-drift` | **no**, and it contradicts the pack above |

One unchanged failure has drawn four different answers across three packs and six runs, and no
widening of the signal list turns that into a discriminator. The reason is structural rather
than a gap in the vocabulary: **Kane treats the test document as the specification**, so from
where it stands the claim cannot be false. Its suggested fix for the never-true discount claim
is a perfectly correct description, on its own terms, of a discount the cart never applies.

The discriminator KEPT has and Kane does not is the promise's **own prior verdict**. `proven`
means this repository witnessed the behaviour, with a terminal event and a sealed pack behind
it; red after that is a regression, and restoring it is exactly what the branch authorises. A
promise that was never `proven` has no such witness.

> **You cannot break what was never proven to work.**

So the handoff grants the `code-break` write fence only when at least one promise carrying that
branch was `proven` before the run. Otherwise the branch **stays** `code-break` — the Ledger
goes on publishing Kane's real conclusion, which is the honest thing to show — and only the
autonomy is withheld: `allowedPaths` empties, every glob the granted row allowed becomes
forbidden, and nothing is added anywhere. The direction matters, and a property test asserts it.

### What each branch may write

| Branch | Autonomy | Artefact | May write | Never writes |
|---|---|---|---|---|
| `code-break` | apply | a patch | `apps/fixture/{app,components,lib}/**` | the fixture's own docs, `tests/**`, `apps/ledger/**`, `packages/**` |
| `test-drift` | hold | `.kept/review-cards/<id>.json` | nothing | everything |
| `docs-lie` | propose | `.kept/amendments/<id>.json` | nothing | everything, until a human accepts |

The two forbidden entries on `code-break` are the same failure twice. Letting the loop edit the
claim would make the document agree with broken code; letting it edit the test would weaken the
assertion instead of fixing the bug. Either one turns a red promise green by lowering the bar,
which is the one repair this system must be structurally unable to perform.

Accepting an amendment is a surgical write: re-read the file, re-hash the cited line, refuse as
`stale` on a mismatch, and on a match replace exactly one array element and rename over the
original. Every other byte is identical afterwards, each line keeps its own terminator so a
mixed-ending file is not rewritten end to end, and a property test asserts the byte equality
rather than a line count.

---

## A promise, and its four states

[![The verdict state machine: undesigned becomes stale when a designed test gains an @verifies tag
citing it; stale becomes proven on a passing member and red on a failing or broken one; proven
becomes red when the product regresses, which is the only transition an agent may repair by
itself; and a repaired promise returns to proven on the next run. Beside the machine sits how a
promise identifier is derived and the admission gate in front of it, the two coverage figures
that count different things over different denominators, and the four lanes the Ledger graph
lays out.](Assets/kept-promise-lifecycle.svg)](Assets/kept-promise-lifecycle.svg)

<sub>Click the diagram to open it at full size.</sub>

```ts
promiseId = 'p_' + sha256(`${posixPath}\n${normaliseClaim(text)}`).slice(0, 12)
```

The line number is deliberately absent from the key. A promise carries its verdict, its
evidence pack, its repair annotation and its freshness stamp under this identifier, so if the
identifier moved when somebody inserted a paragraph above the claim, every rebuild would orphan
the history of a promise that never changed. Editing the *words* of a claim, or moving it to a
different file, is a different promise — and it correctly starts undesigned rather than
inheriting proof it never earned.

Two figures on the metric rail count different things over different denominators, and the page
labels each so neither borrows the other's word:

- **Proven coverage** counts *promises this repository verified* — eight claims, seven proven.
  It is `null` when the total is zero and `null` when the graph is degraded, because degraded
  means the enrichment axis was discarded and a number would claim knowledge KEPT does not
  have. The Ledger then replaces the tile with a `baseline data only` chip rather than showing a
  zero. The honest failure mode is "we are not claiming proof right now", never "proof is 0%".
- **The proven axis** counts *acceptance criteria Kane's graph holds execution facts for* — six
  of six — read verbatim from `cover gaps`, whose own configuration names its source as
  `graph_execution_facts` and its denominator as `current_live_acs`.

---

## The live loop

```bash
npm run loop     # node bin/kept verify --all --member-debug
```

**Prerequisites: a local Chrome installation and Kane CLI credentials.** Kane drives a real
browser, which is why the deployed Ledger cannot run this and does not try to.

The loop replays the Kane recordings committed under `tests/output-*/`, so it authors nothing.
Every figure below is read out of the captured run in
[docs/kane/replay/README.md](docs/kane/replay/README.md):

- **Nine members, eight pass, one fails.** The failure is the deliverable. T-7 —
  `tests/cart_discount_test.md` — asserts the never-true ten-percent-discount claim in the
  fixture's own claims, so it fails against a *correct* application. That is the docs-lie
  demonstration, and it routes to the `docs-lie` repair branch.
- **Eight verdicts move: seven `proven`, T-7 `red`.** Kane's `authored` list is `[]`. Every step
  came back from a recording.
- **Wall clock: 215–242 s** for the nine cached members, which is why `--all` takes a fifteen
  minute budget rather than the five minute one a save hook uses. At 300 s the suite is
  terminated mid-flight, and a killed run writes no verdict at all.
- **Cost: free where a member passes, and a Kane judgement where one fails.** Measured with
  `kane-cli balance` either side of the run — one passing member replayed alone moved the
  balance **0.0000**; the failing member alone moved it **9.85**. Full accounting, including
  where Kane hides the figure, is in [docs/kane/credits.md](docs/kane/credits.md).

`--member-debug` is **not** a debugging flag. It echoes each member's own `testmd` stream, and
that stream is where the classification signal lives: measured across six live runs,
`testrun_member_end` carries only `path`, `test_id` and `status` — no result code, no reason
code, no verdict object. The failing member's own `run_end` on the `[member]` stream carries all
three. Without the flag the loop still runs and every failure falls through to the triage note,
including a genuine product bug. The captured stream is written to
`.kept/diagnostics/<runId>.member.ndjson` before anything is routed, so a run whose branch
surprises somebody leaves the bytes that decided it — and a run where the signal was *absent*
leaves proof of the absence.

### Bootstrapping the Kane context store, headless

Two commands, in this order, and the order is not cosmetic:

```bash
kane-cli context ingest apps/fixture/README.md --mode ci
kane-cli context extract --mode agent
```

`context ingest` **lands only**. A piped or headless stdin never continues into extraction, so
an ingest that looks like it did nothing has in fact succeeded: its stdout is a single
plain-text line, not NDJSON, and the remedy — *run `kane-cli context extract` to extract them* —
arrives on **stderr**. `context extract --mode agent` then extracts perfectly well headless; it
is not a TTY-only command, and the two-step bootstrap exists because ingest stops early rather
than because extraction needs a human.

This is also why KEPT never ingests on its own behalf: the invoker always spawns with stdin
ignored, so any ingest it performed would land and never extract.

Two more things a headless caller has to know:

- `design tests` refuses a freshly extracted use-case with `code: UC_UNREVIEWED` and names its
  own remedy, so it needs `--allow-unreviewed` or a prior `kane-cli context review --approve <id>`.
- `context list` has **no `--mode` flag at all**. It takes `--json`, and passing `--mode agent`
  exits 1 on an unknown option.

Every stream quoted there is committed verbatim:
[docs/kane/context-bootstrap.md](docs/kane/context-bootstrap.md).

---

## The fixture and its eight claims

`apps/fixture` is **Kepler Coffee** — a coffee shop in seven screens, all state in
`localStorage`, no API routes, no database, no `fetch`. It exists to be a product that makes
specific checkable claims about itself, so a promise can be broken on camera and repaired.

| Route | Screen | The behaviour that matters |
|---|---|---|
| `/` | Home | Primary call to action links to Shop |
| `/shop` | Shop | Exactly six coffees, roast filter applied without a reload |
| `/product/[slug]` | Product | Price rendered in the currency chosen in Settings |
| `/cart` | Cart | Quantity steppers and a running subtotal |
| `/checkout` | Checkout | Client validation that names the offending field |
| `/orders` | Orders | History that survives a full reload |
| `/settings` | Settings | Currency choice that survives a full reload |

Its eight claims live in `apps/fixture/README.md`, **one per line**, so a citation line number
identifies exactly one claim. A markdown file is the example, not a requirement — the same eight
claims could sit in the components that render them and nothing in the pipeline would change.
One line per claim is the part that matters, because a line is what a citation addresses.

Two of the eight are load-bearing for the demonstration:

- **The breakable claim** — the running subtotal, verified by `tests/cart_subtotal_test.md`.
  The break is one edit in `apps/fixture/lib/cart.ts`, making `subtotal` ignore quantity. Kane's
  assertion fails, the router returns `code-break`, and the agent restores the reduce. This is
  the on-camera loop.
- **The never-true claim** — a ten percent discount above fifty dollars, verified by
  `tests/cart_discount_test.md`. **No discount logic exists anywhere in the fixture and none
  will be added.** Kane asserts a discounted total, the app behaves correctly and shows the
  undiscounted one, the selector resolves, the assertion fails. That is the `docs-lie` branch,
  and the amendment it proposes is the second half of the demonstration.

The fixture's claim file is pinned by sha256 in the test suite, so the demonstration cannot
quietly leave a ninth claim behind.

---

## Command surface

`bin/kept` → `packages/kept-cli`. Hand-rolled argv parsing, no parser dependency. Every command
exits **0** unless the CLI itself is broken or was given mutually exclusive flags — Kane's
outcomes are data, not exit codes.

| Command | Kane invocation | Family | Budget | Writes |
|---|---|---|---|---|
| `kept build` | `cover gaps --json --mode agent` | Assurance | 60 s | state, snapshot |
| `kept verify --changed <p…>` | `testrun run --dry-run` if the plan is stale, then `testrun run <paths> --on-failure continue --bug-detection continue` | ExecutionTestrun | 300 s | state, handoff, snapshot |
| `kept verify --all` | the same, over every plan member carrying an identifier | ExecutionTestrun | 900 s | state, handoff, snapshot |
| `kept reconcile --changed <p…>` | `maintain reconcile --from <doc> --source-id <resolved> --plan --mode agent` | Assurance | 300 s | state, source cache, review cards, handoff, snapshot |
| `kept reconcile apply [plan]` | `maintain reconcile --apply [plan] --mode agent` | Assurance | 300 s | state, review cards, handoff, snapshot |
| `kept evolve <ref>` | `maintain evolve <ref>` | Assurance | 300 s | review cards, handoff |
| `kept amend propose --run <id> --text '<sentence>'` | none | — | — | amendments, snapshot |
| `kept amend list \| show \| accept \| reject` | none — `accept` triggers a rebuild | — | — | the cited document on accept, amendments, snapshot |
| `kept snapshot` | none | — | — | snapshot only |

Common flags: `--repo <root>`, `--json`, `--router <name>`, `--member-debug`.

Three refusals are worth stating, because a plausible-looking invocation is rejected:

- **`kept reconcile` never invents a source id.** `maintain reconcile` requires both `--from` and
  `--source-id`, and the id is resolved at run time against the live store through a five-rung
  match ladder. `--source-id` can only be constructed from the success arm of that resolution, so
  an unresolved source is a **structural** no-op: no spawn, no credits, no review card, no verdict
  movement, `degraded` still false, exit 0. Two live candidates tying at one rung is `ambiguous`,
  never a coin flip.
- **`kept reconcile apply` is human-only** and absent from both hook prompts. Walking a stored
  plan mutates the suite, and that is not a decision a save hook may take.
- **`--plan` with `--apply` is the one non-zero exit in the product.** One stages and the other
  walks what was staged, so no invocation can mean both. It is rejected by the argument parser
  before anything spawns.

---

## The Ledger

`apps/ledger` is a read-only projection over the committed snapshot. Six routes a reader visits,
every one statically rendered:

| Route | Contents |
|---|---|
| `/` | The promise graph, the metric rail, the freshness chip, and a promise panel |
| `/coverage` | The shareable public page: both coverage figures, freshness, every promise with its verdict |
| `/amendments` | Pending `docs-lie` diffs with an accept control |
| `/reviews` | Held review cards, each with its promise id, branch and evidence reference |
| `/runs` | The terminal-event log: family, command, status, result code, credits, exit meaning |
| `/badge.svg` | GET only, `image/svg+xml`, proven coverage as a whole-number percentage |

The build reports nine, because Next's own 404 and the two icon routes prerender alongside them.
All nine are marked static in the build output and on the live deployment, where `/` answers with
`x-nextjs-prerender: 1` — the host stating the page was built before the request rather than for
it.

There is no `POST`, `PUT`, `PATCH` or `DELETE` handler, no server action, no `middleware.ts`, no
`child_process` import and no authentication. `scripts/check-readonly.mjs` asserts all of that
by scanning the app, and it runs in the test suite as well as in the build script.

The accept control is where two requirements meet: one wants an accept control in the Ledger,
the other forbids any route that mutates persisted data. Both hold because the write stays in
the CLI — the control is a real, keyboard-focusable button that copies `kept amend accept <id>`
to the clipboard and reveals the command inline. The Ledger writes nothing.

**Craft is scored, so it is specified rather than improvised.** A warm desaturated ink palette
with saturated colour reserved entirely for verdict communication; one implied light source
driving a three-class elevation system; monospace as texture for identifiers and citations
rather than as a default; and five motion orchestrations behind a single gate. Under
`prefers-reduced-motion: reduce` every orchestration resolves to its end state synchronously on
first paint, and a test renders the page under both media states and compares the computed style
of every animated property. Three further tests hold the palette itself: measured contrast over
the whole ink ramp, parity between the CSS custom properties and their typed mirror, and a scan
that fails on `backdrop-filter`, on any hex above 70% saturation, on a shadow whose colour is not
a token, and on an emoji.

---

## Repository layout

```text
bin/kept                    the launcher; reports honestly when dist/ is absent
packages/kept-core/         40 modules, no process of its own
  kane/                     family contracts, the parser, coercion, exit meaning,
                            evidence resolution, the zip reader, the sealed triage note,
                            the [member] stream, and the one process boundary
  model/                    ids, the citation admission gate, metrics, the zod snapshot
                            schema, canonical serialisation
  providers/                the adapter, the infallible baseline, cover gaps enrichment,
                            the tolerant payload projection, the merge
  verdict/                  the strategy interface and both implementations
  radius/                   the plan cache and the blast radius
  repair/                   review cards, docs amendments, the surgical line writer
  handoff/                  the closed-loop contract
  context/                  the source-id ladder, the listing, its cache, the fork guard
  state.ts                  the single write guard
packages/kept-cli/          the command surface, config resolution, six commands
apps/fixture/               Kepler Coffee: seven screens, eight claims, port 3100
  test/                     unit and property tests over the cart, catalog and currency
apps/ledger/                the read-only projection: six visitable routes, port 3000
tests/                      the designed corpus — eight *_test.md files
tests/output-*/             committed Kane recordings, so replay authors nothing
docs/kane/                  every measured Kane fact, with the stream behind it
.kiro/hooks/                the two hooks
.kiro/specs/kept/           requirements, design, tasks
Assets/                     the two logo plates, the mark, and five SVG diagrams
tools/logo/                 build_logo.sh — the light and dark plates, in ImageMagick
tools/diagrams/             the SVG emitter, one generator per diagram, and the verifier
scripts/                    the demo launcher and the read-only checker
```

### The diagrams are generated, not drawn

```bash
npm run diagrams     # bash tools/build-diagrams.sh
```

No Mermaid, no Graphviz, no dagre, no elkjs, and no image model. `tools/diagrams/svglib.py`
is a small SVG emitter and there is one generator per diagram, with layout as explicit
hand-chosen coordinates.

That is a deliberate inversion. Auto-layout engines optimise for edge crossings, which is not
the requirement here: **every label must sit inside its own box or on its own edge, no label
may cross a line, and every arrow must run through space holding nothing else.** None of those
is a term in a layout engine's objective function, so it will happily overflow a box or drop a
label across a line to reduce a crossing.

Two mechanisms keep the build honest, because a diagram with an overflowing label renders
perfectly well and is simply wrong:

- **Width checking at draw time.** Every text helper takes the space it was written for and
  reports a finding when the string will not fit, estimating width as `len × size × 0.53`. The
  first pass at the architecture diagram produced 23 findings.
- **A collision verifier** that parses the finished SVG back out and reports overlapping boxes,
  label plates covering borders, text outside the canvas, and text sitting on a line. It runs
  before any raster export, and `selftest.py` plants one of each fault and asserts all four are
  caught — because this verifier twice passed a set vacuously through a regex that parsed less
  than it appeared to, and neither time was visible from the output.

Findings accumulate and the build keeps going, so one pass surfaces everything rather than one
fault per run. The style is black on white throughout: weight, dashing and fill tone carry
every distinction colour would, so the diagrams survive being printed, projected, or read by
someone who does not separate hues — and a test asserts no diagram carries a chromatic fill.

Each diagram is one self-contained file that fetches nothing at render, with the header mark
embedded as a base64 data URI. That is not tidiness: an SVG rendered through an `<img>` tag,
which is what a Markdown image is, loads no external subresource at all, so a *referenced* mark
renders in a local preview and leaves a hole on the published page.

Each diagram's `<desc>` is the source of the README's alt text for it, copied out by
`sync_readme_alt.py`, and a test asserts the two still agree. A diagram is never the only
representation of what it shows.

Every diagram links to its own file, because a 1740px canvas is downscaled about 2× in
GitHub's content column and the detail is otherwise unreachable. Opening the file renders the
SVG standalone, where browser zoom is lossless at any depth. That is the ceiling for a README:
GitHub strips script and inline handlers from rendered Markdown, so in-page zoom controls and
drag-to-pan are not available at any price — and an SVG loaded through an `<img>` never runs
script regardless of what the host allows.

---

## Verification

```text
npm test          # vitest --run — never watch
npm run check     # the read-only scan, tsc -b, both app type-checks, then the suite
```

**136 files, 2406 tests, about 36 seconds** on a bare checkout. 2401 pass and 5 are skipped, each
skip conditional on a repository state rather than switched off: they are the assertions that hold
the README to carrying a placeholder instead of a deployed URL, and the deployment has happened,
so the opposite assertions run in their place. No Kane, no credentials, no network — every Kane
behaviour under test comes from a committed fixture.

**All 29 correctness properties** from the design are implemented, each as a `fast-check`
property with a minimum of 100 generated cases and its design property named in the test title.
They assert the things a demonstration cannot show: that a promise identifier survives its claim
moving to a different line, that no promise enters the graph without a resolvable citation, that
a snapshot round-trips to byte-identical output, that both routers agree for a `result_code` of
`"740"` and `740`, that exit-code interpretation is total and family-correct, that verdicts and
freshness move only on a proven outcome, that every promise outside the blast radius is
byte-identical afterwards, and that the reduced-motion render and the post-animation render are
the same DOM.

Six of the tests are source scans rather than behaviour tests, because the thing being protected
is a structural property no example could pin:

| Scan | Fails on |
|---|---|
| `no-raw-result-code` | any `result_code` comparison outside `coerce.ts` |
| `read-only-scan` | a non-GET handler, an auth check or a `child_process` import under `apps/ledger` |
| `router-isolation` | a concrete verdict router imported from outside `src/verdict/` |
| `animejs-import-scan` | a default import, a deep path, or `animejs` reached from outside the motion gate |
| `typography-discipline` | monospace on a run of prose rather than on an identifier |
| `forbidden-palette` | `backdrop-filter`, over-saturated hex, an untokenised shadow, an emoji |

Beside them sit the regressions that pin real recorded bytes: the twelve-line smoke run parsed
with zero diagnostics, the two-line `cover` refusal envelope, the per-command argv contract, the
source-resolution ladder with zero spawns on every failure rung, and the committed evidence's
referential integrity.

---

## Deployment

Live at **<https://withkept.vercel.app>**, on Vercel, with **zero environment variables** —
because the build reads a committed file. There is no API to key, no database to address and no
Kane to authenticate.

Two things about the shape look wrong and are load-bearing, both explained in
[docs/deploy-ledger.md](docs/deploy-ledger.md):

- **`apps/ledger` has no `package.json`**, so the project root is the monorepo root and the app
  is named as an argument to the build command instead of by the root setting. Pointing Vercel at
  `apps/ledger` reports "No Next.js version detected" and no other setting rescues it.
- **The build command builds `@kept/core` first.** `packages/*/dist` is gitignored, so a fresh
  clone resolves `@kept/core` to a package whose entry point does not exist. `npm ci` still
  creates the symlink, which is what makes the failure read as a broken import rather than a
  missing artefact. `tsc -b packages/kept-core && next build apps/ledger` is the whole fix.

The deployed bundle carries no filesystem code either. `@kept/core` declares
`"sideEffects": false` and the snapshot schema reads its vocabulary from a module that imports
nothing, so the directory walkers that resolve evidence packs locally are absent from the build
rather than merely unused in it. Verified by the build going from four
`Dynamic filesystem access` warnings and a 52.6 MB trace to zero warnings and 41.9 MB.

Public source: <https://github.com/EmadQureshiKhi/Kept>

---

## Documentation

| Document | Covers |
|---|---|
| [docs/submission-summary.md](docs/submission-summary.md) | The project in 120 words or fewer, which is the count the suite holds it to |
| [docs/judge-path.md](docs/judge-path.md) | The measured time from `npm run demo` to the rendered landing view, and what it does not spend |
| [docs/deploy-ledger.md](docs/deploy-ledger.md) | Deploying with zero environment variables, and why the Vercel root is the monorepo root |
| [docs/kane/command-surface.md](docs/kane/command-surface.md) | Every measured Kane fact, and what each one corrected |
| [docs/kane/replay/README.md](docs/kane/replay/README.md) | The recorded full-suite replay: nine members, the deliberate failure, what it cost |
| [docs/kane/credits.md](docs/kane/credits.md) | Measured credit consumption, and the three field names Kane spells it with |
| [docs/kane/loop/README.md](docs/kane/loop/README.md) | The closed loop, and the three corrections that made the sealed triage note readable |
| [docs/kane/context-bootstrap.md](docs/kane/context-bootstrap.md) | The headless bootstrap, recorded against a live Kane |
| [docs/kane/verdict-spike.md](docs/kane/verdict-spike.md) | The empirical confirmation that chose the default router |
| [docs/checkpoints.md](docs/checkpoints.md) | What each checkpoint verified, and what clearing it turned up |
| [docs/commit-history-audit.md](docs/commit-history-audit.md) | What the commit history measures against the submission checklist, counted rather than claimed |
| [.kiro/specs/kept/](.kiro/specs/kept/) | Requirements, design and the task plan the whole build follows |

---

## Status

Honest accounting, because the interesting claims here are verification claims and an overstated
one is worse than a missing one.

**Built and green.** The three-contract Kane layer — contracts, the family-gated parser,
coercion, per-family exit interpretation, evidence resolution, the zip reader for sealed packs,
triage attribution by identifier, the `[member]` stream reader, and the invoker. The promise
model, the citation admission gate, metrics with their zero guard, the zod snapshot schema with
its cross-field refinements, and canonical serialisation. Both providers and the merge. Both
verdict routers behind one interface. The plan cache and the blast radius. Review cards, docs
amendments with their interlock, and the surgical line writer. The handoff with its fence table.
The single write guard. Six CLI commands. The seven-screen fixture with its eight claims and the
eight-document designed corpus. The Ledger's six visitable routes, its visual system, its five motion
orchestrations and its reduced-motion equivalence. All 29 correctness properties.

**Verified against a live Kane.** The verdict spike, recorded and committed, which chose the
default router. The authored corpus and its recordings, so replay is free. The full-suite replay:
nine members, eight passing from cache at 0.0000, one deliberate failure at 9.85. The closed
code-break loop, with both terminal events and the intervening patch committed. A live
`maintain reconcile --plan` with a genuinely resolved source id. The headless bootstrap, both
commands, with the two refusals a headless caller meets recorded verbatim.

**What finding those things cost is worth stating**, because component coverage could not have
found them. The sealed triage note was inside a zip nothing opened, so every failure reported the
note absent and answered `docs-lie` — a three-way branch that was a one-way branch and looked
alive. `application_issue` was missing from the product-fault list, so a deliberately broken
subtotal routed to `docs-lie` while Kane's note read `application_issue/ui_data_defect` at 0.96.
`context list` was declared an Assurance command, so the invoker appended a flag Kane rejects and
every documentation save resolved to `listing-unreadable`. A dry run was required to carry a
terminal event it structurally cannot have, so the plan cache was never written and every radius
was empty. `--from-context` cannot address this corpus at all. Each is fixed, each has a test
that fails on its recurrence, and each is written up with the stream that revealed it.

**Deployed.** [withkept.vercel.app](https://withkept.vercel.app), on Vercel, zero environment
variables. All nine routes answer, every one marked static, and `/` returns
`x-nextjs-prerender: 1` with no session cookie and no protection interstitial — so a reader
reaches every figure with no account. The front matter carries the URL and the suite asserts it:
the block that held the placeholder to being obviously a placeholder has gone quiet and the block
asserting a real public HTTPS URL runs in its place, which is the crossover it was written for.

**136 files, 2406 tests, all green.** 2401 pass and 5 are skipped, every skip conditional on the
deployment state described above rather than switched off. Nothing is red and nothing is pending:
the one `todo` that used to print the outstanding deploy edit in every run's summary is
discharged, which is why the total moved down by one rather than up.

**What is next** is not a list of regrets. Eleven items are specified, scoped and ordered in
[.kiro/specs/kept/tasks.md](.kiro/specs/kept/tasks.md), and the [Roadmap](#roadmap) below says
what each one does, how it works, and what it is blocked on.

---

## Roadmap

Everything here is **specified before it is built** — each item exists in
[`.kiro/specs/kept/tasks.md`](.kiro/specs/kept/tasks.md) with its requirement ids, its argv, its
acceptance criteria and, where the CLI surprised us, the measurement that corrected the plan. None
of it is a sketch, and two items are corrections to the plan rather than additions to it. Item 10 is
the one most people will care about: **a published `@kept/cli` and `@kept/core` are coming**, so
this runs against your repository rather than only against this one.

Build order is deliberate and is the reverse of the drop order: the two items that close gaps
against the original design come first, then the ones that need live Kane credits, then the local
developer surfaces, then packaging and polish.

### 1. The dual-axis coverage ribbon

**What it is.** A second coverage figure on `/coverage`, counting *acceptance criteria Kane holds
execution facts for* rather than *promises this repository verified*.

**How it works.** `EnrichmentProvider` switches to `cover gaps --json`, Assurance family, the
invoker appending `--mode agent`, on a 60-second budget. That invocation is already measured
working: exit 0, `done.status: complete`, and a payload carrying
`design_completeness {pct 100, acs_designed "6/6", usecases_complete "1/9"}` alongside
`proven {pct 100, acs_proven "6/6", failing 0, blocked 0, not_run 0}`, with its own configuration
naming the source as `graph_execution_facts` and the denominator as `current_live_acs`. The
projection is tolerant the way the existing coverage payload is — percentages and `n/m` ratio
strings kept verbatim, one row per use-case carrying `{id, title, risk, design_completeness,
proven, stale_acs, pending[]}` — and the axes are recorded into the snapshot so the shareable page
renders them with Kane invoked zero times.

**The correction behind it.** This was originally marked droppable because "`cover --json`
already supplies both axes". That is false on this repository: `cover` reads its depth axis out of
a sealed pack and refuses at exit 2 with `carries no coverage/usecases.yaml`, because every pack
here is a **replay** pack and only authoring mints a coverage document. `cover gaps` answers both
axes from the live graph instead, and is the only working path to the number.

**Two constraints that are not negotiable.** `pending[].ready_command` is a literal `kane-cli …`
string and is published as **text only** — rendering it as a control would hand the read-only
Ledger a way to spend credits. And the two proven figures get different labels, because they count
different objects over different denominators and will legitimately disagree; a page that lets that
read as a bug is worse than a page with one figure.

**What makes it done rather than drawn.** The `gaps` stream is committed as a parser fixture so
the ribbon renders in CI with no Kane and no store, and the degradation paths are asserted with
the same weight as the success path: a stream that refuses, one that pauses at exit 3, one
truncated before `done`, and one whose payload projects zero rows must each leave the graph
degraded with a named reason and the ribbon **withheld** — never a zero, never an empty ribbon
that reads as "nothing owed". A property test holds that for *any* payload both percentages are
either withheld or in range with a denominator matching the live acceptance-criteria count.

**And it will publish a number that looks bad.** `usecases_complete` reads `1/9` today: the graph
genuinely owes eight use-case designs. The ribbon shows that as debt. Authoring eight use-cases to
make the figure look better is precisely the dishonesty this product exists to prevent.

### 2. The docs-triggered loop, recorded as one continuous cycle

**What it is.** One capture running from "the documentation now claims something untrue" through
to "an amendment is proposed and nothing was written". The machinery is built and a live
`maintain reconcile --plan` with a genuinely resolved source id is recorded, but as separate
fragments — which makes the more novel of the two triggers read as the thinner one.

**How it works.** Add a ninth claim to the fixture describing behaviour it does not implement. The
docs hook fires, `kept reconcile --changed` reports outstanding suite debt and the promise enters
as `undesigned`. Bind a designed test to it — the safe path is a hand-written `*_test.md` with an
`@verifies` tag and a `<!-- @covers -->` marker, authored like the other eight, one replay and no
assurance chain. `kept verify --changed` then fails that member, the router answers `docs-lie`,
the fence withholds any write path because the promise was never proven, `kept amend propose`
produces the amendment, and `/amendments` renders it.

**The step that matters most is the last one.** The ninth claim is **reverted**, so the fixture
returns to its committed content and its pinned sha256 still holds. The amendment survives as the
record; the lie does not survive in the tree. Committed alongside: the reconciliation stream, the
verification stream, both handoffs, the amendment JSON, the snapshot that renders it, and an
integration test asserting against those bytes that the branch was `docs-lie`, that
`allowedPaths` was empty, and that no file outside `.kept/` was written.

**Cost.** Live Kane, a local Chrome, and credits on the one failing member.

### 3. `maintain evolve` on the argv 0.8.4 actually accepts

**The specified argv cannot work**, and this is a measurement rather than a bug report.
`maintain evolve --help` lists exactly two options, `--from-stale` and `--because`. `--mode agent`
is rejected with `unknown option '--mode'` — while `maintain reconcile --help`, from the same
command group, does list `--mode`. So the `test-drift` branch has never once reached Kane: it
takes its documented degradation path on every invocation and stages a failure-context card.

**How it gets fixed.** Correct the argv to `maintain evolve <ref>` with no ask-policy flag. Then
establish the NDJSON enabler with **one** probe before spending anything, because this command is
absent from the family contract table — piped stdout may be the enabler the way it is for
`testrun run`, or the command may emit nothing machine-readable at all. On success the Review_Card
is built from the **pair diff** the invocation reports, with the existing failure-context card
kept as the fallback for a stream that never reaches `done`.

**The care this one needs.** The invocation **mutates the assurance graph** — it supersedes a
use-case's scenario and test pairs. So it is rehearsed against a fresh target with
`--because <reason>` first, with the graph state recorded either side, before it is ever pointed at
a stale one.

### 4. `kept doctor`

**What it is.** The command a judge runs when something looks wrong. Today `node bin/kept doctor`
prints that it is specified and unwired, and `main.ts`'s switch carries only `amend`, `build`,
`evolve`, `reconcile`, `snapshot` and `verify`.

**How it works.** A `kane-cli --version` probe on a 10-second budget through
`KaneInvoker.invokePlain` — family-less, no enabler, the same door `context list` uses — reporting
binary presence, resolved path and version. Then everything else a clone needs that KEPT can check
without spending: whether `.kept/config.json` parses and which router it selects, whether the
committed snapshot exists and validates against its schema, whether the fixture answers on 3100,
and whether `.context/` is present.

**The one rule.** It exits zero in every case, including a missing binary. Kane's absence is a
supported state, and `doctor` of all commands must not be the one that treats it as fatal.

### 5. A dev-only live NDJSON pane

**What it is.** `LiveNdjsonPane` renders Kane's own stream as it arrives, fed by the invoker's line
callback, so a developer watching a run sees the events rather than the summary.

**How it works, and what it must prove.** Dev-only and **genuinely absent from the production
build** — not hidden by CSS, not gated at runtime, not in the bundle. Its absence is asserted
against the built output rather than trusted to a flag. Because it renders Kane's own stream it has
to display an event it does not recognise instead of dropping it, and it must not be the thing that
makes a dev page hang on a two-hundred-line-per-member `[member]` capture.

### 6. `kept watch` — a loopback accept path that adds no route

**What it is.** Accepting an amendment from the local Ledger UI without giving the Ledger a way to
write anything.

**How it works.** A `127.0.0.1:3199` listener living **in the CLI, outside the Next app**,
dev-gated behind `NEXT_PUBLIC_KEPT_LOCAL=1`, performing the same `kept amend accept` path the CLI
already does. That placement is the whole architectural point: the read-only scan over
`apps/ledger/**` still passes unchanged because no route was added to the Ledger's tree.

**Fences.** Loopback only, never `0.0.0.0`. It accepts an amendment id and nothing that could name
a path. Every method but the one it needs is refused. And the deployed Ledger stays byte-identical
with and without the feature — asserted by checking the production build contains no reference to
port 3199.

### 7. Proving the evidence lane renders

**Already built, never verified end to end.** The graph's fourth lane has existed since the layout
was written — `LANES` carries `evidence`, `LANE_X` has four entries, `layoutSnapshot` emits a node
per pack, and `PromiseGraph.tsx` renders `case 'evidence'`. It was invisible only because
`snapshot.evidence` was empty until curation was fixed. The committed snapshot now declares a pack
with 37 artefacts and two resolving edges.

**What gets added.** The render assertion that was impossible before: one lane-3 node per declared
pack, an `evidence` edge reaching it from each promise that names it, the node keyboard-reachable
with an accessible name, and — the case that matters — a snapshot declaring no pack painting no
lane-3 node and no empty lane. Plus confirmation that the six edges the snapshot still drops stay
dropped and diagnosed: they name a stale conflict-copy id from an older run, and an edge to
nothing is worse than an absent edge.

### 8. A badge worth putting in a README

34 lines today, flat two-tone. Shields-style treatment keeping three contracts intact: the value
stays a whole-number percentage, the response stays `image/svg+xml`, and the route stays GET-only.

**The palette scan is the constraint that bites** — no gradient, no colour outside the token set,
and the read-only scan still has to pass over the route — so the work is geometry, weight and
spacing rather than new colour. And because `provenCoverage` is `null` on the committed snapshot,
the `n/a` state is the one a judge sees first and has to look deliberate rather than broken.

### 9. Optional Shiki for diffs

**This one has a conflict to resolve before any code.** The runtime dependency budget is **nine**
packages and a test asserts it. Shiki makes ten. So the decision gets recorded first: either the
budget moves to ten with the design section and the asserting test updated in the same commit and
a stated reason, or Shiki loads as an optional peer that `lib/diff.ts` falls back from when it is
absent. The second keeps the budget honest and is the stated intent.

**The payoff is small and saying so is the point.** A `docs-lie` diff is a single line of English
prose, where highlighting adds nothing a reader notices. `lib/diff.ts` stays the default renderer
either way.

### 10. Shipping it: `@kept/cli` and `@kept/core` on npm

**Coming soon — a published CLI and library, so KEPT runs against your repository rather
than only against this one.**

The plumbing is already in place. `packages/kept-cli/package.json` declares its binary
(`"bin": { "kept": "dist/index.js" }`) and its published surface (`"files": ["dist"]`), and
`@kept/core` exports one barrel that is the only consumer entry point. What stands between
that and an install is deliberate rather than difficult: both packages are `private: true`
at version `0.0.0`, the `@kept` scope is unclaimed, `@kept/cli` depends on `@kept/core` by
exact version through the workspace rather than by a semver range, and `dist/` is gitignored
so publishing needs a `prepublishOnly` build step. The `bin/kept` launcher at the repository
root is a development convenience that reports honestly when `dist/` is absent; a published
install puts `kept` on `PATH` and does not use it.

The intended shape:

```bash
npm i -D @kept/cli
npx kept build          # scan @verifies tags, admit citations, build the graph
npx kept verify --all   # replay through Kane, route every failure
npx kept snapshot       # write the JSON a Ledger renders
```

**You bring your own Kane.** KEPT never bundles, installs or vendors `kane-cli` — it spawns
whatever is on `PATH` and parses the NDJSON, and a missing binary is a supported state that
exits zero. So an adopter needs Kane installed, a local Chrome, and their own credentials.

**What honestly is not ready, and saying so is the point.** Publishing the CLI is the easy
half. Three things have to land before someone can point this at their own repository on a
Tuesday afternoon: a `kept init` that scaffolds the `*_test.md` corpus and
`.kept/config.json` instead of expecting them to exist, the Ledger shipped as something
installable rather than a directory in this repository, and the second target below — which
is what would prove none of this is fixture-specific. Until those exist the accurate claim
is "the engine works and the packaging does not", which is the claim this section makes.

### 11. A second target, to prove none of this is fixture-specific

Point `kept build` at [RealWorld/Conduit](https://github.com/gothinkster/realworld)'s README,
produce a promise graph and a coverage figure, and stop.

**Scoped as read-only proof, and last for a reason.** It needs a backend and a database, which is
exactly the scope the fixture decision cut on purpose. Its value is proving KEPT is not
fixture-specific; its cost is a second application to keep running, a second document to keep
honest, and a second corpus to author with live credits. The closed loop is explicitly not
attempted against it, and the standing instruction is to abandon it rather than regress anything
that already works.

---

Licensed under the MIT terms recorded in [LICENSE](LICENSE).
