<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="Assets/kept-logo-dark.png"><img src="Assets/kept-logo-light.png" alt="KEPT" width="440"></picture></p>
<p align="center"><strong>Every promise your product makes, and continuous proof it's still kept.</strong></p>
<p align="center"><img src="https://img.shields.io/badge/npm-%40corgod%2Fkept--cli%200.1.1-CB3837" alt="@corgod/kept-cli 0.1.1 on npm"> <img src="https://img.shields.io/badge/npm-kept--core%200.1.1-CB3837" alt="kept-core 0.1.1 on npm"> <img src="https://img.shields.io/badge/license-MIT-111111" alt="MIT licensed"> <img src="https://img.shields.io/badge/typescript-5.9-111111" alt="TypeScript 5.9"> <img src="https://img.shields.io/badge/node-20.19%2B-111111" alt="Node 20.19 or newer"> <img src="https://img.shields.io/badge/kane--cli-0.8.4-111111" alt="Kane CLI 0.8.4"> <img src="https://img.shields.io/badge/runtime%20deps-9-111111" alt="Nine runtime dependencies"> <img src="https://img.shields.io/badge/properties-37%20verified-111111" alt="37 correctness properties"> <img src="https://img.shields.io/badge/tests-3032-111111" alt="3032 tests"></p>
<p align="center"><a href="#start-here">Start here</a> · <a href="#use-it-on-your-own-repository">Use it on your repo</a> · <a href="#the-short-version">The short version</a> · <a href="#run-it-yourself">Run it yourself</a> · <a href="#the-idea">The idea</a> · <a href="#architecture">Architecture</a> · <a href="#the-three-contract-kane-model">Kane model</a> · <a href="#three-way-repair">Three-way repair</a> · <a href="#verification">Verification</a> · <a href="#status">Status</a></p>

---

> Every claim a product makes about itself is an untested promise. KEPT graphs them all, each cited to the file and line that
> states it; a citation that does not resolve never enters it. Each binds to a Kane test: saving code re-verifies the blast
> radius, saving documentation reconciles what the suite owes. When a promise goes red, Kane's verdict picks one of three
> repairs: patch the code, evolve the test, or amend the documentation because the claim was never true. A deployed read-only
> ledger publishes every verdict, coverage and evidence. Kane reads the test as the specification, so it cannot separate a
> regression from a lie. KEPT can: you cannot break what was never proven to work.

## Start here

- **Live Ledger** — [withkept.vercel.app](https://withkept.vercel.app)
- **On your own repo:** `npm i -g @corgod/kept-cli`, then [three steps below](#use-it-on-your-own-repository)
- **Or run this demo:** `npm run demo`, then open `http://localhost:3000`

`npm run demo` is the whole judge path. It boots the Ledger and the fixture application from
a snapshot committed in this repository: **Kane is invoked zero times, zero credits are spent,
no credential is read and nothing beyond localhost is reached.** Measured worst case from the
command to the rendered landing view is **3.6 s** for the Ledger and 4.6 s for the fixture,
with warm reloads around 38 ms. Figures, method and the one 383 s cold outlier are in
[docs/judge-path.md](docs/judge-path.md).

The live Kane loop is a separate command with prerequisites, [documented below](#the-live-loop).
You do not need it, or an account, to see everything the Ledger shows. **Nor to try KEPT on your own code:** [kept-try.vercel.app](https://kept-try.vercel.app) reads any public GitHub repository, runs KEPT's real admission gate over its documents, and lists the claims they state with each cited to a file and a line. It stops there, because no run happened, so nothing it shows carries a verdict.

**Demo video:** [youtu.be/i3Ut0GrJ8xs](https://youtu.be/i3Ut0GrJ8xs), which walks the deployed
Ledger, a code-break repair, an accepted documentation amendment, and the paste-your-repo page.

**On npm:** [`@corgod/kept-cli`](https://www.npmjs.com/package/@corgod/kept-cli) is the `kept`
command and the one to install. [`kept-core`](https://www.npmjs.com/package/kept-core) is the
library underneath it. Both `0.1.1`, MIT.

---

## Use it on your own repository

KEPT is not specific to the application in this repository. It is published, and it runs
against any codebase that writes down what it does.

```bash
npm install -g @corgod/kept-cli     # https://www.npmjs.com/package/@corgod/kept-cli
cd your-project
kept init                           # writes .kept/config.json and one example test
kept doctor                         # seven checks, each with its own remedy
kept build                          # read your claims, cite them, bind the tests
```

`kept init` invokes Kane **zero times** and spends nothing. Point `subject.docs` at whatever
states your claims, a README, a `PROMISES.md`, a docs folder, and add a `@verifies` tag naming
the file and line:

```markdown
<!-- @verifies docs/CLAIMS.md:3 the running-total claim -->
<!-- @covers src/basket.js -->
```

`kept build` then reads that line off disk **verbatim**, and a citation that does not resolve
never enters the graph. There is no second code path for this repository's own claims: the
promise record for a claim of yours is identical to one of ours, field for field, except the
citation path, and a property test quantifies over generated repositories to keep it that way.

**Verified rather than asserted.** Both packages were installed from the registry into a
throwaway project with no relationship to this one, and driven: `kept init` scaffolded,
`kept build` admitted that project's own claims, and `kept snapshot` wrote a ledger.

### Bring your own Kane credentials

**KEPT ships no keys, stores no keys and reads none of yours.** It never bundles or vendors
`kane-cli`; it spawns whatever is on your `PATH` and parses the NDJSON that binary writes.
Authentication, billing and credits are between you and Kane, and **Kane is what bills**.
Nothing you install from npm here can spend anything.

```bash
npm install -g kane-cli    # however Kane distributes it for you
kane-cli login             # your account, your credits
kept doctor                # check 1 names the resolved binary and its version
```

**Kane is what earns a verdict, and nothing else here can.** So the split is deliberate:

| Command | Without Kane authenticated |
|---|---|
| `kept init`, `kept doctor` | work fully, zero invocations, zero credits |
| `kept build`, `kept snapshot` | work: your claims are cited and bound. Coverage is **withheld**, never reported as zero |
| `kept verify` | needs Kane. This is what earns verdicts and spends credits |
| `kept reconcile`, `kept evolve` | need Kane |

A graph with no verdicts still tells you what you have promised and what you owe. It just
refuses to claim anything was proven. Authenticating Kane is what turns the owed column into
an earned one.

### What the two packages are

| Package | What it is |
|---|---|
| [`@corgod/kept-cli`](https://www.npmjs.com/package/@corgod/kept-cli) | The `kept` command. Install this one. |
| [`kept-core`](https://www.npmjs.com/package/kept-core) | The library: promise model, citation rules, the Kane NDJSON parser and its three completion contracts, the verdict router, the blast radius, the write guard, the snapshot schema. Install directly only to build your own tooling on the same model. |

Both are `0.1.1`, MIT, and ship `dist` plus a README and nothing else. The command is `kept`
either way.

---

## The short version

Every claim a product makes about itself is an untested promise. KEPT builds a graph of those
claims, cites each one to the file and line that states it, binds each to a Kane CLI test, and
publishes the result in a read-only ledger.

The graph holds **thirteen promises**: eight from Kepler Coffee, the coffee shop in this
repository that is the application under verification, and five claims this README makes about
KEPT, cited to its own lines. Eight are proven, four are stale, and one is red: it was never true.

What Kane CLI does here: it designs the browser flows, drives real Chrome, and returns the
verdict. Every test identifier comes from Kane's own test plan, coverage comes from Kane's
coverage report, and evidence packs are matched back to their run by id.

Three different completion contracts are handled separately, because reading a paused run as a
failed one would corrupt the ledger. Authoring a test measured about 10.35 credits; every
re-verification after that is a cached replay and costs nothing.

Proven coverage reads **0.615**, eight of thirteen, and the ledger publishes it. A ledger that
shows what it owes is the product; when Kane cannot be reached it withholds the figure instead.

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

Thirteen promises, eight proven, one red, four stale. The red one is a claim that was never
true, and it is supposed to be red: that is the demonstration, not a bug.

### Level 2 — check our claims, still no account (about 36 seconds)

```bash
npm test              # 168 files, 3032 tests, about 46 s
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
| `Cannot find module 'kept-core'` | `packages/*/dist` is not in git | `npx tsc -b` |
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
| **Proof** | 37 correctness properties, a recorded closed loop in both directions, and a committed snapshot a reviewer re-derives every figure from with no credentials |

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
- [What is not here, and why](#what-is-not-here-and-why)

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

[![Two Kiro hooks turn a file save into a CLI run. bin/kept dispatches to kept-cli, which calls
kept-core: the Kane contract layer, the promise model, the providers, the verdict routers, the
blast radius and the single write guard. kept-core spawns kane-cli 0.8.4 with stdout piped and
reads its NDJSON. State lands under .kept/, and the committed ledger.snapshot.json is the only
seam between the CLI and the two apps the demo boots: the Ledger on 3000 and the fixture on
3100. A third, apps/try, deploys separately and reads no snapshot, running the same admission
gate on a pasted repository; it holds the one POST handler the Ledger forbids.](Assets/kept-architecture.svg)](Assets/kept-architecture.svg)

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

- **Proven coverage** counts *promises this repository verified*: eight of thirteen, published as
  **0.615**. It is `null` when the total is zero and `null` when the graph is degraded, because
  degraded means the enrichment axis was discarded and a number would claim knowledge KEPT does
  not have. The Ledger then shows a `baseline data only` chip rather than a zero, because the
  honest failure mode is "we are not claiming proof right now", never "proof is 0%".
- **The proven axis** counts *acceptance criteria Kane's graph holds execution facts for*, six of
  six, read verbatim from `cover gaps`, whose own configuration names its source as
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

`bin/kept` → `packages/kept-cli`. Hand-rolled argv parsing, no parser dependency. Ten commands,
all of them implemented, every one exiting **0** except on mutually exclusive flags.

| Command | Kane invocation | Family | Budget | Writes |
|---|---|---|---|---|
| `kept init [--force]` | none | n/a | n/a | `.kept/config.json`, one designed test |
| `kept doctor` | `--version`, one probe | family-less | 10 s | nothing |
| `kept build` | `cover gaps --json --mode agent` | Assurance | 60 s | state, snapshot |
| `kept verify --changed <p…>` | `testrun run --dry-run` if the plan is stale, then `testrun run <paths> --on-failure continue --bug-detection continue` | ExecutionTestrun | 300 s | state, handoff, snapshot |
| `kept verify --all` | the same, over every plan member carrying an identifier | ExecutionTestrun | 900 s | state, handoff, snapshot |
| `kept reconcile --changed <p…>` | `maintain reconcile --from <doc> --source-id <resolved> --plan --mode agent` | Assurance | 300 s | state, source cache, review cards, handoff, snapshot |
| `kept reconcile apply [plan]` | `maintain reconcile --apply [plan] --mode agent` | Assurance | 300 s | state, review cards, handoff, snapshot |
| `kept evolve <ref>` | `maintain evolve <ref>` | Assurance | 300 s | review cards, handoff |
| `kept amend propose --run <id> --text '<sentence>'` | none | n/a | n/a | amendments, snapshot |
| `kept amend list \| show \| accept \| reject` | none; `accept` triggers a rebuild | n/a | n/a | the cited document on accept, amendments, snapshot |
| `kept handoff [--run <id>]` | none | n/a | n/a | nothing: it reads out the last handoff |
| `kept watch` | none | n/a | n/a | whatever `kept amend accept` writes |
| `kept snapshot` | none | n/a | n/a | snapshot only |

Common flags: `--repo <root>`, `--json`, `--router <name>`, `--member-debug`.

Three refusals are worth stating, because a plausible-looking invocation is rejected:

- **`kept reconcile` never invents a source id.** `maintain reconcile` requires both `--from` and
  `--source-id`, and the id is resolved at run time against the live store through a five-rung
  ladder. An unresolved source is a **structural** no-op: no spawn, no credits, no review card, no
  verdict movement, `degraded` still false, exit 0. Two candidates tying at one rung is `ambiguous`.
- **`kept reconcile apply` is human-only** and absent from both hooks: it walks a stored plan and
  mutates the suite, which is not a decision a save hook may take.
- **`--plan` with `--apply` is the one non-zero exit in the product.** One stages and the other
  walks what was staged, so the parser rejects the pair before anything spawns.

---

## The Ledger

`apps/ledger` is a read-only projection over the committed snapshot. Six routes a reader visits,
every one statically rendered:

| Route | Contents |
|---|---|
| `/` | The promise graph, the metric rail, the freshness chip, and a promise panel |
| `/coverage` | The shareable public page: the dual-axis ribbon, freshness, every promise with its verdict |
| `/amendments` | Pending `docs-lie` diffs with an accept control |
| `/reviews` | Held review cards, each with its promise id, branch and evidence reference |
| `/runs` | The terminal-event log: family, command, status, result code, credits, exit meaning |
| `/badge.svg` | GET only, `image/svg+xml`, proven coverage as a whole-number percentage |

The build reports nine, because Next's own 404 and the two icon routes prerender alongside them.
All nine are marked static in the build output and on the live deployment, where `/` answers with
`x-nextjs-prerender: 1`: the host stating the page was built before the request rather than for it.

There is no `POST`, `PUT`, `PATCH` or `DELETE` handler, no server action, no `middleware.ts`, no
`child_process` import and no authentication. `scripts/check-readonly.mjs` asserts all of that by
scanning the app, and it runs in the test suite as well as in the build script.

**`/coverage` carries a dual-axis ribbon,** because the two axes count different objects and will
legitimately disagree. Design reads **6 of 6** acceptance criteria designed and **1 of 9** use
cases carrying scenarios. Proof reads **6 of 6** acceptance criteria Kane holds execution facts
for. Nine per-use-case rows sit underneath, each with its risk, its stale count and its pending
work, and each pending row names a `kane-cli` command as **text only**: a control there would hand
the read-only Ledger a way to spend credits. `1 of 9` is debt the graph genuinely owes and it is
published as debt, because authoring eight use cases to make the figure look better is precisely
the dishonesty this product exists to prevent.

The accept control is where two requirements meet: one wants an accept control in the Ledger, the
other forbids any route that mutates persisted data. Both hold because the write stays in the CLI.
The control is a real, keyboard-focusable button that copies `kept amend accept <id>` to the
clipboard and reveals the command inline. For a one-click accept in local development, `kept watch`
listens on `127.0.0.1:3199` from **inside the CLI, outside the Next app**: loopback only, one
amendment id and nothing that could name a path, every other method refused. The read-only scan
over `apps/ledger/**` therefore passes unchanged, and the production bundle names no such port.

`LiveNdjsonPane` renders Kane's own stream as it arrives during local development, showing an event
it does not recognise rather than dropping it, and bounding a two-hundred-line member capture
rather than hanging on it. It is absent from the production build at its cause: no page, layout,
route or sibling component names it, and a test asserts that instead of trusting a flag.

**Craft is scored, so it is specified rather than improvised.** A warm desaturated ink palette with
saturated colour reserved entirely for verdict communication; one implied light source driving a
three-class elevation system; monospace as texture for identifiers and citations rather than as a
default; and five motion orchestrations behind a single gate. Under `prefers-reduced-motion:
reduce` every orchestration resolves to its end state synchronously on first paint, and a test
renders the page under both media states and compares the computed style of every animated
property. Three further tests hold the palette itself: measured contrast over the whole ink ramp,
parity between the CSS custom properties and their typed mirror, and a scan that fails on
`backdrop-filter`, on any hex above 70% saturation, on a shadow whose colour is not a token, and on
an emoji.

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
packages/kept-cli/          the command surface, config resolution, ten commands
apps/fixture/               Kepler Coffee: seven screens, eight claims, port 3100
apps/ledger/                the read-only projection: six visitable routes, port 3000
apps/try/                   the admission half on the web: paste a public repository and
                            see the claims its documentation makes. Separate deployment,
                            because it holds the POST handler the Ledger promises not to
tests/                      eleven *_test.md documents: the eight designed corpus, plus
                            three that cite this README
tests/output-*/             committed Kane recordings, so replay authors nothing
docs/kane/                  every measured Kane fact, with the stream behind it
.kiro/hooks/                the two hooks
.kiro/specs/kept/           requirements, design, tasks
Assets/                     the two logo plates, the mark, and five SVG diagrams
tools/logo/                 build_logo.sh: the light and dark plates, in ImageMagick
tools/diagrams/             the SVG emitter, one generator per diagram, and the verifier
scripts/                    the demo launcher and the read-only checker
```

---

## Verification

```text
npm test          # vitest --run, never watch
npm run check     # the read-only scan, tsc -b, both app type-checks, then the suite
```

**168 files, 3032 tests, about 46 seconds** on a bare checkout. 3026 pass and 6 are skipped, each
skip conditional on a repository state rather than switched off. Four are the assertions that held
the README to carrying a placeholder instead of a deployed URL, and the deployment happened, so the
opposite assertions run in their place. The other two read a real Kane evidence archive when the
machine has one, so they run on a machine that has driven Kane and skip on a clone that has not.
That is why a working copy here reports 3028 and 4: the figures above are a judge's, measured on a
fresh clone, and the two counts differ by exactly those two tests. Nothing is red and nothing is
pending. No Kane, no credentials, no network: every Kane behaviour under test comes from a
committed fixture.

One measurement note, because it cost an hour to work out. On a checkout whose `node_modules` is
still dataless under iCloud sync, the first run can stall past four minutes and be killed by the
pool's worker timeout, which looks exactly like a hang. `node -e "import('jsdom')"` warms the cache
and the suite then runs in the time above. The `vitest.config.ts` comment records it.

**All 37 of the design's correctness properties** are implemented, each as a `fast-check` property
with a minimum of 100 generated cases and its design property named in the test title. They assert
the things a demonstration cannot show: that a promise identifier survives its claim moving to a
different line, that no promise enters the graph without a resolvable citation, that a snapshot
round-trips to byte-identical output, that both routers agree for a `result_code` of `"740"` and
`740`, that exit-code interpretation is total and family-correct, that verdicts and freshness move
only on a proven outcome, that every promise outside the blast radius is byte-identical afterwards,
that a `code-break` fence can never reach the document stating the claim, that the engine builds a
graph in any host repository, that a packed tarball is installable on its own, and that the
reduced-motion render and the post-animation render are the same DOM.

Six of the tests are source scans rather than behaviour tests, because the thing being protected is
a structural property no example could pin:

| Scan | Fails on |
|---|---|
| `no-raw-result-code` | any `result_code` comparison outside `coerce.ts` |
| `read-only-scan` | a non-GET handler, an auth check or a `child_process` import under `apps/ledger` |
| `router-isolation` | a concrete verdict router imported from outside `src/verdict/` |
| `animejs-import-scan` | a default import, a deep path, or `animejs` reached from outside the motion gate |
| `typography-discipline` | monospace on a run of prose rather than on an identifier |
| `forbidden-palette` | `backdrop-filter`, over-saturated hex, an untokenised shadow, an emoji |

Beside them sit the regressions that pin real recorded bytes: the twelve-line smoke run parsed with
zero diagnostics, the two-line `cover` refusal envelope, the per-command argv contract, the
source-resolution ladder with zero spawns on every failure rung, and the committed evidence's
referential integrity, stated against git's own index rather than against the filesystem.

---

## Deployment

Two Vercel projects from this one repository, both with **zero environment variables**.

| Deployment | What | Why separate |
|---|---|---|
| [withkept.vercel.app](https://withkept.vercel.app) | the Ledger, nine static routes | it promises no non-GET handler |
| [kept-try.vercel.app](https://kept-try.vercel.app) | paste a repository, see its claims | it needs one |

The split is the point rather than an accident of tooling. The Ledger states in this README, on a
line cited by a promise in KEPT's own graph and enforced by `scripts/check-readonly.mjs` over eleven
rules, that the deployed artefact holds no non-GET handler. The try page needs a `POST`. Adding it to
the Ledger would break a proven promise, so it got its own directory, its own build and its own
project: `apps/try`, Root Directory `apps/try`, configured by `apps/try/vercel.json`. Two deployments
is the cost of not weakening a claim to fit a feature. The settings are in
[docs/deploy-try.md](docs/deploy-try.md).

The try page invokes Kane **zero times** and holds no GitHub token, so it spends nobody's credits
and has nothing to leak. It reads markdown over HTTP inside a 25 second budget with bounded retries,
and every promise it returns is `undesigned`, because no run produced a verdict and inventing one is
the overstatement this project exists to refuse.

There is no API to key, no database to address and no Kane to authenticate: the Ledger's build reads
a committed file.

Two things about the shape look wrong and are load-bearing, both explained in
[docs/deploy-ledger.md](docs/deploy-ledger.md):

- **`apps/ledger` has no `package.json`**, so the project root is the monorepo root and the app is
  named as an argument to the build command instead of by the root setting. Pointing Vercel at
  `apps/ledger` reports "No Next.js version detected" and no other setting rescues it.
- **The build command builds `kept-core` first.** `packages/*/dist` is gitignored, so a fresh clone
  resolves `kept-core` to a package whose entry point does not exist. `npm ci` still creates the
  symlink, which is what makes the failure read as a broken import rather than a missing artefact.
  `tsc -b packages/kept-core && next build apps/ledger` is the whole fix.

The deployed bundle carries no filesystem code either. `kept-core` declares `"sideEffects": false`
and the snapshot schema reads its vocabulary from a module that imports nothing, so the directory
walkers that resolve evidence packs locally are absent from the build rather than merely unused in
it. Verified by the build going from four `Dynamic filesystem access` warnings and a 52.6 MB trace
to zero warnings and 41.9 MB.

**Both packages are published**, [`kept-core`](https://www.npmjs.com/package/kept-core) and
[`@corgod/kept-cli`](https://www.npmjs.com/package/@corgod/kept-cli) at `0.1.1`, each with its own
README, and the published file list asserted against a real `npm pack` rather than against the
manifest that describes it. Verified by installing both from the registry into a project outside
this workspace and driving them there. The procedure, and why the CLI is scoped while the library is
not, are in [docs/publish.md](docs/publish.md).

Public source: <https://github.com/EmadQureshiKhi/Kept>

---

## Documentation

| Document | Covers |
|---|---|
| [docs/submission-summary.md](docs/submission-summary.md) | The project in 120 words or fewer, which is the count the suite holds it to |
| [docs/judge-path.md](docs/judge-path.md) | The measured time from `npm run demo` to the rendered landing view, and what it does not spend |
| [docs/self-verification.md](docs/self-verification.md) | The five claims this README makes that are in the graph, and what admitting them cost the coverage figure |
| [docs/deploy-ledger.md](docs/deploy-ledger.md) | Deploying with zero environment variables, and why the Vercel root is the monorepo root |
| [docs/publish.md](docs/publish.md) | Publishing both packages, and what the packed tarball is asserted to contain |
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

**Finished.** Every command the help text advertises works, every correctness property in the
design is implemented, the suite is green with nothing pending, and the Ledger is deployed. The
figures below are the ones a reader re-derives from the committed snapshot with no credentials.

| | |
|---|---|
| Promises in the graph | **13**: eight of the fixture, five of this README |
| Verdicts | 8 proven, 1 red on purpose, 4 stale |
| Proven coverage | **0.615**, published rather than withheld |
| Coverage ribbon | 6 of 6 acceptance criteria designed and proven, 1 of 9 use cases with scenarios |
| Suite | **168 files, 3032 tests**, 3026 passing on a fresh clone, 6 conditionally skipped, about 46 s |
| Correctness properties | 37 of 37 |
| Evidence packs | 1, holding 59 artefacts, referentially closed against git's index |
| Runtime dependencies | 9 |
| Commands | 10, all implemented |
| Deployment | two projects: the Ledger's nine static routes, and the try page's one route plus one handler. Zero environment variables on both |
| Published | [`kept-core`](https://www.npmjs.com/package/kept-core) and [`@corgod/kept-cli`](https://www.npmjs.com/package/@corgod/kept-cli), both `0.1.1` |

**Verified against a live Kane.** The verdict spike, recorded and committed, which chose the default
router. The authored corpus and its recordings, so replay is free. The full-suite replay: nine
members, eight passing from cache at 0.0000, one deliberate failure at 9.85. The closed code-break
loop, with both terminal events and the intervening patch committed. A live
`maintain reconcile --plan` with a genuinely resolved source id. The headless bootstrap, both
commands, with the two refusals a headless caller meets recorded verbatim.

**Deployed, twice.** [withkept.vercel.app](https://withkept.vercel.app), zero environment variables.
All nine routes answer, every one marked static, and `/` returns `x-nextjs-prerender: 1` with no
session cookie and no protection interstitial, so a reader reaches every figure with no account. And
[kept-try.vercel.app](https://kept-try.vercel.app), which runs the admission gate over any public
repository and is a separate project precisely because the Ledger's no-handler promise is one KEPT
verifies about itself.

**This README is itself under verification, and it cost the headline figure.** Five of its lines are
promises in the graph, cited to lines 22, 141, 162, 374 and 752 and read off disk verbatim by the same
admission gate that reads the fixture's. Nothing in a promise record distinguishes them from the
fixture's eight except the citation path. All five entered with nothing proving them yet, so proven
coverage fell from 88 percent to 54 percent, and the Ledger published the lower number with all five
rendered as `stale` beside their citations. Admitting only the claims that already pass would have
held the figure at 88, which is the failure mode of an untested README reproduced inside the tool
built to detect it, so a test pins the five lines and refuses a build that admits fewer.

**One of those five has since been paid off, which is the only way the figure is allowed to rise.**
Line 752 says `/badge.svg` answers a GET with SVG carrying a whole-number percentage. A test
document for it was authored against the running Ledger by a live Kane, at 14.60 credits, and it
passed on the first run. Replaying the whole recorded suite then moved that promise from `stale` to
`proven`, and coverage rose from 54 percent to 62 percent. The four remaining stale rows are still
on the page, still owed, and the badge the claim describes now renders a percentage the claim itself
helped earn. The full accounting is in
[docs/self-verification.md](docs/self-verification.md).

**What finding the hard faults cost is worth stating**, because component coverage could not have
found them. The sealed triage note was inside a zip nothing opened, so every failure reported the
note absent and answered `docs-lie`: a three-way branch that was a one-way branch and looked alive.
`application_issue` was missing from the product-fault list, so a deliberately broken subtotal
routed to `docs-lie` while Kane's note read `application_issue/ui_data_defect` at 0.96.
`context list` was declared an Assurance command, so the invoker appended a flag Kane rejects and
every documentation save resolved to `listing-unreadable`. A dry run was required to carry a
terminal event it structurally cannot have, so the plan cache was never written and every radius was
empty. And the packaging suite, on its first real run outside this workspace, found that
`kept-core` imported `yaml` and `zod` while declaring neither: inside the workspace both resolve
from the root `node_modules`, so every other suite was green while the published package would have
died on its first import. Each is fixed, each has a test that fails on its recurrence, and each is
written up with the stream that revealed it.

---

## What is not here, and why

Two things the plan named were deliberately not built, and both decisions cost something worth
recording. Everything else it named is built and described above.

**Syntax highlighting for amendment diffs was dropped to hold the dependency budget at nine.**
Shiki would have made ten runtime packages, and a test asserts the budget. A `docs-lie` diff is one
line of English prose, where highlighting adds nothing a reader notices, so `lib/diff.ts` stays the
only renderer. Moving the budget to ten and updating the asserting test in the same commit was the
alternative; a line of prose was not worth it.

**A second target application was withdrawn, and this repository's own README took its place.** The
plan reserved a second application to show the engine is not specific to the fixture. It needed a
backend, a database, a second process to keep running and a second corpus authored with live
credits. What replaced it needed one entry in `subject.docs` and one `@verifies` tag, and it makes
the stronger point: the document making the claims is the document being checked.

---

Licensed under the MIT terms recorded in [LICENSE](LICENSE).
