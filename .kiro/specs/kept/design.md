# Design Document

## Overview

KEPT is a promise-verification system built as an npm workspaces TypeScript monorepo. It extracts every claim a product makes about itself, cites each claim to a file and line, binds each claim to a Kane CLI test, and keeps the binding honest in both directions: code changes re-verify the promises in their blast radius, documentation changes reconcile what the suite now owes. When a promise goes red, Kane's own failure verdict selects one of three repairs — patch the code, evolve the test, or amend the documentation.

The design is shaped by four hard constraints, in this order of authority:

1. **One day of build time, solo.** Every construction below is chosen because it is provable and boring. No layout engines, no state managers, no ORM, no Docker, no browser-automation dependency of our own. Kane brings its own Chrome. Anything not required to score is marked droppable in [§18](#18-droppable-scope-in-priority-order).
2. **7 GB of free disk.** Zero-install-footprint decisions throughout: system font stack instead of downloaded fonts, a hand-rolled 60-line unified-diff renderer instead of Shiki by default, a hand-rolled deterministic lane layout instead of dagre, a node script instead of `concurrently`. Runtime dependency budget for the whole repo is **nine** packages ([§2.2](#22-dependency-budget)) — the ninth is `animejs`, admitted deliberately because the Craft dimension is scored and hand-rolled orchestration of staggered, sequenced, interruptible motion is not cheaper than ~10 KB.
3. **Three Kane contracts, not one.** A parser built on `run_end` alone would silently report nothing on both of the paths KEPT actually uses. The design makes it *structurally impossible* to parse a Kane stream without first declaring its command family ([§4](#4-the-three-contract-kane-model)).
4. **The Ledger must survive Kane's absence.** The deployed artefact is a read-only projection over a committed snapshot. It has no routes that mutate, no authentication, no credentials, and no knowledge that Kane exists ([§9](#9-ledger-snapshot-the-clui-contract)).

### The load-bearing idea

Everything KEPT does is a function from Kane's event stream to one JSON file, and everything a judge sees is a function from that JSON file to pixels. The seam is `ledger.snapshot.json`. Because the seam is a committed file with a validated schema, the 30-second judge path costs zero credentials and zero credits, the UI can be built before Kane's verdict spike concludes, and the pending empirical question about `result_code` 740 cannot invalidate any work above the `VerdictRouter` interface.

---

## Architecture

### 1.1 System shape

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Kiro IDE                                                                │
│    .kiro/hooks/kept-code-verify.json   (fileEdited: fixture source)      │
│    .kiro/hooks/kept-docs-reconcile.json(fileEdited: fixture docs)        │
└───────────────┬──────────────────────────────────────────▲───────────────┘
                │ askAgent: run CLI, then read handoff      │ patch source
                ▼                                           │ (code-break only)
┌──────────────────────────────────────────────────────────────────────────┐
│  bin/kept  →  packages/kept-cli                                          │
│    build · verify · reconcile · evolve · amend · snapshot · handoff       │
│                        · doctor · watch(dev)                             │
└───────────────┬──────────────────────────────────────────┬───────────────┘
                │                                           │
                ▼                                           ▼
┌───────────────────────────────────┐      ┌───────────────────────────────┐
│  packages/kept-core               │      │  .kept/  (working state)      │
│   KaneInvoker  ── CommandFamily   │      │   config.json  plan.json      │
│   resolveSourceId ── sources.json │      │   sources.json                │
│   NdjsonParser ── FamilyContract  │      │   state.json   handoff.json   │
│   coerce (result_code, credits)   │      │   handoff/<runId>.json        │
│   evidence resolver               │      │   review-cards/*.json         │
│   PromiseAdapter                  │      │   amendments/*.json           │
│     ├ BaselineProvider (infallible)│     │   diagnostics/*.json          │
│     └ EnrichmentProvider (cover)  │      └───────────────────────────────┘
│   mergeGraph → PromiseGraph       │
│   VerdictRouter (strategy)        │              ┌────────────────────────┐
│     ├ resultCode740               │  spawn ───▶ │  kane-cli 0.8.4        │
│     └ failureYamlTriage           │  ◀── NDJSON │  (+ its own Chrome)    │
│   snapshot writer (canonical)     │              └────────────────────────┘
└───────────────┬───────────────────┘
                │ writes
                ▼
   apps/ledger/data/ledger.snapshot.json   ← committed, schema-validated
   apps/ledger/public/evidence/**          ← committed curated packs
                │ imported at build time
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  apps/ledger (Next.js :3000 → Vercel)      apps/fixture (Next.js :3100)  │
│   /            graph hero + metrics         7 screens, no backend        │
│   /coverage    public shareable page        README with 8 one-line claims│
│   /amendments  docs-lie diffs               one breakable, one never-true│
│   /reviews     review cards                                              │
│   /runs        terminal-event log                                        │
│   /badge.svg   GET-only SVG                                              │
└──────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data flow, one pass

1. `kept build` runs `BaselineProvider` (filesystem only, cannot fail) and `EnrichmentProvider` (`kane-cli cover --json --mode agent`, Assurance family, 60 s budget).
2. Providers return `ProviderResult` values; `mergeGraph` unions them by promise id and sets `degraded` if enrichment did not deliver a clean `done`.
3. `kept verify --changed <paths>` maps changed paths → promises → designed test refs → **`test_id` values taken from `testrun_plan.members[]`** → `kane-cli testrun run --from-context <ids>` with stdout piped.
4. The parser consumes the stream under the `ExecutionTestrun` contract, requires `testrun_done`, maps each `testrun_member_end.status` to a verdict, and resolves the evidence pack from `<cwd>/.testmuai/evidence/`.
5. Failing members go through the `VerdictRouter`, which returns exactly one `RepairBranch` plus the evidence reference that justified it.
6. The CLI writes `.kept/state.json`, the machine-readable `.kept/handoff.json`, and the canonical `apps/ledger/data/ledger.snapshot.json`.
7. The hook's agent action reads `handoff.json`, and on `code-break` patches only paths inside `nextAction.allowedPaths`. Saving that patch re-fires the hook, closing the loop.

### 1.3 Invariants the architecture enforces

| Invariant | Enforced by |
|---|---|
| No stream is parsed without a declared family | `parseStream` takes a `FamilyContract<F>` as its first parameter; there is no other entry point |
| A terminal event can only be read after proving it exists | `ParsedStream<F>` is a discriminated union; `terminal` lives only on the `complete` arm |
| `result_code` is never compared raw | Single exported accessor `resultCode()`; a source-scan test forbids `result_code ===` outside `coerce.ts` |
| Verdicts never move on an unknown outcome | Every writer takes `StateWrite` which rejects any `exitMeaning` outside `success \| failure` |
| The deployed app cannot mutate or spend | Ledger has no non-GET handlers, no server actions, no `child_process` import; enforced by source-scan tests |
| Promise ids survive rebuilds | Id derives from citation *file* + normalised claim text only — never line number, never ordering |
| `maintain reconcile` is never spawned without a resolved source id | `resolveSourceId` returns a discriminated result; the `--source-id` argument can only be built from the `ok: true` arm, so an unresolved source is a no-op rather than an exit-2 spawn (§13.2.2) |
| No animation can bypass the reduced-motion path | `animejs` is importable only from `lib/motion.ts`; every orchestration goes through `play()`, which applies the end state synchronously when motion is off (§10.6.4); enforced by an import-location scan |

---

## Components and Interfaces

### 2.1 Module and file layout

Real paths, as they will exist. Each module below owns exactly one of the interfaces defined in the sections that follow.

```
KEPT/
├── package.json                       # workspaces root; scripts: demo, loop, build:snapshot, test
├── tsconfig.base.json
├── vitest.config.ts                   # single root config, projects: kept-core, kept-cli
├── .gitignore                         # excludes .context/ ; force-adds evidence + output-*
├── .kiro/
│   ├── hooks/
│   │   ├── kept-code-verify.json
│   │   └── kept-docs-reconcile.json
│   └── specs/kept/{requirements,design,tasks}.md
├── bin/
│   └── kept                           # #!/usr/bin/env node → ../packages/kept-cli/dist/index.js
├── scripts/
│   ├── demo.mjs                       # spawns both Next servers, zero deps
│   └── check-readonly.mjs             # asserts Ledger has no mutating handlers (CI + test)
├── packages/
│   ├── kept-core/
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts               # public surface; the only import path consumers use
│   │       ├── diagnostics.ts         # Diagnostic, DiagnosticSink
│   │       ├── kane/
│   │       │   ├── family.ts           # CommandFamily, FamilyContract, contractFor()
│   │       │   ├── events.ts           # KaneEvent + per-family terminal event types
│   │       │   ├── coerce.ts           # resultCode(), credits()  ← ONLY comparison site
│   │       │   ├── ndjson.ts           # parseStream(), ParsedStream
│   │       │   ├── exit.ts             # exitMeaning(family, code)
│   │       │   ├── evidence.ts         # resolveEvidenceDir(), listArtifacts()
│   │       │   ├── failureYaml.ts      # loadFailureYaml()
│   │       │   └── invoker.ts          # KaneInvoker, InvocationSpec, InvocationResult
│   │       ├── context/
│   │       │   └── sources.ts          # StoreSource, resolveSourceId(), SourceCache  ← §13.2.2
│   │       ├── model/
│   │       │   ├── promise.ts          # Promise, Citation, Verdict, PromiseGraph
│   │       │   ├── ids.ts              # promiseId(), amendmentId(), runId()
│   │       │   ├── metrics.ts          # computeMetrics()
│   │       │   ├── snapshot.ts         # LedgerSnapshot type + zod schema
│   │       │   └── canonical.ts        # serialiseSnapshot()/parseSnapshot() canonical form
│   │       ├── providers/
│   │       │   ├── adapter.ts          # PromiseAdapter, ProviderResult
│   │       │   ├── baseline.ts         # *_test.md @verifies scan
│   │       │   ├── enrichment.ts       # cover --json --mode agent
│   │       │   ├── coverage.ts         # tolerant projection of the coverage payload
│   │       │   └── merge.ts            # mergeGraph()
│   │       ├── verdict/
│   │       │   ├── router.ts           # VerdictRouter, FailureContext, selectRouter()
│   │       │   ├── resultCode740.ts
│   │       │   ├── failureYamlTriage.ts
│   │       │   └── memberStatus.ts     # memberStatusToVerdict()
│   │       ├── radius/
│   │       │   ├── plan.ts             # readPlan(), PlanCache
│   │       │   └── radius.ts           # computeBlastRadius()
│   │       ├── repair/
│   │       │   ├── reviewCard.ts
│   │       │   ├── docsAmendment.ts    # propose(), accept(), reject()
│   │       │   └── lineEdit.ts         # replaceLine() surgical writer
│   │       ├── handoff/handoff.ts      # HandoffFile type + writeHandoff()
│   │       └── state.ts               # StateStore: load/save .kept/state.json, StateWrite guard
│   ├── kept-cli/
│   │   ├── package.json               # bin: { "kept": "dist/index.js" }
│   │   └── src/
│   │       ├── index.ts               # arg parse (hand-rolled, no commander)
│   │       └── commands/{build,verify,reconcile,evolve,amend,snapshot,handoff,doctor,watch}.ts
│   └── kept-core/test/
│       ├── fixtures/*.ndjson          # includes a copy-reference to docs/kane/smoke-run.ndjson
│       ├── *.prop.test.ts             # fast-check property tests
│       └── *.test.ts                  # example + edge-case tests
├── apps/
│   ├── fixture/                       # see §12
│   │   ├── README.md                  # the promise source: 8 one-line claims
│   │   ├── app/{page,shop,product/[slug],cart,checkout,orders,settings}/…
│   │   ├── components/…
│   │   ├── lib/{catalog,cart,currency,storage}.ts
│   │   └── next.config.ts             # dev/start on 3100
│   └── ledger/                        # see §10
│       ├── data/ledger.snapshot.json  # COMMITTED contract artefact
│       ├── public/evidence/**         # COMMITTED curated packs
│       ├── app/
│       │   ├── layout.tsx  page.tsx
│       │   ├── coverage/page.tsx
│       │   ├── amendments/page.tsx
│       │   ├── reviews/page.tsx
│       │   ├── runs/page.tsx
│       │   └── badge.svg/route.ts     # GET only
│       ├── components/{PromiseGraph,PromiseNode,PromisePanel,MetricRail,
│       │               MetricFigure,FreshnessChip,VerdictTag,DiffView,
│       │               AcceptControl,ReviewCardList,LiveNdjsonPane}.tsx
│       ├── lib/{snapshot,tokens,motion,relativeTime,diff,layout}.ts
│       └── styles/{tokens.css,surfaces.css}     # tokens + the light/elevation ramp
├── tests/                             # Kane test-md corpus (the designed tests)
│   ├── shop_filter_test.md
│   ├── cart_subtotal_test.md
│   ├── checkout_validation_test.md
│   ├── orders_persist_test.md
│   ├── settings_currency_test.md
│   ├── home_cta_test.md
│   └── cart_discount_test.md          # the docs-lie test: asserts a claim that is never true
├── evidence/                          # raw sealed packs as produced (source of curation)
├── output-*/                          # committed Kane recordings → free replay
└── docs/kane/{command-surface.md,smoke-run.ndjson,verdict-spike.md}
```

### 2.2 Dependency budget

Runtime — **nine** packages: `next`, `react`, `react-dom`, `tailwindcss`, `@xyflow/react`, `zod`, `yaml`, `clsx`, and **`animejs`** pinned to **`4.5.0`**. Plus shadcn/ui **copied source** (not a dependency — the CLI vendors component files). Dev: `typescript`, `vitest`, `fast-check`, `@testing-library/react`, `jsdom`, `@types/*`.

**The ninth dependency, stated explicitly.** `animejs@4.5.0` is the animation engine for the Ledger ([§10.6](#106-motion-system--orchestrated-not-decorative)). It is the latest stable line; **v5 is beta and is not used**. It ships as an ES module with named exports, so only the functions actually imported are bundled — the design imports exactly `animate`, `createTimeline`, `stagger`, `svg`, `utils` and `eases`, which lands around 10 KB gzipped. Pinned exactly, not a caret range, so the deployed build is byte-reproducible:

```json
"dependencies": { "animejs": "4.5.0" }
```

```ts
// the only import shape permitted in apps/ledger — never `import anime from 'animejs'`
import { animate, createTimeline, stagger, svg, utils, eases } from 'animejs';
```

A source-scan test (sibling of `check-readonly.mjs`) fails the build on a default import, on a deep `animejs/lib/*` path, and on any `animejs` import outside `apps/ledger/lib/motion.ts` and `apps/ledger/components/**` — motion must be reachable through the single gate in §10.6.4 so the reduced-motion path cannot be bypassed.

Deliberately not installed: Shiki (replaced by `lib/diff.ts`, ~60 lines; Shiki is a droppable upgrade), dagre/elkjs (replaced by `lib/layout.ts` lane layout), commander/yargs (hand-rolled arg parse, ~40 lines), concurrently (`scripts/demo.mjs`), any font package (system stack), framer-motion / GSAP / lottie (anime.js covers the whole motion brief at a fraction of the weight, and Lottie would mean shipping JSON animation assets), any icon package (the few glyphs needed are inline SVG), Playwright/Puppeteer (Kane owns the browser), Docker.

---

## Data Models

The promise model here and the snapshot schema in §9 are the two data contracts of the system; everything else is a function between them.

### 3.1 Promise types

```ts
// packages/kept-core/src/model/promise.ts
export type Verdict = 'proven' | 'red' | 'undesigned' | 'stale';

export interface Citation {
  /** Repository-relative, POSIX separators, never absolute. */
  file: string;
  /** One-based. */
  line: number;
  /** Verbatim content of that line, as read from disk. */
  text: string;
}

export interface DesignedTest {
  /** Repository-relative path of the *_test.md that verifies the promise. */
  path: string;
  /** Kane assurance-graph id, e.g. "T-3". Null until a testrun_plan supplies it. */
  testId: string | null;
}

export interface RepairAnnotation {
  branch: RepairBranch;                 // 'code-break' | 'test-drift' | 'docs-lie'
  strategy: 'resultCode740' | 'failureYamlTriage';
  severity: string | null;
  category: string | null;
  confidence: number | null;
  evidenceRef: string | null;           // repo-relative path into a committed pack
  rationale: string;
}

export interface PromiseRecord {
  id: string;                           // "p_" + 12 hex
  claim: string;                        // normalised claim text
  citation: Citation;
  designedTest: DesignedTest | null;    // explicit null, never undefined
  verdict: Verdict;
  verdictSource: VerdictSource | null;
  repair: RepairAnnotation | null;
  evidencePackId: string | null;
  providers: Array<'baseline' | 'enrichment'>;
  credits: number | null;               // credits attributed to the newest run for this promise
}

export interface PromiseGraph {
  promises: PromiseRecord[];            // sorted by id, always
  edges: GraphEdge[];                   // sorted by (kind, from, to)
  degraded: boolean;
  degradedReasons: string[];
  diagnostics: Diagnostic[];
}

export interface GraphEdge {
  from: string;                         // node id
  to: string;
  kind: 'cites' | 'designed' | 'evidence';
}
```

Node ids in `edges` are prefixed by type so the Ledger can lane them without a lookup: `d_<hash>` document nodes, `p_<hash>` promises, `t_<hash>` designed tests, `ev_<stamp>` evidence packs.

### 3.2 Identifier derivation — the stability rule

```ts
// packages/kept-core/src/model/ids.ts
export function normaliseClaim(raw: string): string {
  return raw.replace(/^[\s>*\-+\d.)]+/, '')   // strip list markers / numbering
            .replace(/\s+/g, ' ')
            .trim();
}

export function promiseId(citationFile: string, rawClaim: string): string {
  const key = `${toPosix(citationFile)}\n${normaliseClaim(rawClaim)}`;
  return 'p_' + sha256Hex(key).slice(0, 12);
}
```

The line number is deliberately **not** in the key. Inserting a paragraph above a claim moves it down a line; the promise is the same promise and must keep its verdict, its evidence and its history. Changing the claim text, or moving the claim to a different file, is a different promise. This is exactly what R1.2 asks for and it is the first correctness property.

`sha256Hex` comes from `node:crypto`. Collision risk at 48 bits over a few dozen promises is not worth guarding; the merge path in §5.4 treats a collision as a same-promise merge, which is the safe direction.

### 3.3 Citation admission gate

`admitPromise` is the single funnel into the graph and applies both rejection rules:

```ts
type Admission =
  | { ok: true; promise: PromiseRecord }
  | { ok: false; reason: 'no-citation' | 'line-out-of-range' | 'file-missing'; diagnostic: Diagnostic };
```

- **No citation** → rejected, diagnostic names the supplying provider (R1.5).
- **`citation.line > lineCount(file)`** → rejected, diagnostic carries file, requested line and actual line count (R1.4).
- Cited file unreadable → rejected as `file-missing`, same shape.
- Otherwise `citation.text` is overwritten with the verbatim line read from disk, so the graph can never carry a citation text that disagrees with the file (R1.3).

Line splitting is `content.split('\n')`, one-based indexing, no trimming. A file ending with `\n` does not gain a phantom final line: the trailing empty element is dropped only when it is the last element and empty.

### 3.4 The `@verifies` tag grammar

A designed test declares which claims it verifies and which source it covers. Frontmatter plus tags:

```markdown
---
test_id: T-3
tags: [cart, subtotal]
covers:
  - apps/fixture/lib/cart.ts
  - apps/fixture/app/cart/**
---

# Cart subtotal updates on quantity change

<!-- @verifies apps/fixture/README.md:16 -->

1. Navigate to http://localhost:3100/shop
...
```

Grammar: `@verifies\s+(?<file>[^\s:]+):(?<line>\d+)` — anything after the line number on the same line is a free-text note and ignored. One tag per line; multiple tags per file are allowed and produce multiple promises.

`covers:` is authored beside the Kane test as part of the assurance artefacts. It is the *source-to-test* link and is intentionally not static analysis of source code. The *identifiers handed to Kane* never come from here — they come from `testrun_plan.members[].test_id` (§7). `test_id` in frontmatter is a cache only; the plan is authority.

---

## 4. The three-contract Kane model

This is the section to get right. Kane 0.8.4 has **three** terminal-event contracts, and both of the paths KEPT depends on (`testrun run` for verification, `cover` for the ledger) are the two that are *not* `run_end`.

### 4.1 The contract table, encoded once

```ts
// packages/kept-core/src/kane/family.ts
export type CommandFamily = 'ExecutionRun' | 'ExecutionTestrun' | 'Assurance';

export type TerminalType<F extends CommandFamily> =
  F extends 'ExecutionRun'      ? 'run_end'
  : F extends 'ExecutionTestrun' ? 'testrun_done'
  : 'done';

export type NdjsonEnabler = 'agent-flag' | 'piped-stdout' | 'mode-agent';

export interface FamilyContract<F extends CommandFamily> {
  readonly family: F;
  readonly terminalType: TerminalType<F>;
  readonly ndjson: NdjsonEnabler;
  /** What process exit code 3 means for this family. A14. */
  readonly exit3: 'timeout-or-cancelled' | 'paused-resumable';
  /** Where a sealed evidence pack for this family lives. */
  readonly evidence: 'session-dir' | 'cwd-testmuai' | 'none';
  readonly commands: readonly string[][];
}

const CONTRACTS = {
  ExecutionRun: {
    family: 'ExecutionRun', terminalType: 'run_end', ndjson: 'agent-flag',
    exit3: 'timeout-or-cancelled', evidence: 'session-dir',
    commands: [['run'], ['testmd', 'run']],
  },
  ExecutionTestrun: {
    family: 'ExecutionTestrun', terminalType: 'testrun_done', ndjson: 'piped-stdout',
    exit3: 'timeout-or-cancelled', evidence: 'cwd-testmuai',
    commands: [['testrun', 'run']],
  },
  Assurance: {
    family: 'Assurance', terminalType: 'done', ndjson: 'mode-agent',
    exit3: 'paused-resumable', evidence: 'none',
    commands: [['context','extract'], ['design','tests'], ['maintain','reconcile'],
               ['maintain','evolve'], ['cover'], ['cover','gaps']],
  },
} as const;

export function contractFor<F extends CommandFamily>(family: F): FamilyContract<F>;
/** Reverse lookup used by the invoker to reject a family/argv mismatch. */
export function familyForArgv(argv: string[]): CommandFamily | null;
```

`maintain evolve` is placed in `Assurance` on the strength of A10's grouping plus R7.2's explicit `--mode agent` requirement. The invoker probes `kane-cli maintain evolve --help` once per process and caches the result; if `--mode agent` is not accepted, the invocation is skipped, a `test-drift` Review_Card is created from the failure context alone, and a diagnostic records the flag mismatch. This is the documented degradation, not a build blocker.

### 4.2 Making family declaration structurally mandatory

The only exported parse entry point takes a contract as its first argument:

```ts
// packages/kept-core/src/kane/ndjson.ts
export function parseStream<F extends CommandFamily>(
  contract: FamilyContract<F>,
  lines: Iterable<string>,
): ParsedStream<F>;
```

There is no overload without a contract, no default parameter, no `parseAny`, and `FamilyContract` has no public constructor — the only way to obtain one is `contractFor(family)`. Passing a raw string is a type error. A parser call therefore cannot exist in the codebase without a family named at the call site.

The result forces the crash case to be handled before a terminal event can be read:

```ts
export type ParsedStream<F extends CommandFamily> =
  | {
      kind: 'complete';
      family: F;
      terminal: TerminalEvent<F>;          // only exists on this arm
      events: KaneEvent[];
      progress: ProgressEvent[];
      unknown: KaneEvent[];
      members: MemberEnd[];                // populated for ExecutionTestrun only
      plan: TestrunPlan | null;
      coverage: unknown | null;            // raw `coverage` payload for Assurance/cover
      diagnostics: Diagnostic[];
    }
  | {
      kind: 'crashed';
      family: F;
      expectedTerminal: TerminalType<F>;
      events: KaneEvent[];
      diagnostics: Diagnostic[];           // includes the "outcome unknown" diagnostic
    };
```

`kind: 'crashed'` means *outcome unknown* — never pass, never fail. Every state writer refuses a crashed stream (§4.7).

### 4.3 Line handling

```
for each raw line, index i (1-based):
  if not yet seenFirstBrace:
     if trimStart(line) starts with '{' → seenFirstBrace = true, fall through
     else → skip silently, no diagnostic            (R3.23)
  if line is empty after trim → skip silently
  try JSON.parse(line)
     ok  → classify, append
     err → diagnostic { code:'ndjson-parse', line:i, snippet:first 120 chars }, continue  (R3.24)
```

Classification, in order:
1. Object has a `step` key → `ProgressEvent` (`{step, status, remark}`), regardless of whether `type` is present (R3.8).
2. `type === contract.terminalType` → terminal candidate. The **last** such event wins; earlier ones are retained in `events`.
3. `type` in the known set → typed event.
4. Otherwise → retained in `unknown[]`, processing continues (R3.9).

Known type set (from the verified surface, treated as open): `recording_state`, `skill_update_available`, `bifurcation`, `project_folder_auto_defaulted`, `child_agent_start`, `child_agent_end`, `ask_user`, `error`, `test_md_evidence_ingest`, `test_md_bundle_sync`, `run_end`, `testrun_plan`, `testrun_start`, `testrun_member_start`, `testrun_member_end`, `testrun_investigations_wait`, `testrun_evidence_ingest`, `testrun_summary`, `testrun_done`, `coverage`, `gaps`, `done`.

One parsed event per input line, always: `events.length + progress.length` equals the number of lines that parsed as JSON (R3.1). Non-JSON prefix lines and blank lines are not events and are not diagnostics.

### 4.4 Coercion — the single comparison site

```ts
// packages/kept-core/src/kane/coerce.ts
/** The ONLY place result_code is turned into a comparable value. */
export function resultCode(ev: Record<string, unknown> | null | undefined): number | null {
  const raw = ev?.['result_code'];
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

/** credits_consumed preferred, credits accepted, null when neither. */
export function credits(ev: Record<string, unknown> | null | undefined): number | null {
  for (const k of ['credits_consumed', 'credits'] as const) {
    const v = ev?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}
```

Observed reality justifies this precisely: the smoke run emits `"result_code": 100` (number) at top level and `"result_code": "100"` (string) inside `per_flow_metadata[0]` — **both types in one event**. A strict `=== 740` check would work on one and silently never fire on the other, which is the failure mode that would make the three-way branch look alive while never firing.

Enforcement is mechanical: `packages/kept-core/test/no-raw-result-code.test.ts` reads every `.ts` file under `packages/kept-core/src` and `packages/kept-cli/src` and fails if `/result_code\s*(===|!==|==|!=)/` matches outside `kane/coerce.ts`. `result_code` and the process exit code are surfaced as two separate fields and never merged (R3.14).

### 4.5 Exit-code interpretation, per family

```ts
// packages/kept-core/src/kane/exit.ts
export type ExitMeaning =
  | 'success' | 'failure'
  | 'timeout-or-cancelled' | 'paused-resumable' | 'force-interrupted'
  | 'preflight-rejected' | 'kane-not-found' | 'killed-by-timeout';

export function exitMeaning(family: CommandFamily, code: number | null, killed: boolean): ExitMeaning;
```

| code | ExecutionRun | ExecutionTestrun | Assurance |
|---|---|---|---|
| 0 | success | success | success |
| 2 | failure | **preflight-rejected** | failure |
| 3 | timeout-or-cancelled | timeout-or-cancelled | **paused-resumable** |
| 130 | force-interrupted | force-interrupted | force-interrupted |
| 127 / ENOENT | kane-not-found | kane-not-found | kane-not-found |
| any other non-zero | failure | failure | failure |
| killed by our timeout | killed-by-timeout | killed-by-timeout | killed-by-timeout |

The function is total over all integers and `null`, and never returns `failure` for `(Assurance, 3)`. Misreading a resumable pause as a failure is the one mistake that would corrupt ledger state, so it is closed off by a total function plus an exhaustive property test.

### 4.6 Evidence resolution

`run_end` carries no evidence path; the `kane-cli evidence serve <path>` hint is printed on **stderr** only. So:

```ts
export function resolveEvidenceDir(args: {
  family: CommandFamily; sessionDir?: string | null; cwd: string;
}): string | null;
// ExecutionRun      → join(sessionDir, 'evidence')       (null if sessionDir absent)
// ExecutionTestrun  → join(cwd, '.testmuai', 'evidence')
// Assurance         → null
```

No event field is consulted for a path, and `run_dir` is never read from disk under any circumstance — it is typed as `readonly runDirLegacy?: string` purely so the parser tolerates its presence, and there is a property test asserting zero filesystem calls that mention it.

Within the resolved directory, `listArtifacts()` picks the newest pack by directory mtime and classifies files: `annotated.png` → `annotated`, `step-*.png`/`*.png` → `screenshot`, `*.har` → `har`, `console*.ndjson` → `console`, `*.log` → `log`, `failure.yaml`/`failure.yml` → `failure-yaml`. Unknown files are listed as `other` rather than dropped.

### 4.7 KaneInvoker

```ts
// packages/kept-core/src/kane/invoker.ts
export interface InvocationSpec<F extends CommandFamily> {
  family: F;
  /** argv WITHOUT the NDJSON enabler — the invoker adds it from the contract. */
  argv: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  onLine?: (line: string) => void;   // live tail for the dev NDJSON pane
}

export interface InvocationResult<F extends CommandFamily> {
  spec: InvocationSpec<F>;
  stream: ParsedStream<F>;
  exitCode: number | null;
  exitMeaning: ExitMeaning;
  timedOut: boolean;
  durationMs: number;
  stderrTail: string[];               // last 50 lines, keeps the evidence hint + [member] lines
  resolvedBinary: string | null;
  diagnostics: Diagnostic[];
}

export class KaneInvoker {
  async invoke<F extends CommandFamily>(spec: InvocationSpec<F>): Promise<InvocationResult<F>>;
}
```

Behaviour, in order:

1. Resolve `kane-cli` on `PATH` once per process. Absent → return immediately with `exitMeaning: 'kane-not-found'`, `stream.kind: 'crashed'`, and a diagnostic. Never throws (R2.12).
2. Assert `familyForArgv(argv) === spec.family`; mismatch is a programming error and throws at development time.
3. Apply the contract's NDJSON enabler:
   - `agent-flag` → append `--agent`
   - `mode-agent` → append `--mode agent`
   - `piped-stdout` → append **nothing**, and assert `--agent` is absent from the final argv (R3.5)
4. `spawn(bin, argv, { cwd, env, stdio: ['ignore','pipe','pipe'] })`. stdin is `ignore` so Kane's `ask_user` self-disables.
5. Split stdout on `\n` incrementally, buffer partial lines, feed `onLine`, accumulate for the parser.
6. On `timeoutMs` elapse: `SIGTERM`, then `SIGKILL` after 2 s; set `timedOut`, `exitMeaning: 'killed-by-timeout'`, emit a timeout diagnostic (R11.8).
7. Parse the accumulated lines under `contractFor(spec.family)`.
8. Return. **The invoker never throws for any Kane behaviour** — every failure is data.

Timeout budgets: enrichment `cover` 60 s (R2.8); any hook-triggered invocation 300 s (R11.8); `testrun run --dry-run` 60 s.

### 4.8 The write guard

```ts
// packages/kept-core/src/state.ts
export function mayWriteVerdicts<F extends CommandFamily>(r: InvocationResult<F>): boolean {
  return r.stream.kind === 'complete'
      && (r.exitMeaning === 'success' || r.exitMeaning === 'failure');
}
```

Every verdict mutation goes through `StateStore.applyRun(result, …)`, which calls `mayWriteVerdicts` first and returns the state unchanged when it is false. Crashed, timed out, paused, force-interrupted, preflight-rejected and kane-not-found therefore all preserve prior verdicts and the freshness timestamp by construction rather than by remembering to check (R3.7, R4.10, R4.11, R5.3, R5.4, R11.8–11.11).

### 4.9 The verified `context` surface, and the abridged-help rule

`kane-cli --help` omits commands that exist and work. **`kane-cli context --help` is abridged the same way** — it omits several subcommands that were confirmed present by direct probing of the installed 0.8.4. Recorded here so nobody re-derives it from the help text and concludes a capability is missing:

| `context` subcommand | Verified behaviour |
|---|---|
| `ingest <src…>` | Lands sources into `.context/` **and extracts them** — the one-flow entry point (below) |
| `extract` | Extraction on its own; Assurance family, terminates `done` |
| `list --type source \| usecase` | Enumerates the store. `--json` for a machine-readable listing. **This is how a source id is resolved** (§13.2) |
| `review --queue derived \| skipped \| archived \| drift` | Four review queues, not one |
| `view` | Renders an interactive HTML snapshot of the store |
| `explain <ref> --json` | Machine-readable explanation of one graph reference |
| `sessions` | Session listing |
| `fsck` | Store integrity check |
| `rebuild` | Rebuilds the derived store |

The operating rule, applied to the whole CLI: **help omissions prove nothing.** Probe `kane-cli <cmd> --help` before concluding anything is absent, and treat observed runtime behaviour as ranking above the skill references, which in turn rank above the website docs (A13).

**The skill installs for Claude Code, Codex CLI and Gemini CLI only.** `~/.kiro/skills/` is empty and stays empty, because Kiro loads `powers/`. `kane-cli install skill` was run and it changed **no CLI behaviour whatsoever** — its only value is the `references/*.md` documentation it drops for other agents. Nothing in KEPT depends on the skill being installed, and no task should be spent installing it.

#### 4.9.1 `context ingest` is the one-flow entry — the bootstrap sequence changes

`context ingest <src…>` no longer only *lands* files. It lands them into `.context/` **and continues into extraction in the same invocation.** The branch is on the terminal, not on a flag:

| Invocation condition | What happens |
|---|---|
| TTY attached, no mode override | Lands the sources, then **continues into the interactive extract chat** |
| `--mode ci`, or stdin is piped | **Lands only.** No extraction, no chat |

This is load-bearing for KEPT because the invoker always spawns with `stdio: ['ignore','pipe','pipe']` (§4.7) — stdin is never a TTY — so **any ingest KEPT performs itself lands only and never extracts.** The bootstrap is therefore two explicit steps, and the extraction step is named rather than implied:

```
# Bootstrap, once, by hand — interactive, because extraction wants a human
kane-cli context ingest apps/fixture/README.md
   → lands the source AND opens the extract chat (TTY path)

# Bootstrap, headless / reproducible — the sequence KEPT and CI use
kane-cli context ingest apps/fixture/README.md --mode ci     # lands only
kane-cli context extract --mode agent                        # Assurance family, terminates `done`
kane-cli design tests --use-case <ref> --mode agent           # designs the suite
```

Consequences recorded so they are not rediscovered mid-build:

- A headless ingest that appears to "do nothing" has in fact succeeded; the missing piece is the separate `extract`, not a failed ingest.
- `cover` refuses until a store exists (§5.3), so the ingest→extract pair is a **precondition of `kept build` producing an enriched graph** — not a parallel activity. Stage 9 of §19 opens with it.
- Ingest is never invoked from a hook. It is a one-time human bootstrap plus a documented headless recipe in the README.

---

## 5. Promise providers and graceful degradation

### 5.1 One interface, two providers

```ts
// packages/kept-core/src/providers/adapter.ts
export interface ProviderResult {
  provider: 'baseline' | 'enrichment';
  /** Candidates, pre-admission. The graph builder runs the citation gate. */
  candidates: PromiseCandidate[];
  /** Per-promise-id axis overlays; enrichment only. */
  axes: Map<string, { designedTest?: DesignedTest; verdict?: Verdict; evidencePackId?: string }>;
  ok: boolean;                  // false ⇒ contributes degraded
  degradedReason: string | null;
  diagnostics: Diagnostic[];
}

export interface PromiseAdapter {
  readonly name: 'baseline' | 'enrichment';
  /** Never throws. Never rejects. Failure is expressed in ProviderResult.ok. */
  collect(ctx: { repoRoot: string; invoker: KaneInvoker }): Promise<ProviderResult>;
}
```

Both providers implement this one interface (R2.1). `collect` returning rather than throwing is what makes degradation a data path instead of an error path.

### 5.2 BaselineProvider — cannot fail

Scans `**/*_test.md` under the repo root, skipping `node_modules`, `.git`, `.next`, `dist`, `output-*`, `.testmuai`. For each file:

- Read as UTF-8 with `{ encoding: 'utf8' }`; on any read error → diagnostic naming the file, continue (R2.3).
- Parse frontmatter with a 20-line hand-rolled reader (`---` … `---`, `key: value`, `key: [a, b]`, `key:` + `- item` lists). A malformed block is a diagnostic, not a throw; the body is still scanned for tags.
- Extract every `@verifies <file>:<line>` tag. For each, read the cited file, take the verbatim line, and emit a candidate with `designedTest = { path, testId: frontmatter.test_id ?? null }`.

Guarantees: every code path is wrapped so `collect` resolves with `ok: true` for every repository state including zero `*_test.md` files (R2.4). Zero files means zero candidates and a graph of zero promises — which the metrics layer renders as `n/a` rather than dividing (R9.3). Baseline never sets `degraded`.

### 5.3 EnrichmentProvider — cover, gated on `done`

```
invoker.invoke({
  family: 'Assurance',
  argv: ['cover', '--json'],       // invoker appends --mode agent
  cwd: repoRoot,
  timeoutMs: 60_000,
})
```

Acceptance requires **all** of: `stream.kind === 'complete'`, `terminal.type === 'done'`, `terminal.status === 'complete'`, and a `coverage` payload event present. Anything else → `ok: false` with a specific `degradedReason`:

| Observation | degradedReason |
|---|---|
| binary absent | `kane-not-found` |
| stream lacks `done` | `crashed-stream: outcome unknown` |
| `done.status` ∈ error/refused/interrupted/aborted | `assurance-status:<status>` — e.g. `assurance-status:refused`, **verified** below |
| `done.status === 'paused'`, exit 3 | `paused-resumable` |
| killed at 60 s | `enrichment-timeout` |
| `coverage` payload missing or unprojectable | `coverage-payload-unreadable` |
| any line failed JSON parse *and* no `coverage` event | `coverage-payload-unreadable` |

The `coverage` payload's internal schema is not pinned by observation, so `providers/coverage.ts` reads it **tolerantly**: walk the payload for any array of objects, and accept an entry when it carries a recognisable test identity (`test_id` | `id` | `testId`) and/or a path (`path` | `file` | `test_path`), plus optional booleans/enums for designed and proven state (`designed`, `is_designed`, `status`, `proven`, `passed`). Entries that project cleanly become axis overlays keyed by:

1. `test_id` matched against a candidate's `designedTest.testId`, else
2. normalised `path` matched against `designedTest.path`.

Unmatched entries are recorded as diagnostics, not failures. If **zero** entries project, that is `coverage-payload-unreadable` and the build degrades — better a visibly baseline-only ledger than a silently wrong proven number.

#### 5.3.1 The refusal envelope, verified rather than assumed

Running `cover` in a directory with no `.context/` store emits exactly this on **stdout**, and nothing at all on stderr:

```json
{"type":"error","v":1,"verb":"cover","message":"error: no context store here (run `kane-cli context ingest <files>` first)"}
{"type":"done","v":1,"verb":"cover","status":"refused","exit_code":2}
```

This one observation empirically confirms four things the parser is built on, so they are no longer inferences:

1. **The envelope is real.** Every Assurance event carries `{ type, v: 1, verb }`. `v` is `1`; `verb` is the command word (`cover` here). The parser types `v` and `verb` as present-and-optional rather than guessed.
2. **`done` is genuinely terminal and genuinely always emitted** — even on a refusal that produced no work. A refusal is a *complete* stream, not a crashed one, which is precisely why `kind: 'complete'` plus a non-`complete` status must be distinguishable from `kind: 'crashed'`.
3. **`status: "refused"` exists as an observed value**, not just a documented one.
4. **`exit_code` is carried in the event and equals 2 here**, alongside the process exit code — two separate values, consistent with R3.14.

And one operational fact: **stdout is pure NDJSON, stderr is silent.** The prefix-skip rule of §4.3 is defensive insurance for other versions, not a workaround for this one.

Mapped behaviour: `stream.kind === 'complete'`, `terminal.status === 'refused'`, `exitMeaning === 'failure'` (Assurance, exit 2), so acceptance fails and the provider returns `ok: false` with **`degradedReason: 'assurance-status:refused'`**. The diagnostic quotes the `message` verbatim, so the Ledger's `/runs` page tells a reviewer the actual remedy — run `context ingest` — instead of a generic failure. `packages/kept-core/test/fixtures/assurance-cover-refused.ndjson` is these exact two lines, committed as a regression fixture.

### 5.4 Merge rules

`mergeGraph(baseline, enrichment)`:

1. Run the admission gate (§3.3) over baseline candidates first. Baseline is the **sole citation authority** — enrichment never contributes a citation, so a Kane outage can never move a citation.
2. Union by promise id. On collision (R1.7): keep baseline `citation` and `claim`; take `designedTest` and `verdict` from enrichment when present; union `providers`; concatenate diagnostics.
3. Apply enrichment axis overlays to matching promises.
4. Any promise still without a `designedTest` gets `verdict = 'undesigned'` (R5.5).
5. `degraded = !enrichment.ok`; `degradedReasons = [enrichment.degradedReason].filter(Boolean)`.
6. Sort promises by id and edges by `(kind, from, to)` so the graph is canonical.

Merge is associative and idempotent for the fields it touches, which is what lets the property test assert it directly.

### 5.5 Why the ledger still renders when Kane is absent

`BaselineProvider` needs nothing but the filesystem. It produces every promise, every citation, and every designed-test binding. What it cannot produce is the *proven* axis, because only a real run can prove anything. So with Kane absent:

- the graph has all its nodes and all its citations,
- every promise carries the verdict last written to `.kept/state.json` (or `undesigned`),
- `degraded` is `true`, the CLI exits **0** (R2.10),
- the Ledger renders a static `baseline data only` chip and **omits the Proven Coverage figure entirely** — not a zero, not a dash in the metric slot; the tile is replaced by the chip (R2.11).

The honest failure mode is "we are not claiming proof right now", never "proof is 0%".

---

## 6. Verdict routing

### 6.1 Interface

```ts
// packages/kept-core/src/verdict/router.ts
export type RepairBranch = 'code-break' | 'test-drift' | 'docs-lie';

export interface VerdictObject {
  confirmed: boolean;
  family: string | null;
  category: string | null;
  severity: string | null;
  one_liner: string | null;
  confidence: number | null;
}

export interface FailureContext {
  family: CommandFamily;
  /** The failing terminal event, raw. Access result_code only via coerce. */
  terminal: Record<string, unknown>;
  verdictObject: VerdictObject | null;
  /** Absolute dir, or null when the family cannot resolve one. */
  evidenceDir: string | null;
  /** Lazily loaded; null when absent or unparseable. */
  loadFailureYaml: () => FailureYaml | null;
  memberStatus?: MemberStatus;      // ExecutionTestrun only
  promiseId: string;
}

export interface RoutedRepair {
  branch: RepairBranch;
  strategy: 'resultCode740' | 'failureYamlTriage';
  severity: string | null;
  category: string | null;
  confidence: number | null;
  /** Repo-relative path to the artefact that justified the call, or null. */
  evidenceRef: string | null;
  rationale: string;                // human sentence naming the deciding signal
}

export interface VerdictRouter {
  readonly name: 'resultCode740' | 'failureYamlTriage';
  route(ctx: FailureContext): RoutedRepair;   // total; never throws
}

export function selectRouter(cfg: { verdictRouter?: string }): VerdictRouter;
```

`route` is total: it returns a `RoutedRepair` for every input, defaulting to `docs-lie` when nothing matched (R6.9). It never throws, never returns null, never returns two branches.

### 6.2 `resultCode740`, rule order

Precedence matters because R6.3 and R6.5 can both apply to one event. R6.4 calls the Verdict_Object the *primary* classification signal, so the object outranks the numeric code. Documented resolution:

| # | Condition | Branch | Rationale recorded |
|---|---|---|---|
| 1 | `verdictObject && confirmed === false` | `test-drift` | Kane investigated and did not confirm a product bug |
| 2 | `verdictObject && confirmed === true` | `code-break` | Kane confirmed a product bug; severity/category/confidence surfaced |
| 3 | no object, `resultCode(terminal) === 740` | `code-break` | confirmed-bug result code without inline verdict |
| 4 | no object, `resultCode` in `700..799` | delegate to `failureYamlTriage` | assertion-class failure needs triage |
| 5 | no object, any other failing code | delegate to `failureYamlTriage` | R6.6 fallback |
| 6 | delegate produced nothing | `docs-lie` | no rule matched (R6.9) |

Rules 1 and 2 read `severity`, `category` and `confidence` off the object into `RoutedRepair` (R6.4). Rule 3 uses the coercing accessor only, so `"740"` and `740` land on the same branch (R6.8). `evidenceRef` is the resolved `failure.yaml` when one exists, else the pack directory, else `null` — never a fabricated path (R6.11).

### 6.3 `failureYamlTriage`

Reads the triage note and takes a category-ish field, lower-cased, in this precedence:

`triage.rca.category` | `triage.category` | `category` | `classification` | `reason`

| Signal | Branch |
|---|---|
| **`application_issue`**, `product_bug`, `app_error`, `server_error`, `http_5xx`, `crash`, `console_error` | `code-break` |
| `automation_bug`, `selector_not_found`, `locator`, `element_not_found`, `stale_element`, `timeout`, `navigation`, `flaky`, `timing` | `test-drift` |
| `assertion`, `expectation_mismatch`, `value_mismatch` **and** coerced `result_code` in the seven-hundred band | `docs-lie` |
| note absent, unparseable, or unrecognised signal | `docs-lie` (default) |

The `assertion ⇒ docs-lie` mapping is deliberate: an assertion that fails while the app behaves normally and the selector resolves is the signature of a claim that was never true. `code-break` requires positive evidence of a product fault; `test-drift` requires positive evidence of a test-mechanics fault; the residue is the documentation's problem.

#### 6.3.1 Where the note actually is, and what it actually says

Three corrections, each measured against the installed 0.8.4 rather than assumed, and each recorded in `docs/kane/loop/README.md`.

**The note is inside a zip, and it is per failing step.** `listArtifacts` resolves a pack *directory*; Kane seals a single `.evidence` **archive**. Nothing opened it, so `failure-yaml-absent` was reported for every run and the answer was `docs-lie` every time — including for a deliberately broken `subtotal`. The three-way branch was a one-way branch that looked alive. `kane/packArchive.ts` is the reader (`node:zlib` `inflateRawSync`, no dependency, no spawned `unzip`), shared with `kept snapshot`'s evidence curation which built it first.

Attribution is **by identifier, never by name.** The note lives at `tests/<slug>/steps/<n-a-b>/failure.yaml` where the slug derives from the document's *title* (`cart-subtotal-d5ba3490`), and matching a slug to a member path would be inferring identity from a name — the one thing §7.1 and §4.6 exist to forbid. The pack answers it properly: each `tests/<slug>/result.yaml` carries the member's own `test_id`, the same UUID `testrun_member_end` reports. `kane/packTriage.ts` keys on that, locates the archive by this run's own `execution_id` so a previous or parallel run's pack is never read, and attributes nothing to a member the pack does not name.

**The category is nested one level deeper than the alias list read.** Every real note spells it `triage.rca.category`, with `confidence` beside it and `severity` one level up. The four shallower aliases are kept; the deeper one leads.

**`application_issue` is Kane's own product-fault family and was missing from the list.** The seven tokens beside it were authored from Kane's documented vocabulary before any pack had been opened. Without the family, the broken `subtotal` routed `docs-lie` while Kane's note read `application_issue/ui_data_defect` at confidence 0.96 on the first attempt. Admitting it is what makes `code-break` reachable at all.

#### 6.3.2 What this vocabulary cannot decide, and why that is not a bug in it

Admitting `application_issue` is necessary and **it is not sufficient**, and the reason is structural rather than a gap in the list.

**Kane treats the test document as the specification.** For the fixture's deliberately never-true discount claim its note reads `application_issue/ui_data_defect` at 0.89, with `suggested_fix: Check the cart's discount calculation … verify the total updates to 10% below the subtotal` — a correct description, on Kane's own terms, of a discount the cart never applies, written with no way to know the sentence was invented to be false (§12.7). The genuinely broken `subtotal` earns the *same* category at 0.96. One token, two opposite meanings, and there is no third token meaning "the claim itself is false", because from where Kane stands the claim cannot be false.

Measured, for one unchanged T-7 failure across three committed packs and six live runs:

| source | what Kane said | branch it implies |
|---|---|---|
| pack `0944d075`, broken `subtotal` (T-3) | `application_issue/ui_data_defect` 0.96 | `code-break` — correct |
| pack `57591bff`, discount claim (T-7) | `application_issue/ui_data_defect` 0.89 | `code-break` — wrong |
| pack `108dbb62`, discount claim (T-7) | `automation_bug/state_transition_bug` 0.91 | `test-drift` — wrong |
| `[member]` stream, 15.3's suite replay | `740`, `confirmed: true`, 0.95 | `code-break` |
| `[member]` streams, three runs | absent entirely | `docs-lie` residue |
| `[member]` stream, `57591bff` | `710`, `confirmed: false`, 0.89 | `test-drift` |

Four answers for one failure. No widening of the signal list turns that into a discriminator, and re-running until it says something convenient is a coin flip presented as a demonstration.

So the router keeps reporting what Kane concluded — R6.3, R6.4, R6.5 and R6.9 unchanged, and the Ledger publishes it verbatim, which is the honest thing to show. The distinction the *repair* needs is made one layer up, on evidence Kane does not have: §8.1.1.

### 6.4 Selection and isolation

`.kept/config.json`:

```json
{ "verdictRouter": "resultCode740", "memberDebug": false, "timeouts": { "hookMs": 300000, "enrichmentMs": 60000 } }
```

Read once at CLI startup; `selectRouter` maps the string to an implementation and falls back to `resultCode740` with a diagnostic on an unknown value. Nothing outside `src/verdict/` imports a concrete router — enforced by a source-scan test alongside the `result_code` scan. Consequence: the pending verdict spike can only ever change one string in one JSON file. `docs/kane/verdict-spike.md` records the empirical outcome and the resulting default (R6.12); `failureYamlTriage` ships working regardless (R6.13).

### 6.5 Member status mapping

```ts
// packages/kept-core/src/verdict/memberStatus.ts
export type MemberStatus = 'passed' | 'failed' | 'broken' | 'interrupted';

export function memberStatusToVerdict(s: string): { verdict: Verdict; known: boolean } {
  switch (s) {
    case 'passed':      return { verdict: 'proven', known: true };
    case 'failed':      return { verdict: 'red',    known: true };
    case 'broken':      return { verdict: 'red',    known: true };
    case 'interrupted': return { verdict: 'stale',  known: true };
    default:            return { verdict: 'stale',  known: false };   // total, never throws
  }
}
```

`broken` and `interrupted` are additionally recorded verbatim in the run diagnostics so a broken member stays distinguishable from an asserted failure after the fact (R4.9). Only `failed` and `broken` enter the `VerdictRouter`; `interrupted` is a `stale` verdict with no repair branch, because an interrupted member proved nothing.

---

## 7. Blast radius

### 7.1 The chain

```
changed paths (from the hook)
  → tests whose frontmatter `covers:` globs match a changed path        [authored assurance metadata]
  → promises whose designedTest.path is one of those tests
  → test_id for each of those tests, taken from testrun_plan.members[]  [KANE IS AUTHORITY]
  → kane-cli testrun run --from-context <ids>
```

The identifiers handed to Kane are always Kane's own assurance-graph ids from `testrun_plan.members[].test_id` (R4.3, R4.4). A member with no `test_id` in the plan is **never selected**, and its exclusion is recorded as a diagnostic — we do not guess an id from a path.

### 7.2 Plan acquisition and cache

```ts
// packages/kept-core/src/radius/plan.ts
export interface PlanMember { path: string; testId: string | null; tags: string[]; failure: string | null }
export interface TestrunPlan { valid: boolean; members: PlanMember[]; capturedAt: string }

/** Reads .kept/plan.json; refreshes via --dry-run when stale or missing. */
export async function readPlan(opts: { invoker; cwd; maxAgeMs: number }): Promise<TestrunPlan | null>;
```

Refresh invocation: `kane-cli testrun run --dry-run` (family `ExecutionTestrun`, stdout piped, no `--agent`, 60 s). Only `testrun_plan` is consumed; the stream still must reach `testrun_done` to be trusted, and a `--dry-run` stream that crashes leaves the previous cache in place. `maxAgeMs` default 10 minutes; `kept verify` refreshes when any `*_test.md` mtime is newer than `plan.json`.

### 7.3 Radius computation

```ts
export interface BlastRadius {
  testIds: string[];                          // deduped, sorted, ⊆ plan test ids
  promiseIds: string[];
  skippedNoTestId: string[];                  // test paths present in plan without an id
  unmatchedPaths: string[];                   // changed paths no test covers
}
export function computeBlastRadius(args: {
  changed: string[]; graph: PromiseGraph; plan: TestrunPlan;
}): BlastRadius;
```

Glob matching is a 30-line matcher supporting `*`, `**` and literal segments — no `micromatch` dependency. Paths are normalised to repo-relative POSIX before matching.

Empty radius → **no Kane invocation at all**, exit 0, diagnostic `no designed test covers <path>` per unmatched path (R4.5). This is the common case on an unrelated edit and must cost nothing.

### 7.4 Verification invocation

```
kane-cli testrun run --from-context T-3,T-5 --on-failure continue
   cwd: repoRoot
   stdio: stdout piped   (this is what enables NDJSON — there is no --agent flag)
   env: { ...process.env, KANE_TESTRUN_MEMBER_DEBUG: '1' }   // only when config.memberDebug
   timeout: 300_000
```

Consumption order:

1. `testrun_plan` → if `valid === false`: record every member's `failure` reason from `missing_meta | not_authored | org_mismatch | project_mismatch`, treat exit 2 as `preflight-rejected`, leave all verdicts unchanged, exit 0 (R4.11).
2. `testrun_member_end` events → `memberStatusToVerdict`.
3. Require `testrun_done`; absent → crashed, verdicts untouched (R4.10).
4. Resolve evidence from `<cwd>/.testmuai/evidence/` (R4.13).
5. Route each `failed`/`broken` member through the `VerdictRouter`.
6. `StateStore.applyRun` writes verdicts **only for promises in the radius**. Promises outside are copied byte-identically, including their `verdictSource` and freshness (R4.15) — the state store deep-freezes untouched records and the property test compares serialised forms.
7. Write handoff, then snapshot (R4.14).

Credits: replay against committed `output-*/` recordings is free. The CLI reports whatever `credits()` returns and records it; it does not assume 0. R4.6 is verified once against the live CLI and the measurement committed.

---

## 8. Repair branches

### 8.1 Autonomy per branch (A5)

| Branch | Actor | Autonomy | Artefact |
|---|---|---|---|
| `code-break` | Kiro agent via hook | applied automatically to fixture source | patch + re-fired verification |
| `test-drift` | `kept evolve` → `kane-cli maintain evolve --mode agent` | held | `.kept/review-cards/<id>.json` |
| `docs-lie` | `kept` proposes, human accepts | never silent | `.kept/amendments/<id>.json` |

### 8.1.1 The one condition on automatic repair

**Automatic repair is granted only to restore a promise KEPT has itself proven.** The `code-break` row above reads unconditionally, and it is conditional: `handoff/handoff.ts` hands back `BRANCH_FENCES['code-break']` only when at least one promise carrying that branch had verdict `proven` before the run. Otherwise it hands back `UNPROVEN_CODE_BREAK_FENCE` — same branch, `autonomy: 'hold'`, `artefact: null`, `allowedPaths: []` — and reports `handoff-code-break-unproven` naming the promise, its prior verdict and its citation.

**Why.** §6.3.2 measures it: Kane's triage category cannot separate a regression from a claim that was never true, because Kane reads the test document as the specification. Both the broken `subtotal` and the never-true discount claim earn `application_issue/ui_data_defect`. Granting the second one a write path would point an agent at `apps/fixture/**` under the instruction *"restore the behaviour the cited claim describes"* and set it to **implementing a discount nobody designed** — the system rewriting the product to match a lie, which is strictly worse than the routing bug it would be fixing.

The discriminator KEPT has and Kane cannot is the promise's **own prior verdict**. `proven` means this repository witnessed the behaviour, with a terminal event and a sealed pack behind it; red after that is a regression, and restoring it is exactly what the branch authorises. A promise never `proven` has no such witness — nothing established it worked, so nothing broke.

> **You cannot break what was never proven to work.**

That upgrades the safety claim from *"we trust Kane's category"* to *"automatic repair only ever restores behaviour KEPT has observed"*, which this repository can enforce rather than assert about another tool's word choice.

**Why a fence and not a branch.** R6.3, R6.4 and R6.5 prescribe what the router returns for a coerced `740`, for a Verdict_Object and for `confirmed: false`. The router keeps returning it, so the snapshot, `/runs` and the Ledger keep publishing Kane's real conclusion. What is withheld is *autonomy*, which is this section's own column. `fenceFor` therefore still answers §8.1's table unconditionally — a test can assert the table without knowing the gate exists — and `fenceForResults` is the single site that applies the condition.

**The direction matters.** The withheld row only ever **narrows**: `allowedPaths` empties, every glob the granted row allowed becomes forbidden, and nothing is added anywhere. Property 26's containment holds more strictly than before, and its fence clause reads the expected row off `grantsAutomaticRepair` rather than off the table.

**Grant is "at least one", not "all".** A radius can hold a real regression beside a promise nobody ever proved; restoring the regression is legitimate work that the second promise's history has no standing to forbid, and the second promise is still named in a diagnostic. The fence is glob-scoped to fixture source either way, so this widens nothing.

**The honest cost.** On a repository where nothing has ever been verified every promise is `stale`, so the first failing run grants no automatic repair. That is correct — there is no observed state to restore — and it is diagnosed rather than silent. It does not affect the judge path: the committed snapshot ships the baseline, so a clone already has `proven` promises to regress from.

`HandoffResult.previousVerdict` carries the value. It defaults off the supplied graph record, which needs no plumbing at the call site because `runVerify` routes off `prior.graph.promises` — the record it passes *is* the pre-run one. It is recorded on every result, failing or not, because it is also the only field that says whether `verdict` is a *transition*: `/runs` can distinguish `proven → red` from `stale → red`, and only the first is a regression.

### 8.2 Review cards

```jsonc
// .kept/review-cards/rc_7c1e04a9.json
{
  "id": "rc_7c1e04a9",
  "createdAt": "2026-08-20T18:41:02.118Z",
  "kind": "test-drift" | "reconcile",
  "promiseId": "p_9f2c1a4b7d33",
  "branch": "test-drift",
  "title": "cart_subtotal_test.md step 3 selector no longer resolves",
  "detail": "…",
  "proposedChanges": [{ "file": "tests/cart_subtotal_test.md", "summary": "…", "diff": "…" }],
  "evidenceRef": "evidence/ev_2026-08-20T18-40-11Z/failure.yaml",
  "strategy": "resultCode740",
  "status": "open" | "dismissed"
}
```

Every change produced by `maintain reconcile` or `maintain evolve` lands here and is never applied (R5.7, R7.2). The only filesystem writes on these paths are under `.kept/` — asserted by a property test that runs the flow against a write-recording fs.

### 8.3 Docs amendments — persistence

```jsonc
// .kept/amendments/am_3b9d21f0.json
{
  "id": "am_3b9d21f0",
  "createdAt": "2026-08-20T18:41:02.118Z",
  "status": "pending" | "accepted" | "rejected" | "stale",
  "promiseId": "p_44ab90c1e7d2",
  "citation": { "file": "apps/fixture/README.md", "line": 20,
                "text": "- The Cart screen applies a 10 percent discount automatically when the subtotal exceeds 50 dollars." },
  "currentText": "- The Cart screen applies a 10 percent discount automatically when the subtotal exceeds 50 dollars.",
  "proposedText": "- The Cart screen shows the order total with no automatic discounts.",
  "expectedSha256": "9e0c…",              // sha256 of currentText, the staleness interlock
  "rationale": "Kane asserted the discount at subtotal 62.00 and observed no discount applied. The app implements no discount rule.",
  "evidenceRef": "evidence/ev_2026-08-20T18-40-11Z/failure.yaml",
  "artifacts": { "annotated": "evidence/ev_…/annotated.png", "screenshot": "evidence/ev_…/step-4.png" },
  "strategy": "resultCode740",
  "appliedAt": null
}
```

`amendmentId = 'am_' + sha256(promiseId + '\n' + proposedText).slice(0,8)`, so re-proposing the same amendment is idempotent and does not accumulate duplicates.

`propose()` writes **only** this file. No documentation byte is written (R7.4). The amendment is copied into the snapshot so the Ledger can render it with zero filesystem access.

### 8.4 Acceptance — the surgical write

`kept amend accept am_3b9d21f0`:

```
1. Load the amendment; status must be "pending", else refuse.
2. Read citation.file. Split on '\n'.
3. Guard: line ≤ lines.length, and sha256(normaliseClaim(lines[line-1])) === expectedSha256.
      mismatch → status = "stale", diagnostic "amendment stale: cited line changed since proposal", exit 0, NO write.
4. lines[line-1] = proposedText           ← exactly one element mutated
5. Write to <file>.kept-tmp then rename over the original (atomic), preserving the
   original trailing-newline state and the original line endings.
6. status = "accepted", appliedAt = now.
7. Rebuild the graph (baseline + enrichment) and rewrite the snapshot.        (R7.6)
```

Every other line is byte-identical after the write. That is a property test, not a hope. `kept amend reject <id>` sets `rejected` and touches nothing else.

### 8.5 The accept control, and why the Ledger stays route-free

R7.5 wants an accept control in the Ledger; R8.4 forbids any Ledger route that mutates persisted data. Both are satisfied by keeping the write in the CLI:

- **Deployed (always available).** `AcceptControl` is a real, keyboard-focusable button that copies `kept amend accept am_3b9d21f0` to the clipboard and reveals the command inline. The Ledger writes nothing and exposes no non-GET handler. Judges see the diff, the rationale, and the exact command; the video shows it run.
- **Local one-click (nice-to-have, droppable — see §18).** `kept watch` runs a listener bound to `127.0.0.1:3199`, outside the Next app. When `NEXT_PUBLIC_KEPT_LOCAL=1` the control also `POST`s `/accept/:id` to that listener, which performs the same `kept amend accept` path and rewrites the snapshot. The mutable surface lives in the developer's own CLI process, is loopback-bound, is never deployed, and is absent from the Ledger's route tree either way. It carries no auth because it is loopback-only and dev-gated; that trade is recorded here deliberately rather than by accident.

---

## 9. Ledger snapshot: the CLI↔UI contract

One file, one schema, one direction of travel. `apps/ledger/data/ledger.snapshot.json`, committed.

### 9.1 Schema

```ts
// packages/kept-core/src/model/snapshot.ts  (zod; the type is inferred from the schema)
LedgerSnapshot = {
  schemaVersion: 1,                                  // literal
  generatedAt: string,                               // ISO 8601
  generator: { kept: string, kaneCli: string | null },
  degraded: boolean,
  degradedReasons: string[],

  freshness: {
    terminalEventAt: string | null,                  // ISO 8601 of newest consumed terminal event
    terminalEventType: 'run_end' | 'testrun_done' | 'done' | null,
    commandFamily: 'ExecutionRun' | 'ExecutionTestrun' | 'Assurance' | null,
  },

  metrics: {
    totalPromises: number,                           // int ≥ 0
    designedCount: number,
    provenCount: number,
    redCount: number,
    staleCount: number,
    undesignedCount: number,                         // the suite debt  (R5.8)
    designedCoverage: number | null,                 // null iff totalPromises === 0  (R9.3)
    provenCoverage: number | null,                   // null iff totalPromises === 0 OR degraded
  },

  promises: Array<{
    id: string,                                      // ^p_[0-9a-f]{12}$
    claim: string,
    citation: { file: string, line: number /* int ≥1 */, text: string },
    designedTest: { path: string, testId: string | null } | null,
    verdict: 'proven' | 'red' | 'undesigned' | 'stale',
    verdictSource: {
      runId: string, terminalEventType: string, at: string,
      memberStatus: 'passed'|'failed'|'broken'|'interrupted' | null,
      resultCode: number | null, reasonCode: string | null,
    } | null,
    repair: {
      branch: 'code-break'|'test-drift'|'docs-lie',
      strategy: 'resultCode740'|'failureYamlTriage',
      severity: string | null, category: string | null, confidence: number | null,
      evidenceRef: string | null, rationale: string,
    } | null,
    evidencePackId: string | null,
    providers: Array<'baseline'|'enrichment'>,        // non-empty
    credits: number | null,
  }>,

  edges: Array<{ from: string, to: string, kind: 'cites'|'designed'|'evidence' }>,

  documents: Array<{ id: string, file: string, claimCount: number }>,   // graph lane 0

  evidence: Array<{
    id: string,                                      // ^ev_
    kind: 'run' | 'testrun',
    sealedAt: string | null,
    publicPath: string,                              // "/evidence/ev_…/"  (static, committed)
    artifacts: Array<{
      kind: 'annotated'|'screenshot'|'har'|'console'|'log'|'failure-yaml'|'other',
      name: string, publicPath: string, bytes: number | null,
    }>,
  }>,

  runs: Array<{                                      // newest first, capped at 20
    id: string, family: 'ExecutionRun'|'ExecutionTestrun'|'Assurance',
    command: string,                                 // "testrun run --from-context T-3"
    startedAt: string, endedAt: string, durationMs: number,
    exitCode: number | null,
    exitMeaning: 'success'|'failure'|'timeout-or-cancelled'|'paused-resumable'
               |'force-interrupted'|'preflight-rejected'|'kane-not-found'|'killed-by-timeout',
    terminalSeen: boolean,
    terminalEventType: string | null,
    status: string | null,                           // terminal event status verbatim
    resultCode: number | null,                       // coerced
    reasonCode: string | null,
    credits: number | null,
    verdictObject: { confirmed: boolean, family: string|null, category: string|null,
                     severity: string|null, one_liner: string|null, confidence: number|null } | null,
    evidencePackId: string | null,
    members: Array<{ path: string, testId: string|null,
                     status: 'passed'|'failed'|'broken'|'interrupted', verdict: Verdict }>,
    diagnostics: Diagnostic[],
  }>,

  reviewCards: ReviewCard[],
  amendments: DocsAmendment[],
  diagnostics: Array<{ code: string, severity: 'info'|'warn'|'error',
                       message: string, file: string|null, line: number|null, at: string }>,
}
```

Cross-field rules the schema enforces (a `.superRefine`, so a violation names the offending path — R8.8):

- `metrics.totalPromises === promises.length`
- `designedCount`/`provenCount`/`undesignedCount` equal the corresponding counts over `promises`
- `designedCoverage === null` iff `totalPromises === 0`, else it equals `designedCount / totalPromises`
- every `promise.evidencePackId` and every `repair.evidenceRef` resolves to an entry in `evidence`
- every `edges[].from`/`.to` resolves to a promise, document, designed test or evidence id
- `freshness.terminalEventType` is consistent with `freshness.commandFamily` per the contract table

### 9.2 Canonical serialisation

```ts
export function serialiseSnapshot(s: LedgerSnapshot): string;  // 2-space indent, sorted keys,
                                                               // arrays pre-sorted by id
export function parseSnapshot(text: string): LedgerSnapshot;   // zod parse; throws with path
```

Key order is fixed by a recursive sorted-key stringifier, arrays are sorted by their natural id, and no `Date` objects survive into the structure — timestamps are strings throughout. Consequences: `parse(serialise(x))` deep-equals `x`, `serialise(parse(serialise(x)))` is byte-identical to `serialise(x)`, and git diffs on the snapshot are readable line-by-line, which matters when the commit history is part of the score.

### 9.3 Why this file is the whole judge story

It is committed, so Vercel needs no Kane, no Chrome, no credentials and no network. It is schema-validated at build time, so a malformed snapshot fails loudly at build rather than rendering a lie. It contains the evidence *paths* rather than the evidence, and the packs are committed under `apps/ledger/public/evidence/`, so artefact links are plain static URLs with no route handler in front of them.

---

## 10. Ledger application and design system

### 10.1 Routes

| Route | Kind | Contents |
|---|---|---|
| `/` | static (SSG) | Graph hero, metric rail, freshness chip, promise side panel via `?p=<id>` |
| `/coverage` | static | Public shareable page: both coverage figures, freshness, every promise with verdict (R9.8) |
| `/amendments` | static | Pending `docs-lie` diffs with accept controls |
| `/reviews` | static | Review cards with promise id, branch, evidence ref (R7.7) |
| `/runs` | static | Terminal-event log: family, command, status, result code, credits, exit meaning |
| `/badge.svg` | `route.ts`, **GET only** | `image/svg+xml`, proven coverage as a whole-number percentage |

Every page is statically rendered from the imported snapshot. There is no `POST`/`PUT`/`PATCH`/`DELETE` handler, no server action, no `middleware.ts`, no `child_process` import, no auth (R8.4, R8.5, R8.6). `scripts/check-readonly.mjs` asserts all of that by scanning `apps/ledger` and runs both in the test suite and in the build script.

Snapshot loading:

```ts
// apps/ledger/lib/snapshot.ts
import raw from '../data/ledger.snapshot.json';
import { parseSnapshot } from '@kept/core';
export const snapshot = parseSnapshot(JSON.stringify(raw));   // throws at build → build fails (R8.8)
```

### 10.2 Component tree

```
app/layout.tsx           tokens.css + surfaces.css, system font stack, ink background, skip-link
app/page.tsx
 ├── MetricRail          ProvenCoverage | DesignedCoverage | SuiteDebt | FreshnessChip | DegradedChip
 │    └── MetricFigure   tabular-numeral figure; counts up via lib/motion.ts   (§10.6.2)
 ├── PromiseGraph        @xyflow/react, nodes from lib/layout.ts, keyboard-navigable
 │    └── PromiseNode    id chip (mono) · claim (2 lines) · citation path:line (mono) · VerdictTag
 ├── PromisePanel        opens on selection / ?p=; verbatim claim, designed test, verdict,
 │                       evidence artefact links, repair annotation
 └── LiveNdjsonPane      dev-only, xterm, hidden in production   (nice-to-have §18)

lib/motion.ts            the ONLY anime.js entry point; owns the reduced-motion branch (§10.6.4)
lib/tokens.ts            typed mirror of tokens.css; the contrast test's input (§10.4.4)
```

### 10.3 Graph layout — deterministic lanes, no layout engine

```ts
// apps/ledger/lib/layout.ts
// x by lane: documents 0, promises 1, designed tests 2, evidence 3
// y within lane: stable sort by (verdict rank, id) → rank: red 0, stale 1, undesigned 2, proven 3
const LANE_X = [0, 360, 760, 1080];
const ROW_H = 92;
```

Red promises sort to the top, so the thing that needs attention is where the eye lands. The layout is a pure function of the snapshot, so it is identical on every render and every machine — no physics settling, no jitter between screenshots, and the graph in the video matches the graph in the deployed build. React Flow is used for panning, zooming, edges and viewport only.

Motion is layered **on top of** this pure layout and never feeds back into it: the staggered entrance in §10.6.1 animates opacity and a small transform offset from the computed final position, so the resting state is byte-identical to the no-motion render. Screenshots taken after the entrance completes are pixel-identical to screenshots taken with motion disabled.

### 10.4 The visual system — a specific palette, measured

The old token set was a generic near-black-blue with mint/amber/red signal colours. It is replaced. The brief is explicit: detailed, minimal, stylish; **no AI-slop colour**; real shading and lighting; a distinctive palette that is neither neon nor bright. What follows is that palette with every ratio measured rather than eyeballed.

**The direction.** A deep desaturated **ink** base carrying a faint warm mineral cast — hue around 35–40°, saturation under 12% — so the page reads as dark *paper under a warm lamp* rather than dark *screen*. Verdict hues are drawn from oxidised material: **patina** for proven, **ochre** for stale, **clay/oxide** for red, **stone-sage** for undesigned. They are muted, but chosen luminous enough to clear 4.5:1 — muted-and-dim would have failed R10.6, so every verdict hue sits in the 5–8.5:1 band on the page surface.

**Explicitly forbidden, and asserted by the token scan:** neon; any `#00FF…`-family hue; the purple→blue AI-startup gradient; glassmorphism `backdrop-filter: blur()`; rainbow or multi-hue scales; emoji as UI; saturation above 70% anywhere; a `box-shadow` with a coloured or glowing colour value.

#### 10.4.1 Tokens

`apps/ledger/styles/tokens.css`, mirrored as typed constants in `lib/tokens.ts` so tests can compute contrast against the same values the browser sees.

```css
:root {
  /* ── ink surfaces: one hue family, warm, 4-step ramp ─────────────── */
  --ink-000: #14120F;   /* page                                            */
  --ink-050: #1B1815;   /* sunken: panel base, rail trough, code wells     */
  --ink-100: #221E1A;   /* raised: nodes, cards, chips                     */
  --ink-150: #2A251F;   /* raised-2: hover, active row, selected node fill  */
  --hairline:        #302A24;   /* 1px structural rules      — 1.32:1, non-text */
  --hairline-strong: #3A332B;   /* section divisions          — 1.50:1, non-text */

  /* ── light: one implied source, top-left, 15° off vertical ───────── */
  --light-edge:        rgba(246, 238, 226, 0.075);  /* 1px top edge, raised   */
  --light-edge-strong: rgba(246, 238, 226, 0.115);  /* 1px top edge, raised-2 */
  --light-wash:        rgba(246, 238, 226, 0.028);  /* large-plane gradient   */
  --occlude:           rgba(6, 5, 4, 0.55);         /* shadow ink, warm-black */

  /* ── text ────────────────────────────────────────────────────────── */
  --text-000: #F2EDE4;  /* body, headings, claim text                       */
  --text-100: #B6ADA0;  /* secondary body, panel supporting copy            */
  --text-200: #9A9184;  /* labels, citations, gutters                       */

  /* ── verdicts: oxidised material, the only chromatic channel ─────── */
  --verdict-proven:     #6FB894;  /* patina           */
  --verdict-stale:      #D9A64A;  /* ochre            */
  --verdict-red:        #D97A66;  /* clay / iron oxide */
  --verdict-undesigned: #9A9184;  /* stone-sage, deliberately unsaturated (R10.3) */

  /* verdict washes: verdict hue at low alpha. Rails, node left-edges and
     tag borders ONLY — never behind body text, so no wash enters the
     contrast matrix. */
  --wash-proven:     rgba(111, 184, 148, 0.10);
  --wash-stale:      rgba(217, 166,  74, 0.10);
  --wash-red:        rgba(217, 122, 102, 0.12);
  --wash-undesigned: rgba(154, 145, 132, 0.08);

  /* structural accent: focus rings only, never a state signal */
  --focus: #7FA6BC;   /* muted mineral blue */

  /* ── elevation ramp: light behaviour, not uniform box-shadow ─────── */
  --elev-0: none;
  --elev-1: 0 1px 0 0 var(--light-edge) inset,
            0 1px 2px -1px var(--occlude),
            0 2px 6px -3px var(--occlude);
  --elev-2: 0 1px 0 0 var(--light-edge-strong) inset,
            0 2px 4px -2px var(--occlude),
            0 8px 20px -8px var(--occlude);
  --elev-3: 0 1px 0 0 var(--light-edge-strong) inset,
            0 4px 10px -4px var(--occlude),
            0 24px 48px -20px var(--occlude);

  /* ── type scale (16px root) ──────────────────────────────────────── */
  --fs-micro: 0.6875rem;  /* 11px  ids, tags                    */
  --fs-xs:    0.75rem;    /* 12px  citations                    */
  --fs-sm:    0.8125rem;  /* 13px  labels                       */
  --fs-base:  0.875rem;   /* 14px  body                         */
  --fs-md:    1rem;       /* 16px  panel headings               */
  --fs-lg:    1.25rem;    /* 20px  section headings             */
  --fs-xl:    1.75rem;    /* 28px  page title                   */
  --fs-metric:2.5rem;     /* 40px  coverage figures             */

  --lh-tight: 1.2;  --lh-body: 1.55;  --lh-mono: 1.45;
  --tr-tight: -0.011em;   /* display sizes only */
  --tr-mono:   0.002em;   /* mono at small sizes, opens the counters */

  /* ── spacing: 4-based, no other values permitted ─────────────────── */
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
  --s-6: 24px; --s-8: 32px; --s-12: 48px; --s-16: 64px;

  --r-chip: 2px; --r-card: 6px; --r-panel: 10px;

  /* ── motion tokens: see §10.6 ────────────────────────────────────── */
  --dur-micro:    90ms;   /* focus ring, tag tint            */
  --dur-fast:    160ms;   /* selection outline, hover surface */
  --dur-base:    240ms;   /* panel, verdict colour            */
  --dur-slow:    420ms;   /* verdict flip, edge draw          */
  --dur-figure:  760ms;   /* metric count-up                  */
  --stagger-node: 24ms;   /* per-node entrance offset         */

  --ease-out:      cubic-bezier(.16, .84, .28, 1);   /* settle: the default   */
  --ease-in-out:   cubic-bezier(.50, .00, .20, 1);   /* move between two rests */
  --ease-emphasis: cubic-bezier(.20, .90, .10, 1);   /* verdict flip           */

  /* ── type families — system stacks, zero downloads ───────────────── */
  --font-ui:   ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
```

#### 10.4.2 Measured contrast

Every ratio below is computed, not estimated. Body text needs ≥4.5:1 and graph node labels ≥3:1 (R10.6, Property 22) — both thresholds hold on **every** surface in the ramp, including `--ink-150`, so a hovered or selected node cannot drop a pair below threshold.

| Foreground | Hex | on `--ink-000` | on `--ink-050` | on `--ink-100` | on `--ink-150` | Used for |
|---|---|---|---|---|---|---|
| `--text-000` | `#F2EDE4` | **16.03** | 15.16 | 14.20 | 13.02 | body, headings, claim text |
| `--text-100` | `#B6ADA0` | **8.44** | 7.97 | 7.47 | 6.85 | secondary body |
| `--text-200` | `#9A9184` | **6.02** | 5.69 | 5.33 | 4.89 | labels, citations, gutters |
| `--verdict-proven` | `#6FB894` | **7.98** | 7.54 | 7.06 | 6.48 | proven tag text, node label |
| `--verdict-stale` | `#D9A64A` | **8.46** | 8.00 | 7.49 | 6.87 | stale tag, freshness > 24 h |
| `--verdict-red` | `#D97A66` | **6.17** | 5.83 | 5.46 | 5.01 | red tag, diff deletions |
| `--verdict-undesigned` | `#9A9184` | **6.02** | 5.69 | 5.33 | 4.89 | undesigned tag |
| `--focus` | `#7FA6BC` | **7.20** | 6.80 | 6.37 | 5.85 | 2px focus ring only |

Lowest value anywhere in the matrix: **4.89:1** (`--text-200` / `--verdict-undesigned` on `--ink-150`), which clears the 4.5:1 body-text floor with margin and the 3:1 label floor comfortably. Non-text tokens are excluded from the matrix by construction and named as such: `--hairline` (1.32:1) and `--hairline-strong` (1.50:1) are 1px rules, never text and never the sole carrier of meaning.

Badge inversion (§10.11) puts `--ink-000` **on** a verdict fill: proven 7.98:1, stale 8.46:1, red 6.17:1, undesigned 6.02:1. All pass in both directions, which is why the same four tokens serve as background there.

#### 10.4.3 Rules the implementation must not drift from

- **Colour is the verdict channel.** No coloured buttons, no brand colour, no gradient hero. `--focus` is the single non-verdict chromatic token and appears only as a 2px ring.
- **Every verdict carries a word.** `VerdictTag` always renders the text `proven` / `red` / `stale` / `undesigned` beside its colour (R10.5). No colour-only state anywhere, ever.
- **Verdict washes never sit behind body text.** They are permitted on a node's 3px left edge, a rail tile's trough, and a tag's 1px border. This keeps the contrast matrix finite and testable.
- **Depth is light, not outline-plus-shadow-on-everything.** See §10.5.
- **Density**: node 320×76, rail tile 240×124, panel width 440px, page max width 1680px, `min-width` never set — the graph canvas flexes, so no horizontal overflow appears between 1280 and 1920 (R10.8).

#### 10.4.4 How the palette is enforced

`lib/tokens.ts` is the typed mirror and the test's input:

```ts
export const TOKENS = { /* every value above, as literals */ } as const;
/** Every foreground/background pair the components actually use. */
export const CONTRAST_PAIRS: Array<{ fg: keyof typeof TOKENS; bg: keyof typeof TOKENS;
                                     role: 'body' | 'node-label' | 'non-text' }> = [ /* … */ ];
```

Three tests, all cheap:

1. **Contrast** — computes the WCAG ratio for every entry in `CONTRAST_PAIRS`, requiring ≥4.5 for `body`, ≥3 for `node-label`, and asserting `non-text` pairs are never used for text by cross-checking the component scan. Property 22.
2. **Parity** — every `--custom-property` in `tokens.css` has a `TOKENS` entry with an identical value, and vice versa. A palette change cannot drift the test's input away from the browser's.
3. **Forbidden-palette scan** — fails on `backdrop-filter`, on any hex whose computed saturation exceeds 70%, on a `linear-gradient` mixing more than two hue families, on a `box-shadow` whose colour is not `--occlude` or a `--light-edge*` token, and on any emoji codepoint in `apps/ledger/**`.

### 10.5 Light, shading and elevation

One implied light source: **above and slightly left, 15° off vertical, warm.** Everything visual derives from it, consistently, and nothing is lit ad hoc.

| Consequence of the light | Implementation |
|---|---|
| Raised surfaces catch light on their **top edge** | 1px `inset` highlight, `--light-edge` at elevation 1, `--light-edge-strong` at 2 and 3. This is the single most legible depth cue and it costs nothing |
| Raised surfaces **occlude** what is under them | Two stacked shadows per level: a tight contact shadow with a negative spread, and a wide soft ambient one. Both use `--occlude`, a warm near-black — never grey, never coloured |
| Large planes are **not flat-lit** | A single `linear-gradient(176deg, var(--light-wash), transparent 62%)` on the page shell and the panel. 176° rather than 180° so the falloff is off-axis, matching the 15° source. Amplitude is 2.8% — felt, not seen |
| Recessed wells read as **cut into** the surface | Inverted ramp: 1px inset shadow on top, 1px `--light-edge` on the *bottom*. Used for the citation well and the diff gutter |
| Depth ranks by **function**, not decoration | `--elev-0` page shell · `--elev-1` nodes, rail tiles, chips · `--elev-2` promise panel, amendment cards · `--elev-3` nothing by default; reserved for a future overlay |

Explicitly not done: no uniform `box-shadow: 0 2px 4px rgba(0,0,0,.2)` sprayed on every box; no glow, ever, including on hover and on the red verdict; no `backdrop-filter` blur; no double borders; no shadow used to fake a border.

The gradients and shadows live in `styles/surfaces.css` as three classes — `.surface-raised`, `.surface-raised-2`, `.surface-well` — so a component picks an elevation rather than authoring a shadow. The forbidden-palette scan (§10.4.4) makes an inline `box-shadow` outside that file a test failure.

### 10.6 Motion system — orchestrated, not decorative

The previous two-duration policy ("motion only on state change, no entrance animations") was correct about discipline and wrong about ambition. It is replaced by a small motion system with named tokens and five specific orchestrations, each of which exists because it carries information CSS transitions cannot express well: sequence, stagger, numeric interpolation, and path progression.

`animejs@4.5.0` ([§2.2](#22-dependency-budget)) is the engine. Imports are named and narrow:

```ts
import { animate, createTimeline, stagger, svg, utils, eases } from 'animejs';
```

#### 10.6.1 Graph entrance — staggered, once

On first paint of `/`, nodes arrive in lane order with a 24 ms stagger, from the layout's computed final position:

```ts
// nodes are already AT their final coordinates; only opacity and a 6px lift animate
timeline.add('.promise-node', {
  opacity: [0, 1],
  translateY: [6, 0],
  duration: 420,
  ease: 'cubicBezier(.16,.84,.28,1)',
  delay: stagger(24, { from: 'first' }),
});
```

Lane order means documents settle, then promises, then designed tests — the reading order of the graph, so the entrance *teaches the graph's structure* rather than decorating it. Total elapsed is capped: `min(nodeCount × 24ms, 620ms)`, after which remaining nodes appear together. A 200-promise graph therefore never makes a judge wait. Runs **once per session**, gated on a `sessionStorage` flag, so navigating back to `/` does not replay it.

#### 10.6.2 Metric count-up

`MetricFigure` interpolates from 0 to its value over `--dur-figure`, `--ease-out`, using `utils.set` on each frame with the value formatted through the same formatter the static render uses — so the final frame is character-identical to the no-motion render. Tabular numerals (§10.7) mean no digit reflow during the count. Guard: the DOM carries the **final** value in its accessible name from first paint, so a screen reader is never read an intermediate number.

#### 10.6.3 Verdict flip, panel, and edge progression

| Orchestration | What animates | Duration / easing | Why it is not decoration |
|---|---|---|---|
| **Verdict flip** | tag colour `--verdict-*` → `--verdict-*`, tag scale `1 → 1.06 → 1`, node left-edge wash cross-fade, all on one timeline | `--dur-slow`, `--ease-emphasis` | A promise changing state is *the* event this product exists to show. The scale pulse marks it in peripheral vision without a colour flash |
| **Panel** | coordinated slide (`translateX 16 → 0`) + fade, with the panel's three sections staggered 40 ms behind the container | `--dur-base`, `--ease-out` | The stagger establishes that the claim is the subject and the evidence links are its detail |
| **Edge progression** | `svg.createDrawable` on the edge path between a promise and its designed test, drawn 0 → 100% when that path carried a verdict change; a single 1.4 s pulse, not a loop | `--dur-slow` draw | Shows *which* test moved the verdict — causality the static graph can only imply |
| **Selection outline** | 2px outline colour + 1px offset | `--dur-fast`, `--ease-out` | Plain CSS transition; anime.js is not involved |
| **Focus ring** | ring opacity | `--dur-micro` | Plain CSS transition |

Forbidden, and scanned for: hover bounce or hover scale; skeleton shimmer; parallax; any looping or ambient animation; `animation-iteration-count` above 1; spring physics on layout; motion on scroll; anything animating `width`, `height`, `top` or `left` (compositor-only properties — `opacity` and `transform` — or nothing).

#### 10.6.4 The reduced-motion path is a specified state, not a fallback

`lib/motion.ts` is the only module that imports `animejs`, and every orchestration goes through one gate:

```ts
// apps/ledger/lib/motion.ts
export type MotionSpec = {
  /** The end state, expressed as properties. Applied instantly when motion is off. */
  to: Record<string, string | number>;
  /** The animation, built only when motion is on. */
  run: () => { then: (f: () => void) => void };
};

export const motionEnabled = (): boolean =>
  typeof window !== 'undefined' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function play(targets: string | Element | Element[], spec: MotionSpec): Promise<void> {
  if (!motionEnabled()) { utils.set(targets, spec.to); return Promise.resolve(); }
  return new Promise(res => spec.run().then(res));
}
```

The contract, which is what makes reduced motion a *state*:

- Under `prefers-reduced-motion: reduce`, **every** orchestration resolves to its end state **synchronously on first paint**. Nodes are at opacity 1. Metric figures show their final value. The panel is open at `translateX(0)`. Edges are fully drawn. Verdict tags are at their final colour and scale 1.
- The reduced-motion render and the post-animation render are **the same DOM and the same computed styles**. That is asserted directly: a jsdom test renders `/` under both media states and compares the resolved style of every animated property.
- CSS-level insurance, kept because a media-query change mid-session must not leave a half-played transition:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0ms !important; animation-iteration-count: 1 !important;
      transition-duration: 0ms !important; scroll-behavior: auto !important;
    }
  }
  ```
- The media query is observed live (`addEventListener('change')`), so toggling the OS setting takes effect without a reload, and any in-flight timeline is completed immediately rather than cancelled mid-way — cancelling would leave the DOM in an intermediate state, which is exactly the thing being prevented.
- Nothing in the Ledger's *information* is carried by motion. Every verdict, figure, citation and link is present and correct with motion fully disabled. Motion is the Craft dimension; the Verified dimension does not depend on a single frame.

The CSS motion scan (R10.4) is retained and widened: it asserts the reduced-motion block exists, that every `transition` and `animation` declaration in `apps/ledger/**` targets `opacity`, `transform`, `color`, `background-color`, `border-color`, `outline-color` or `box-shadow` and nothing else, and that no `animation-iteration-count` exceeds 1.

### 10.7 Typography and density

The scale is unchanged in its values and refined in its application.

- **Monospace as texture, not as default.** `--font-mono` is used for exactly: promise ids, citation `path:line`, designed test ids, Kane `result_code` and `reason_code`, credit figures, ISO timestamps, member statuses, diff bodies, and every metric numeral. Prose — claim text, rationale, panel copy, page headings — is `--font-ui`. The contrast between the two is the page's main typographic device, so spending mono on prose would flatten it. A component scan lists mono-classed elements and fails on any element whose text content is a sentence (contains a space-separated run of four or more non-identifier words).
- **Tabular, lining numerals wherever a number animates or aligns.** `font-variant-numeric: tabular-nums lining-nums` on `MetricFigure`, the credits column, the run table's durations, and the diff gutter. Non-negotiable: the count-up in §10.6.2 would jitter with proportional digits.
- **Optical alignment on the metric rail.** The `%` sign is set at `--fs-lg` with `vertical-align: baseline` and a `-0.06em` right margin, so the *digits* — not the glyph run — align to the tile's optical left edge across all four tiles. `n/a` is set at `--fs-lg` and baseline-aligned to the digits it replaces, so a degraded rail does not change the rail's rhythm. Tile labels sit on a 4px baseline grid shared with the digits.
- **Line length and leading.** `--lh-body` 1.55 for prose, `--lh-mono` 1.45 for mono, `--lh-tight` 1.2 at `--fs-xl` and above. Prose columns cap at 72ch; the claim text in a node clamps to 2 lines with `text-overflow: ellipsis` and carries the full text in `title` and in the panel.
- **Letter-spacing** `--tr-tight` at display sizes only, `--tr-mono` on mono below `--fs-sm` to open the counters. Nowhere else.

### 10.8 Keyboard model (R10.7)

- Graph container is `role="application"` with a visible focus ring; `Tab` enters it, arrow keys move between promise nodes in lane order, `Enter`/`Space` selects and opens the panel, `Escape` closes it and returns focus to the node.
- A parallel `role="list"` of promises is always present in the DOM (visually a compact sidebar list), so keyboard and screen-reader users are never dependent on the canvas.
- `AcceptControl` is a native `<button>` with an accessible name naming the amendment: `Accept amendment am_3b9d21f0 for README line 20`.
- Skip link to main content as the first focusable element.

### 10.9 Diff rendering

`lib/diff.ts` is a ~60-line line-level unified diff (LCS over ≤200 lines is instant) producing `{kind:'ctx'|'del'|'add', text}[]`. `DiffView` renders it in monospace with `--verdict-red` for deletions, `--verdict-proven` for additions, `--text-200` for gutter line numbers, and the `.surface-well` treatment (§10.5) so the diff reads as cut into the card rather than stacked on it. Deleted and added rows carry `--wash-red` / `--wash-proven` at the row's left 3px edge only, never as a full-row background, so the contrast matrix stays finite. Because the docs-lie diff is nearly always a single line, this looks identical to what a syntax highlighter would produce for prose. Shiki is a droppable upgrade (§18), not a dependency.

### 10.10 Degraded and empty states

- `degraded === true` → `DegradedChip` reading `baseline data only`, and the Proven Coverage tile is **replaced** by the chip rather than showing a number (R2.11). The chip takes the tile's exact footprint so the rail's rhythm is unchanged, and `MetricFigure`'s count-up does not run for a tile that has no figure.
- `totalPromises === 0` → both figures render the literal `n/a`, no division performed (R9.3), baseline-aligned to the digits they replace (§10.7).
- `freshness.terminalEventAt === null` → chip reads `never verified` in `--text-200`.
- Age > 24 h → chip in `--verdict-stale` ochre (R9.7); the boundary is `> 24h`, so exactly 24 h is not ochre. The colour change uses `--dur-base` only when the value actually changes client-side; on a static render it is simply the initial colour.

### 10.11 Badge

```ts
// apps/ledger/app/badge.svg/route.ts
export const dynamic = 'force-static';
export function GET() {
  const pct = snapshot.metrics.provenCoverage === null
    ? 'n/a' : `${Math.round(snapshot.metrics.provenCoverage * 100)}%`;
  return new Response(svg(pct), { headers: { 'content-type': 'image/svg+xml',
                                             'cache-control': 'public, max-age=300' } });
}
```

A hand-written 110×20 SVG: label `promises kept` on `--ink-100`, value `pct` on a verdict fill — `--verdict-proven` when ≥80%, `--verdict-stale` 40–79%, `--verdict-red` below 40%, `--verdict-undesigned` for `n/a` — with the value text in `--ink-000`. Those inverted pairs are measured in §10.4.2 and all clear 6:1. No gradient, no logo, no shadow: an SVG served as an image cannot rely on the page's light model, so it is deliberately flat. Only `GET` is exported (R9.4, R9.5).

---

## 11. Kiro hooks and the closed loop

### 11.1 Hook files

`.kiro/hooks/kept-code-verify.json`

```json
{
  "enabled": true,
  "name": "KEPT · verify blast radius",
  "description": "On fixture source save, re-verify only the promises whose designed tests cover the changed file, then act on the verdict.",
  "version": "1",
  "when": {
    "type": "fileEdited",
    "patterns": [
      "apps/fixture/app/**/*.tsx",
      "apps/fixture/app/**/*.ts",
      "apps/fixture/components/**/*.tsx",
      "apps/fixture/lib/**/*.ts"
    ]
  },
  "then": {
    "type": "askAgent",
    "prompt": "Run `node bin/kept verify --changed <the saved file paths>`. Then read `.kept/handoff.json`. If `nextAction.branch` is `code-break`, fix the product code so the cited claim holds again: edit only files matching `nextAction.allowedPaths`, never a path in `nextAction.forbiddenPaths`, and use `results[].citation.text` as the specification. Save your edit — that re-fires this hook and the second verification closes the loop. If `nextAction.branch` is `test-drift`, run `node bin/kept evolve <designedTest.path>` and stop; the change is held as a review card. If `nextAction.branch` is `docs-lie`, run `node bin/kept amend propose --run <runId>` and stop; never edit documentation directly. If `outcome.terminalSeen` is false, or `outcome.exitMeaning` is `paused-resumable`, `killed-by-timeout` or `preflight-rejected`, report the diagnostic and change nothing."
  }
}
```

`.kiro/hooks/kept-docs-reconcile.json`

```json
{
  "enabled": true,
  "name": "KEPT · reconcile docs",
  "description": "On fixture documentation save, reconcile the promise graph and report what the suite now owes.",
  "version": "1",
  "when": {
    "type": "fileEdited",
    "patterns": ["apps/fixture/README.md", "apps/fixture/docs/**/*.md"]
  },
  "then": {
    "type": "askAgent",
    "prompt": "Run `node bin/kept reconcile --changed <the saved file paths>`. The CLI resolves the Kane source id for each changed document itself and passes `--from` and `--source-id`; never invent a source id and never pass one on the command line. Then read `.kept/handoff.json` and report: the count of promises with verdict `undesigned` (the suite debt), each newly added claim with its citation, each removed promise, and every open review card. Do not edit documentation, tests or source. Never run `kept reconcile apply` — applying a stored plan is a human decision. If a diagnostic reports `reconcile-source-unresolved`, report it and quote the suggested `kane-cli context ingest` command; change nothing. If `outcome.exitMeaning` is `paused-resumable`, say so and stop."
  }
}
```

The two pattern sets are disjoint by construction (source extensions vs `.md`), which is a property test — no save may fire both hooks (R11.2, R11.3).

### 11.2 The handoff file — the closed-loop contract

`.kept/handoff.json` (always the newest) plus an immutable copy at `.kept/handoff/<runId>.json` (R11.7).

```jsonc
{
  "schemaVersion": 1,
  "runId": "tr_20260820T184011Z",
  "writtenAt": "2026-08-20T18:40:44.902Z",
  "trigger": { "hook": "kept-code-verify", "event": "fileEdited",
               "paths": ["apps/fixture/lib/cart.ts"] },
  "command": { "family": "ExecutionTestrun",
               "argv": ["testrun","run","--from-context","T-3","--on-failure","continue"],
               "ndjsonEnabledBy": "piped-stdout" },
  "outcome": {
    "terminalSeen": true, "terminalEventType": "testrun_done",
    "exitCode": 1, "exitMeaning": "failure", "timedOut": false,
    "resultCode": 740, "reasonCode": "failure.product_bug", "credits": 0
  },
  "blastRadius": { "testIds": ["T-3"], "promiseIds": ["p_9f2c1a4b7d33"], "unmatchedPaths": [] },
  "results": [{
    "promiseId": "p_9f2c1a4b7d33",
    "testId": "T-3",
    "designedTest": "tests/cart_subtotal_test.md",
    "memberStatus": "failed",
    "verdict": "red",
    "citation": { "file": "apps/fixture/README.md", "line": 16,
                  "text": "- The Cart screen shows a running subtotal that updates immediately when a quantity changes." },
    "repair": { "branch": "code-break", "strategy": "resultCode740", "severity": "high",
                "category": "functional", "confidence": 0.9,
                "evidenceRef": "evidence/ev_20260820T184011Z/failure.yaml",
                "rationale": "Verdict object confirmed a product bug (result_code 740)." },
    "verdictObject": { "confirmed": true, "family": "functional", "category": "state_not_updated",
                       "severity": "high", "one_liner": "subtotal did not change after quantity increment",
                       "confidence": 0.9 },
    "evidenceDir": "/Users/nokitha/Desktop/KEPT/.testmuai/evidence/ev_20260820T184011Z",
    "artifacts": { "annotated": "…/annotated.png", "failureYaml": "…/failure.yaml",
                   "screenshots": ["…/step-3.png","…/step-4.png"] }
  }],
  "nextAction": {
    "branch": "code-break",
    "instruction": "Restore the behaviour the cited claim describes. Edit product source only.",
    "allowedPaths": ["apps/fixture/app/**", "apps/fixture/components/**", "apps/fixture/lib/**"],
    "forbiddenPaths": ["apps/fixture/README.md", "apps/fixture/docs/**", "tests/**",
                       "apps/ledger/**", "packages/**"]
  },
  "diagnostics": []
}
```

`nextAction.allowedPaths`/`forbiddenPaths` are what make branch-specific autonomy real rather than rhetorical: on `code-break` the agent is fenced out of documentation and tests, so the loop cannot "fix" a red promise by editing the claim. The file is written for **every** run, including crashed, paused and preflight-rejected ones, with `nextAction.branch: null` and a populated `diagnostics` array — so the agent always has something to read and never has to infer silence.

### 11.3 The demonstrable loop (R11.6)

```
1. edit apps/fixture/lib/cart.ts            (break the subtotal recompute)
2. kept-code-verify fires  → kane-cli testrun run --from-context T-3
3. testrun_done · member failed · result_code 740 · verdict red     → snapshot + handoff
4. agent reads handoff, branch=code-break, patches apps/fixture/lib/cart.ts
5. save re-fires the hook   → kane-cli testrun run --from-context T-3
6. testrun_done · member passed · verdict proven                    → snapshot + handoff
```

Committed as `.kept/handoff/<runId>.json` × 2 plus the patch diff, and reflected in `snapshot.runs[]` where both terminal events are visible on `/runs`.

---

## 12. Fixture application

**Kepler Coffee** — a coffee subscription shop. Next.js App Router, all state in `localStorage`, no API routes, no database, no `fetch` (R12.2). Port 3100 via `next dev -p 3100` / `next start -p 3100` (R12.3).

### 12.1 Screens (7, inside the 6–8 band)

| Route | Screen | Behaviour that matters |
|---|---|---|
| `/` | Home | Hero, three featured beans, primary CTA to Shop |
| `/shop` | Shop | Exactly six coffees, roast filter (light/medium/dark) applied client-side |
| `/product/[slug]` | Product | Detail, price rendered in the currency chosen in Settings, add-to-cart |
| `/cart` | Cart | Quantity steppers, running subtotal, remove line |
| `/checkout` | Checkout | Name/email/address form, client validation, places order into localStorage |
| `/orders` | Orders | Order history from localStorage, survives reload |
| `/settings` | Settings | Currency toggle (USD/EUR/GBP), persisted |

State modules: `lib/catalog.ts` (six static products), `lib/cart.ts` (`addItem`, `setQuantity`, `subtotal`), `lib/currency.ts` (`format`, rate table), `lib/storage.ts` (namespaced localStorage with a JSON round-trip).

### 12.2 README claims — verbatim, one per line

`apps/fixture/README.md` contains exactly this claims block, one claim per line so a citation line number identifies exactly one claim (R12.4, R12.5):

```markdown
## What Kepler Coffee promises

- The Home screen links to the Shop screen from its primary call to action.
- The Shop screen lists exactly six coffees and filters them by roast level without a page reload.
- The Product screen shows the price in the currency selected on the Settings screen.
- The Cart screen shows a running subtotal that updates immediately when a quantity changes.
- The Checkout screen refuses to submit while the email field is empty and names the offending field.
- The Orders screen lists every completed order and still lists them after a full page reload.
- The Settings screen keeps the selected currency after a full page reload.
- The Cart screen applies a 10 percent discount automatically when the subtotal exceeds 50 dollars.
```

Eight claims, eight promises, eight designed tests in `tests/`.

- **Breakable claim (R12.6)**: the subtotal claim, verified by `tests/cart_subtotal_test.md` (`T-3`). The break is one edit in `apps/fixture/lib/cart.ts`:
  ```ts
  // export const subtotal = (items) => items.reduce((n, i) => n + i.price * i.qty, 0);
  export const subtotal = (items) => (items.length ? items[0].price : 0);   // ← the break
  ```
  Cart renders a subtotal that ignores quantity. Kane's assertion fails, `testrun_member_end.status: failed`, the router returns `code-break`, the agent restores the reduce. This is the on-camera loop.
- **Never-true claim (R12.7)**: the 10 percent discount claim, verified by `tests/cart_discount_test.md` (`T-7`). No discount logic exists anywhere in the fixture and none will be added. Kane asserts a discounted total at subtotal > 50, the app behaves correctly and shows the undiscounted total, the selector resolves, the assertion fails → `docs-lie` → a `DocsAmendment` proposing `- The Cart screen shows the order total with no automatic discounts.` at that line. This is the novel branch and the second half of the video.

The landing screen renders well inside 30 s of `npm run demo` — it is a static page with no data fetching (R12.8).

---

## 13. KEPT CLI surface

### 13.1 Command table

`bin/kept` → `packages/kept-cli/dist/index.js`. Hand-rolled arg parsing, no dependency. Every command exits **0** unless the CLI itself is broken or was invoked with mutually exclusive flags (the sole usage-error exit, §13.2.3); Kane's outcomes are data, not exit codes (R2.10).

| Command | Kane invocation (final argv after the invoker adds the enabler) | Family | Timeout | Writes |
|---|---|---|---|---|
| `kept build` | `kane-cli cover --json --mode agent` | Assurance | 60 s | state, snapshot |
| `kept verify --changed <p…>` | `kane-cli testrun run --dry-run` *(plan refresh, if stale)* then `kane-cli testrun run --from-context <ids> --on-failure continue` | ExecutionTestrun | 60 s / 300 s | state, handoff, snapshot |
| `kept verify --all` | `kane-cli testrun run --dry-run` *(plan refresh, if stale)* then `kane-cli testrun run <every plan member carrying a test_id> --on-failure continue` — **see §13.1.1** | ExecutionTestrun | 60 s / 900 s | state, handoff, snapshot |
| `kept reconcile --changed <p…>` | `kane-cli maintain reconcile --from <changedDoc> --source-id <resolvedId> --plan --mode agent` — **see §13.2; `--from` and `--source-id` are both mandatory** | Assurance | 300 s | state, source cache, review cards, handoff, snapshot |
| `kept reconcile apply [planPath]` *(human-only, never a hook)* | `kane-cli maintain reconcile --apply [planPath] --mode agent` | Assurance | 300 s | state, review cards, handoff, snapshot |
| `kept evolve <testPath>` | `kane-cli maintain evolve <ref> --mode agent` | Assurance | 300 s | review cards, handoff |
| `kept amend propose --run <runId>` | none | — | — | amendments, snapshot |
| `kept amend list \| show <id> \| accept <id> \| reject <id>` | none (`accept` triggers a rebuild → `kept build`) | — | — | cited doc file (accept only), amendments, snapshot |
| `kept snapshot` | none | — | — | snapshot only |
| `kept handoff [--run <id>]` | none | — | — | stdout only |
| `kept doctor` | `kane-cli --version` | — | 10 s | stdout only |
| `kept watch` *(nice-to-have)* | none | — | — | loopback accept listener + NDJSON tail |

Flags common to all: `--repo <root>` (default cwd), `--json` (machine-readable stdout), `--router <name>` (overrides config for one invocation), `--member-debug` (sets `KANE_TESTRUN_MEMBER_DEBUG=1` and captures `[member]` stderr lines — R4.12).

#### 13.1.1 Why `--all` names its members, and why its budget is 900 s

**This corrects an earlier version of this table, which gave `kept verify --all` the bare argv `kane-cli testrun run --on-failure continue` and a 300 s budget. Neither survives contact with 0.8.4.** Both figures are measured in `docs/kane/replay/`, where the run is committed.

**An unscoped `testrun run` is not free.** With no selection, Kane selects every `**/*_test.md` in the project: thirteen documents here, not eight — the corpus, the verdict spike's transcription, and the four `.testmuai/tests/*_test.md` documents Kane's own `design tests` wrote in stage 15.1. Those four have **no recording**, so replaying them *authors* them live, against a discount feature the fixture does not have. `npm run loop` on a fresh clone would spend a judge's credits on documents that mint no promise, which R4.6 and R13.6 forbid.

The plan already distinguishes them: a member's `test_id` is read from its recording's `.internal/meta.json`, so **no recording means no `test_id`**, and those members are exactly `radius.skippedNoTestId`. So `--all` names the members the plan gave an identifier — by **path**, positionally — and diagnoses each excluded member as `verify-suite-member-unidentified`.

**`--from-context` cannot carry that selection.** It resolves ids against the *assurance graph*, not against the plan: the plan's own `test_id` is a testcase UUID and is rejected with `--from-context: unknown id '…' — it does not resolve in the assurance graph` at exit 2, and the only ids it does resolve — `t-1`…`t-4` — name the four unauthored drafts. The corpus is unreachable through the flag. `--changed` keeps `--from-context` because R4.2 specifies it; the mismatch is recorded in `docs/kane/replay/README.md` rather than patched silently.

**The budget.** Nine cached members replay in 215–242 s wall-clock, so 300 s terminates the suite mid-flight — a `kane-timeout`, a crashed stream, and no verdict written at all. `--all` is a manual whole-suite operation rather than a save hook, so it takes `max(hookMs, 900 000)`; `--changed` keeps the configured `hookMs`.

**One more correction, to §7.2's trust gate.** `testrun run --dry-run` prints **one line** — the `testrun_plan` event — and exits 0. There is no `testrun_done`, because a dry run executes nothing and so has no execution to report done. Requiring the terminal event conjunctively discarded every plan the installed CLI can produce, which left `.kept/plan.json` unwritten and every radius empty. The gate is now: a **clean exit carrying a plan event** is a complete dry run and is cached; a truncated stream that *also* exited badly is still a crash and keeps the cache.

Root scripts:

```json
{
  "demo": "node scripts/demo.mjs",
  "loop": "node bin/kept verify --all --member-debug",
  "build:snapshot": "node bin/kept build && node bin/kept snapshot",
  "test": "vitest --run",
  "check": "node scripts/check-readonly.mjs && tsc -b && vitest --run"
}
```

`scripts/demo.mjs` spawns `next dev -p 3100` in `apps/fixture` and `next dev -p 3000` in `apps/ledger`, prints both URLs, forwards output with prefixes, and exits both children on `SIGINT`. Zero dependencies, zero Kane spawns (R13.2).

### 13.2 `kept reconcile` — the corrected invocation

**This is a correction to an earlier version of this design, which invoked `kane-cli maintain reconcile --mode agent` with no other arguments. That invocation cannot work.** Verified against the installed 0.8.4 by `kane-cli maintain reconcile --help`:

```
Options:
  --from <file>     The NEW version of the source document (a file path)
  --source-id <id>  The EXISTING source this file succeeds — its head moves;
                    see `kane-cli context list --type source`
  --plan            Preview: head-move lands, everything else STAGED into the stored plan
  --apply [path]    Walk a STORED plan. Bare = latest plan behind an approval prompt;
                    a path picks one; with --from it recomputes live
  --mode <mode>     interactive | agent | ci | override — TTY defaults to in-chat card
                    review; headless REQUIRES one
```

`--from` and `--source-id` are **both required on a fresh run**. The command validates its inputs fail-fast and **never guesses which source a file belongs to**. The old invocation would have exited 2 on every single save, every time — a silently dead docs branch that would have looked wired up until someone read the exit code.

#### 13.2.1 The invocation KEPT actually issues

```
kane-cli maintain reconcile
    --from apps/fixture/README.md          ← the changed doc, from the Docs_Hook's saved paths
    --source-id src_7f31c0a4               ← RESOLVED, never hardcoded (§13.2.2)
    --plan                                 ← preview; nothing commits suite-side (§13.2.3)
    --mode agent                            ← appended by the invoker from the Assurance contract
  family: Assurance · terminal: `done` · timeout: 300 s
```

- **`--from` comes from the hook, not from a constant.** `kept reconcile --changed <paths>` receives the Docs_Hook's saved-file paths verbatim. Normally that is the single path `apps/fixture/README.md`. Paths are normalised to repo-relative POSIX and filtered to the Docs_Hook pattern set; a save touching several docs produces **one invocation per changed doc**, sequentially, each with its own resolved source id. Zero changed docs after filtering → no invocation, one diagnostic, exit 0.
- **`--mode agent`** is still appended by the invoker from the contract (§4.7), unchanged. It is not optional: headless *requires* a mode, and `agent` is the one that yields the NDJSON stream the parser needs.

#### 13.2.2 Source-id resolution — `resolveSourceId`, and its cache

The source id is resolved at run time against the live store. Nothing is hardcoded, and no id is ever synthesised from a filename.

```ts
// packages/kept-core/src/context/sources.ts
export interface StoreSource {
  sourceId: string;
  path: string | null;        // repo-relative POSIX, normalised from whatever field carried it
  absPath: string | null;
  digest: string | null;      // content hash recorded at ingest, when the listing carries one
  retired: boolean;
  raw: unknown;               // the unprojected entry, kept for diagnostics
}

export type SourceResolution =
  | { ok: true;  source: StoreSource;
      via: 'cache' | 'exact-path' | 'abs-path' | 'digest' | 'unique-basename' | 'basename-slug' }
  | { ok: false; reason: 'no-store' | 'listing-unreadable' | 'crashed-stream'
                        | 'no-match' | 'ambiguous' | 'retired'; diagnostic: Diagnostic };

export async function resolveSourceId(args: {
  repoRoot: string; file: string; invoker: KaneInvoker; cache: SourceCache;
}): Promise<SourceResolution>;
```

**Listing invocation.** `kane-cli context list --type source --json`, **no family and no enabler**, 60 s budget. *Corrected against the installed 0.8.4 — observed, not assumed:* `context list` takes `--type`, `--inferred`, `--stale`, `--all`, `--json` and **no `--mode` flag at all**, so appending the Assurance enabler exits 1 with an empty stdout and `error: unknown option '--mode'`; its `--json` output is one plain JSON object per line rather than the `{type,v,verb}` envelope, and it never emits `done`. It is therefore not in `kane/family.ts`'s contract table and is invoked through `KaneInvoker.invokePlain`, which appends nothing and returns lines. A storeless directory answers on **stdout** with `error: no context store here (run `kane-cli context ingest <files>` first)` at exit 2, which is what `reason: 'no-store'` reads. Recorded at `docs/kane/reconcile/`. The source array is projected **tolerantly**, exactly as the `coverage` payload is (§5.3): walk the payload for any array of objects and accept an entry carrying a recognisable id (`source_id` | `id` | `sourceId`) plus optionally a path (`path` | `file` | `uri` | `source_path`), a digest (`digest` | `sha256` | `hash` | `content_hash`) and a lifecycle marker (`retired` | `status`). The store's internal schema is not pinned by observation, so it is not assumed.

**Match ladder, first hit wins, no fuzzy matching at any rung:**

| # | Rung | Rule |
|---|---|---|
| 1 | `exact-path` | Repo-relative POSIX path equality against the projected `path` |
| 2 | `abs-path` | Absolute-path equality after resolving both sides against `repoRoot` |
| 3 | `digest` | sha256 of the file's current bytes equals the entry's recorded digest |
| 4 | `unique-basename` | Basename equality **and exactly one candidate matches** |
| 5 | `basename-slug` | The file's slugified basename equals the slugified source id **and exactly one candidate matches** |

Rung 5 exists because Kane keys sources by content and slug, not by repository path — *observed*: the live listing publishes `id, cid, label, title, trust, fresh`, so there is no path key to compare, `cid` is not one of the digest spellings, and `apps/fixture/README.md` is reachable only through the `readme` id it minted at ingest. It is **last** so it can never shadow a stronger match, and it carries its own `via` string so the Ledger and the diagnostics never report a slug match as a path match.

Two or more candidates tying at the same rung is `ambiguous` — **not** a coin flip. Titles, use-case names and ordinal position are never used. A matched entry that is retired resolves to `reason: 'retired'` rather than being handed to Kane, so the fail-fast check below is never reached in the normal path.

**The cache.** `.kept/sources.json`, alongside `plan.json` and `state.json` in the existing working-state directory:

```jsonc
// .kept/sources.json
{
  "schemaVersion": 1,
  "refreshedAt": "2026-08-20T18:39:58.301Z",
  "listingSignature": "sha256:2c19…",          // hash of the projected listing; detects store churn
  "sources": [ /* StoreSource[] */ ],
  "byPath": {
    "apps/fixture/README.md": { "sourceId": "src_7f31c0a4", "via": "exact-path",
                                "digest": "sha256:9e0c…", "resolvedAt": "2026-08-20T18:39:58.301Z" }
  }
}
```

Read-through cache with the same discipline as `PlanCache` (§7.2): a `byPath` hit is used when it is younger than `maxAgeMs` (default 10 minutes) **and** the cited file's mtime is not newer than `resolvedAt`; otherwise the listing is refreshed. A refresh whose stream crashes **leaves the previous cache in place** and the previous entry is still honoured — a transient Kane hiccup must not turn a working docs branch into a no-op. The cache is `.kept/` state, so it is git-ignored and disposable; deleting it costs one extra `context list`.

**Failure mode when no matching source exists.** This is the case that matters, because it is the normal state of a repository whose README was never ingested:

```
resolveSourceId → { ok: false, reason: 'no-match' }
  1. Record diagnostic  code: 'reconcile-source-unresolved'  severity: 'warn'
        message: "no ingested source matches apps/fixture/README.md — run
                  `kane-cli context ingest apps/fixture/README.md` first"
        file: the changed doc
  2. Do NOT spawn kane-cli at all.            ← zero credits, zero process
  3. Create NO review card.                    (R5.7 is trivially satisfied: nothing produced)
  4. Leave every verdict and freshness.terminalEventAt unchanged.
  5. Write the handoff with nextAction.branch: null and the diagnostic attached.
  6. Exit 0.
```

`degraded` is **not** set by this path. `degraded` reports that the *proven axis* is untrustworthy, and an unresolved source loses no proven data — the baseline graph and every prior verdict are intact. The signal a reviewer sees is the diagnostic on `/runs`, naming the exact remedy. `no-store`, `listing-unreadable`, `crashed-stream`, `ambiguous` and `retired` take the same six steps with their own diagnostic code; only the message differs. All five are therefore one code path with one test, and none of them can move a verdict.

#### 13.2.3 `--plan` is the safe path, and it is the default

`--plan` previews: **the head-move lands, and everything else is STAGED into the stored plan.** Nothing commits suite-side. That is precisely the semantic R5.7 asks for — *hold every change, apply none automatically* — so KEPT does not implement holding on top of Kane, it uses Kane's own staging as the mechanism and mirrors the staged items into `.kept/review-cards/`. The hook path is `--plan`, always.

- The **head move does land** even under `--plan`. That is a mutation inside Kane's own `.context/` store, not in the KEPT repository, and it is what makes the new document version the source's head. It is recorded in the run diagnostics so a reviewer is never surprised by it.
- **`--apply` is never issued by a hook.** `kept reconcile apply [planPath]` is a deliberate human command: bare walks the latest stored plan behind Kane's approval prompt, a path selects a specific plan, and combining it with `--from` recomputes live. It is documented for the operator and absent from both hook prompts.
- **`--plan` and `--apply` together is a usage error.** They are mutually exclusive: one stages, the other walks what was staged. `kept` rejects the combination in its own arg parser *before* spawning, with a usage message and exit 2, so the invalid argv never reaches Kane. There is no code path in `kept` that can emit both flags.

#### 13.2.4 Fail-fast validation ordering

`maintain reconcile` validates in a fixed order and **exits 2 with nothing mutated** on the first failure. KEPT mirrors every check it can perform locally *before* spawning, so the common failures cost no process at all; the remaining store-side checks are surfaced verbatim from the `done` event's message. Order:

| # | Check | Where KEPT catches it | Result |
|---|---|---|---|
| 1 | `--from` present | own arg parser | exit 2, nothing mutated |
| 2 | `--source-id` present | resolution gate (§13.2.2) — no id, no spawn | exit 2, nothing mutated |
| 3 | `--from` file exists | `fs.stat` before spawn | exit 2, nothing mutated |
| 4 | `--from` is an ingestable type | extension allow-list before spawn | exit 2, nothing mutated |
| 5 | `--source-id` is a known source | match ladder — unknown ids never leave `resolveSourceId` | exit 2, nothing mutated |
| 6 | source is not retired | `retired` projection | exit 2, nothing mutated |
| 7 | **fork guard** — the file does not already back a *different live source* | listing scan: a second non-retired entry whose path or digest matches `--from` while its id differs from the resolved id | exit 2, nothing mutated |
| — | `--plan` + `--apply` | own arg parser (§13.2.3) | usage error, exit 2, never spawned |

The fork guard is the subtle one: it fires when one file has been ingested twice and now backs two live sources, so moving a head would silently fork the graph. Kane refuses; KEPT detects the same condition from the listing and reports it as `reconcile-source-forked` with **both** conflicting source ids in the diagnostic, which is the information a human needs to retire one of them.

Every one of these is a *refusal*, not a failure of KEPT: the CLI still exits **0**, the handoff is still written with `branch: null`, and no verdict moves. Kane's exit 2 is data (R2.10).

---

## Error Handling

### 14.1 Failure and degradation matrix

Read this as the definition of correct behaviour under adversity. `verdicts` means every existing promise verdict and `freshness.terminalEventAt`.

| Condition | Detected by | `exitMeaning` | Verdicts | `degraded` | CLI exit | Handoff | Ledger surface |
|---|---|---|---|---|---|---|---|
| Kane binary absent | `PATH` resolution | `kane-not-found` | unchanged | true | 0 | written, `branch: null` | `baseline data only` chip |
| Unauthenticated / auth error | `done.status: error` or non-zero exit with auth text in stderr tail | `failure` | unchanged | true | 0 | written with diagnostic | chip + diagnostic on `/runs` |
| Assurance paused (exit 3) | `done.status: paused` + `exit 3` | `paused-resumable` | **unchanged** | true | 0 | written, `branch: null`, `resumable: true` | `paused, resumable` badge on `/runs` |
| Assurance force-interrupted (130) | exit 130 | `force-interrupted` | unchanged | true | 0 | written | `/runs` entry |
| Stream ends without terminal event | `ParsedStream.kind === 'crashed'` | whatever the exit was | **unchanged** | true | 0 | written, `terminalSeen: false` | `outcome unknown` on `/runs` |
| Our timeout (300 s hook / 60 s enrichment) | timer + SIGTERM→SIGKILL | `killed-by-timeout` | unchanged | true | 0 | written with timeout diagnostic | `timed out` on `/runs` |
| Kane timeout/cancel (exit 3, execution family) | exit 3 + family | `timeout-or-cancelled` | unchanged | true | 0 | written | `/runs` entry |
| Preflight rejection (`valid:false`, exit 2) | `testrun_plan.valid === false` | `preflight-rejected` | **unchanged** | true | 0 | written with each member's reason | rejection reasons listed on `/runs` |
| Member `broken` | `testrun_member_end.status` | `failure` | that promise → `red`, status recorded verbatim | false | 0 | written, branch routed | `red` + `broken` note in panel |
| Member `interrupted` | same | `failure` | that promise → `stale`, no repair branch | false | 0 | written, `branch: null` | `stale` |
| `coverage` payload unreadable | projection yields zero entries | `success` | unchanged | true | 0 | n/a | `baseline data only` chip |
| Malformed NDJSON line | JSON parse error after first `{` | unaffected | unaffected | unchanged | 0 | diagnostic carried | diagnostic on `/runs` |
| Empty blast radius | `computeBlastRadius` | no invocation | unchanged | false | 0 | written, `branch: null` | nothing changes |
| Zero promises in repo | baseline returns none | n/a | n/a | false | 0 | n/a | both metrics `n/a`, empty-state copy |
| Snapshot missing/invalid at build | zod parse in `lib/snapshot.ts` | n/a | n/a | n/a | n/a | n/a | **build fails**, message names the field path |
| Amendment cited line changed since proposal | sha256 guard | n/a | unchanged | false | 0 | n/a | amendment shown as `stale`, no write |
| `maintain evolve` rejects `--mode agent` | one-time `--help` probe | `failure` | unchanged | true | 0 | written | review card created from failure context + diagnostic |
| **No `.context/` store** (`cover` refuses) | `done.status: 'refused'`, `exit_code: 2` — verified envelope §5.3.1 | `failure` | unchanged | true | 0 | n/a | `baseline data only` chip; `/runs` quotes Kane's message verbatim, `degradedReason: assurance-status:refused` |
| **Reconcile: source id unresolved** (no match) | `resolveSourceId` → `no-match`; **no spawn** | n/a, never invoked | **unchanged** | **false** | 0 | written, `branch: null` | `reconcile-source-unresolved` on `/runs`, naming the `context ingest` remedy |
| Reconcile: no store / listing unreadable / listing stream crashed / ambiguous match / retired source | `resolveSourceId` → `no-store` \| `listing-unreadable` \| `crashed-stream` \| `ambiguous` \| `retired`; **no spawn** | n/a, never invoked | unchanged | false | 0 | written, `branch: null` | one diagnostic per reason on `/runs` |
| **Reconcile: fork guard** — `--from` already backs a different live source | listing scan (§13.2.4 #7), or Kane's own exit 2 | `failure` | unchanged | false | 0 | written, `branch: null` | `reconcile-source-forked` with **both** conflicting source ids |
| Reconcile: missing `--from` / missing `--source-id` / file not found / non-ingestable type / unknown source id | fail-fast ladder §13.2.4, checks 1–5 — caught locally before spawn where possible | `failure` when Kane was reached, else never invoked | **unchanged** | false | 0 | written, `branch: null` | refusal reason on `/runs`; **nothing mutated, Kane exit 2** |
| Reconcile: `--plan` and `--apply` both requested | `kept` arg parser | n/a, never invoked | unchanged | false | **2** (usage error — the one case `kept` itself exits non-zero) | not written | n/a, the command never ran |

### 14.2 The two generalisations

Two rules generalise the whole table: **verdicts move only on `kind: 'complete'` plus `exitMeaning ∈ {success, failure}`**, and **the CLI's own exit code reports whether KEPT worked, never whether the product passed**.

---

## 15. Judge path and credential-free deployment

### 15.1 The 30 seconds

```
git clone … && npm ci        # done ahead of time by the judge or skipped entirely
npm run demo                 # t=0
  → apps/ledger  on http://localhost:3000   (t ≈ 3 s, static pages, no data fetch)
  → apps/fixture on http://localhost:3100   (t ≈ 3 s)
```

Zero Kane invocations, zero credits, zero credentials, zero network beyond localhost (R13.1–13.3). The graph, the coverage figures, the freshness chip, the run log, the review cards and the pending docs-lie diff all come from the committed snapshot. Evidence artefacts — including `annotated.png` — are committed static files under `apps/ledger/public/evidence/` and open in a new tab (R13.4, R13.5).

Faster still: the README's first 20 lines carry the deployed HTTPS URL and the demo command (R13.9), so a judge with no terminal at all sees the whole thing in one click.

### 15.2 Vercel configuration

- Project root `apps/ledger`, install `npm ci` at the monorepo root, build `next build`.
- **Environment variables: none.** No secrets exist to leak, because the build reads a file.
- `kane-cli` is never invoked, imported or referenced from `apps/ledger` — a source-scan test asserts no `child_process`, no `kane` string, no `exec`. Kane needs local Chrome and cannot run on Vercel anyway (A9); this design does not want it to.
- The build is deterministic: same commit, same snapshot, same pixels.
- The live Kane loop is delivered as `npm run loop` plus recorded video, documented in the README with its prerequisites of local Chrome and Kane credentials (R13.8).

### 15.3 Evidence curation

Raw sealed packs land in `evidence/` (from `session_dir/evidence/`) or `.testmuai/evidence/`. `kept snapshot` copies the referenced packs into `apps/ledger/public/evidence/<packId>/` and rewrites `publicPath` values. `.gitignore` excludes `.context/` (R13.7) and force-includes `output-*/` recordings (R13.6) and the curated public packs. A referential-integrity test asserts every snapshot evidence reference resolves to a committed file and every committed pack is referenced.

---

## Testing Strategy

Runner: `vitest --run` (never watch). Property engine: `fast-check`, minimum **100 runs** per property. React tests via `@testing-library/react` + jsdom. Total new dev dependency footprint ≈ 25 MB, which the disk budget affords.

Layout:

```
packages/kept-core/test/
  fixtures/
    run-passed.ndjson              ← copy of docs/kane/smoke-run.ndjson (12 lines)
    run-failed-740.ndjson          ← run_end with result_code "740" + verdict object
    testrun-mixed.ndjson           ← plan + 4 members, one of each status + testrun_done
    testrun-preflight-invalid.ndjson
    testrun-crashed.ndjson         ← truncated before testrun_done
    assurance-cover-done.ndjson
    assurance-cover-refused.ndjson ← the verbatim two-line no-context-store refusal (§5.3.1)
    assurance-paused.ndjson        ← done status paused, exit_code 3
    context-list-sources.jsonl     ← source listing, JSON lines: exact-path, digest-only, retired, duplicate
    context-list-live.jsonl        ← the live store's one line: id + cid, no path — the slug rung
    context-list-no-store.txt      ← `error: no context store here (…)`, verbatim, exit 2
    failure-*.yaml
  arbitraries.ts                   ← shared fast-check generators (see below)
  *.prop.test.ts                   ← one file per property, tagged
  *.test.ts                        ← examples, edge cases, source-scan checks
```

Shared generators in `arbitraries.ts`: `arbCitation` (file/line/text over generated in-memory docs), `arbPromise`, `arbGraph`, `arbSnapshot` (always schema-valid, includes the empty graph), `arbKaneEvent`, `arbTerminalEvent(family)` (result_code emitted as number *or* string, credits as `credits_consumed` *or* `credits` *or* neither), `arbStream(family)` plus `arbTruncatedStream(family)`, `arbVerdictObject`, `arbMemberStatus`, `arbFailureYaml`, `arbNoisyPrefix` (non-`{` lines), `arbMalformedLine`.

Edge cases the generators must produce, because they are where this system breaks: empty graph; zero `*_test.md` files; `result_code` as `" 740"`; `credits_consumed` absent with `credits` present; a stream whose only line is `run_end`; a stream truncated at every index; a member status string outside the four; a citation line exactly at EOF and exactly one past it; a cited line containing only whitespace; a file with CRLF endings; a doc with no trailing newline; `session_dir` absent from `run_end`.

Non-property tests, deliberately few:

- the recorded smoke-run regression (R3.25) and the `cover` refusal regression (§5.3.1);
- **argv assertions per command**, which now explicitly include `kept reconcile` emitting both `--from` and `--source-id`, never emitting `--plan` and `--apply` together, and never spawning at all when the source id is unresolved (§13.2);
- the source-resolution ladder: one case per rung plus `no-match`, `ambiguous`, `retired` and the fork guard, asserting zero spawns and zero verdict movement on every failure rung;
- the four source-scan tests: `result_code` strict equality; Ledger mutating handlers / auth / `child_process`; `animejs` import shape and location (§2.2); mono-vs-prose typography (§10.7);
- the visual-layer trio of §10.4.4 — contrast over the whole ramp, token/CSS parity, forbidden-palette scan;
- the **reduced-motion equivalence** test (§10.6.4): `/` rendered under both media states, compared on every animated declaration;
- the widened CSS motion scan (R10.4), hook-schema validation, and referential integrity of committed evidence.

Integration tests (one run each, against the live CLI, recorded and committed): the verdict spike (R6.12), zero-credit replay (R4.6), `maintain reconcile --plan` with a real resolved source id, and the end-to-end closed loop (R11.6).

Every property test names its design property in the test title: `Feature: kept, Property 4: For any Kane stream and declared command family, …`.

---

## Correctness Properties

*A property is a characteristic or behaviour that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Promise identifiers are stable across rebuilds

*For any* set of promises, rebuilding the graph after moving a claim to a different line, reordering the claims within its file, or adding and removing unrelated claims produces the same identifier for that promise; and *for any* two promises, their identifiers are equal if and only if their citation file path and normalised claim text are both equal.

**Validates: Requirements 1.2**

### Property 2: Graph admission requires a resolvable citation

*For any* mixture of promise candidates from either provider, every promise present in the built graph has a citation whose one-based line number is within the line count of an existing cited file and whose text equals that line verbatim; every candidate lacking a citation or citing a line beyond the end of its file is absent from the graph and has produced exactly one diagnostic naming the supplying provider.

**Validates: Requirements 1.3, 1.4, 1.5**

### Property 3: Snapshot serialisation round-trips and is canonical

*For any* valid promise graph, parsing its serialised snapshot yields a snapshot whose promise identifiers, citations, verdicts, designed test references, metrics and evidence references are deep-equal to the original; and re-serialising that parsed value produces a byte-identical string.

**Validates: Requirements 1.8, 8.8**

### Property 4: Provider merge prefers enrichment on the assurance axes and baseline on citations

*For any* pair of promise candidates sharing an identifier, the merged graph contains exactly one promise for that identifier whose designed test reference and verdict come from the enrichment provider when the enrichment provider supplied them, whose citation and claim text come from the baseline provider in every case, and whose provider list contains both providers.

**Validates: Requirements 1.7, 2.1**

### Property 5: The baseline provider is total

*For any* repository content — including zero `*_test.md` files, unreadable files, malformed frontmatter, binary content, and arbitrary byte sequences — the baseline provider resolves successfully, never throws, never sets the degraded flag, emits one promise per well-formed `@verifies` tag, and records one diagnostic per file it skipped.

**Validates: Requirements 2.2, 2.3, 2.4**

### Property 6: Degradation preserves state and never fails the build

*For any* prior promise graph and *for any* enrichment failure cause — Kane absent, non-zero exit for the invoked family, a `done` status of error, refused, interrupted or aborted, a paused status with exit code 3, a stream lacking `done`, unparseable output, or exceeding the 60 second budget — the resulting graph equals the baseline-only graph, the degraded flag is true with a reason recorded, every pre-existing verdict and the freshness timestamp are unchanged, and the CLI process exit code is 0.

**Validates: Requirements 2.7, 2.8, 2.9, 2.10, 2.12**

### Property 7: Parsing is robust and lossless per line

*For any* sequence of lines consisting of arbitrary non-`{` prefix lines, well-formed JSON lines and malformed lines, the parser emits exactly one event per line that parsed as JSON, records no diagnostic for the leading prefix lines, records exactly one diagnostic carrying the correct one-based line number for each malformed line after the first `{` line, classifies every event carrying a `step` key as a progress event, retains every event whose `type` is outside the known set as an unknown-type event, and continues processing all subsequent lines in every case.

**Validates: Requirements 3.1, 3.8, 3.9, 3.23, 3.24**

### Property 8: Terminal-event recognition is family-determined and crash classification is exhaustive

*For any* command family and *for any* event stream, the parser expects exactly the terminal type `run_end` for Execution_Run, `testrun_done` for Execution_Testrun and `done` for Assurance; the parsed result is `complete` if and only if at least one event of that type is present, and `crashed` otherwise; and every `crashed` result reports the outcome as unknown, names the family and the expected terminal type in a diagnostic, and exposes no terminal event.

**Validates: Requirements 2.6, 2.7, 3.2, 3.6, 4.7, 5.2**

### Property 9: Verdicts and freshness move only on a proven outcome

*For any* prior state and *for any* invocation result, the promise verdicts and freshness timestamp in the new state are identical to the prior state unless the stream is `complete` and the exit meaning is `success` or `failure`; and *for any* verification run, every promise outside the blast radius is byte-identical before and after, including its verdict source and freshness.

**Validates: Requirements 3.7, 4.10, 4.15, 5.3, 11.8, 11.9**

### Property 10: `result_code` coercion makes string and number forms equivalent

*For any* integer value, an event carrying it as a number, as its decimal string, or as that string with surrounding whitespace, yields the same coerced result code, the same repair branch from either router implementation, and the same recorded value in the snapshot; and a `result_code` that is absent or non-numeric coerces to null rather than to zero or NaN.

**Validates: Requirements 3.11, 3.12, 3.13, 6.8**

### Property 11: The credits accessor prefers `credits_consumed` and accepts `credits`

*For any* event, the consumed-credits accessor returns the value of `credits_consumed` when that field holds a finite number, returns the value of `credits` when `credits_consumed` is absent and `credits` holds a finite number, and returns null when neither field holds a finite number.

**Validates: Requirements 3.10, 14.7**

### Property 12: Exit-code interpretation is total and family-correct

*For any* command family and *for any* process exit code including null, the exit-meaning function returns exactly one defined meaning; exit code 3 with the Assurance family always means paused and resumable and never means failure or timeout; exit code 3 with either execution family always means timeout or cancellation; exit code 130 always means force-interrupted; exit code 2 with Execution_Testrun always means preflight rejection; and the process exit code is never conflated with `result_code`.

**Validates: Requirements 3.14, 3.15, 4.11, 11.9, 11.10, 11.11**

### Property 13: Family-typed fields are exposed faithfully and `run_dir` is never read

*For any* generated terminal event of any family, the parser exposes that family's documented fields with their values unchanged — `status`, `result_code`, `reason_code`, consumed credits, `run_id`, `session_dir` and `per_flow_metadata` for `run_end`; `valid` and each member's `path`, `test_id`, `tags` and `failure` for `testrun_plan`; the six `verdict` object fields when present; and the `status` and `exit_code` for `done` — while performing zero filesystem operations involving `run_dir` and parsing successfully whether or not `run_dir` is present.

**Validates: Requirements 3.16, 3.17, 3.18, 3.21, 3.22**

### Property 14: Evidence-pack locations are resolved from the family, never from the event

*For any* session directory and working directory, the resolved evidence location is `session_dir/evidence` for the Execution_Run family and `<cwd>/.testmuai/evidence` for the Execution_Testrun family, is null when the family cannot resolve one or the session directory is absent, and is never derived from any field of the terminal event.

**Validates: Requirements 3.19, 4.13, 6.11**

### Property 15: Member status maps totally onto four verdicts

*For any* member status string, the mapping is total and never throws; `passed` maps to `proven`, `failed` and `broken` both map to `red`, `interrupted` maps to `stale`, and any unrecognised value maps to `stale` while being flagged as unknown; and every non-passed status appears verbatim in the run diagnostics so that a broken or interrupted member remains distinguishable from an asserted failure.

**Validates: Requirements 3.20, 4.8, 4.9**

### Property 16: Blast-radius identifiers come only from the plan

*For any* plan and *for any* set of changed paths, every test identifier handed to Kane is a member identifier present in that plan, no identifier is synthesised from a file path, every plan member lacking a `test_id` is excluded and diagnosed, and a radius containing zero identifiers results in zero Kane invocations plus one diagnostic per uncovered changed path.

**Validates: Requirements 4.3, 4.4, 4.5**

### Property 17: The verdict router is total, deterministic and strategy-isolated

*For any* failing terminal event of any family, the selected router returns exactly one repair branch from `code-break`, `test-drift` and `docs-lie`, never throws, returns the same branch on repeated calls with the same input, defaults to `docs-lie` when no rule matches, and returns an evidence reference that either points at an artefact that exists or is null; and running the whole pipeline with each implementation selected produces snapshots that differ only in the repair branch, strategy, severity, category, confidence and rationale fields.

**Validates: Requirements 6.1, 6.2, 6.7, 6.9, 6.10, 6.13, 6.14**

### Property 18: The verdict object outranks the result code

*For any* failing terminal event carrying a verdict object, the returned branch is `test-drift` when `confirmed` is false and `code-break` when `confirmed` is true, regardless of the accompanying `result_code` value or its type; the object's severity, category and confidence are exposed alongside the branch; and *for any* failing terminal event carrying no verdict object, a coerced `result_code` of 740 returns `code-break` while any other failing code delegates to the `failure.yaml` triage.

**Validates: Requirements 6.3, 6.4, 6.5, 6.6**

### Property 19: A documentation amendment writes nothing until accepted, then edits exactly one line

*For any* docs-lie failure, proposing an amendment performs no write outside `.kept/` and produces an amendment carrying the current cited text and a proposed replacement; and *for any* accepted amendment, the cited file afterwards differs from before in exactly the cited line, which equals the proposed text, with every other line, the line endings and the trailing-newline state byte-identical — unless the cited line changed since proposal, in which case the amendment is marked stale and no write occurs at all.

**Validates: Requirements 7.3, 7.4, 7.6**

### Property 20: Reconciliation and evolution only ever produce held review cards

*For any* reconcile or evolve stream, the only files written are under `.kept/`; every produced change is represented as a review card carrying its originating promise identifier, repair branch and evidence reference; a promise whose designed test reference is null has verdict `undesigned`; a promise whose cited claim text is no longer present in the cited file is removed with a diagnostic recording the removal; and every other promise is preserved verbatim.

**Validates: Requirements 5.5, 5.6, 5.7, 7.2, 7.7**

### Property 21: Metrics are arithmetically consistent and never divide by zero

*For any* promise graph, the snapshot's total, designed, proven, red, stale and undesigned counts equal the corresponding counts over the promise list, the undesigned count equals the reported suite debt, designed coverage equals designed count divided by total, proven coverage equals proven count divided by total, and both coverage values are null with no division performed exactly when the total is zero; and *for any* degraded snapshot, proven coverage is omitted from the rendered output rather than rendered as a number.

**Validates: Requirements 2.11, 5.8, 9.1, 9.2, 9.3**

### Property 22: Verdict presentation always pairs colour with a word, at accessible contrast

*For any* verdict and *for any* surface that renders it, the verdict's text label is present in the output, the mapped token is the one specified for that verdict with `undesigned` rendered in the neutral token and no non-verdict element using a verdict token; *for any* foreground and background token pair actually used, the contrast ratio is at least 4.5 to 1 for body text and at least 3 to 1 for graph node labels, on every surface of the elevation ramp; and *for any* setting of `prefers-reduced-motion`, the rendered verdict label, verdict token and computed contrast are identical.

**Validates: Requirements 10.2, 10.3, 10.5, 10.6**

**Supporting notes** — the thresholds are unchanged from the earlier version of this design; the palette they are measured against is the one in [§10.4](#104-the-visual-system--a-specific-palette-measured), not the old near-black-blue scheme.

- The tokens under test are `--verdict-proven` `#6FB894`, `--verdict-stale` `#D9A64A`, `--verdict-red` `#D97A66`, `--verdict-undesigned` `#9A9184`, against the four-step ink ramp `--ink-000` `#14120F`, `--ink-050` `#1B1815`, `--ink-100` `#221E1A`, `--ink-150` `#2A251F`. The full measured matrix is §10.4.2; the **lowest ratio anywhere in it is 4.89:1**, so the 4.5:1 body floor holds with margin and the 3:1 node-label floor holds by a wide one.
- Generation covers the **whole ramp**, not just the page surface, because `--ink-150` is the hover and selected-node fill — a pair that passes only at rest is a pass that lies. The badge's inverted pairs (`--ink-000` on each verdict fill, §10.11) are generated in the same run.
- **Verdict washes are excluded by construction, not by omission.** `--wash-*` tokens are permitted only on a 3px node edge, a rail trough and a 1px tag border, never behind text, so they contribute no foreground/background pair. The component scan cross-checks that exclusion rather than trusting it.
- `--hairline` (1.32:1) and `--hairline-strong` (1.50:1) are declared `non-text` in `CONTRAST_PAIRS` and the test asserts they never carry text and never carry meaning alone.
- **Parity is part of the property.** `lib/tokens.ts` and `tokens.css` must agree value-for-value, both directions. Without that, a palette edit could silently move the browser's colours away from the test's input and the property would keep passing against a stale palette.
- **The reduced-motion clause is a specified state, not an afterthought** (§10.6.4). A jsdom render of `/` under `prefers-reduced-motion: reduce` and a render after all timelines complete are compared property-by-property on every animated declaration; verdict colour, tag scale, node opacity, panel offset and edge draw progress must all be equal. This is what guarantees that motion carries no information and that the accessible path is the same product, not a reduced one.
- The forbidden-palette scan (§10.4.4) runs alongside: no `backdrop-filter`, no hex above 70% saturation, no more than two hue families in a gradient, no `box-shadow` colour outside `--occlude` / `--light-edge*`, no emoji. These are craft constraints rather than requirement-derived ones, so they are assertions in the same test file rather than clauses of the property.

### Property 23: Every promise is reachable, selectable and evidenced in the projection

*For any* snapshot, the rendered graph contains exactly one node per promise carrying that promise's claim text and its citation as `path:line`; selecting any promise displays the verbatim cited text, the designed test reference, the verdict as text, and links to exactly those evidence artefacts that the snapshot lists for it; and every promise node and every amendment accept control is reachable by keyboard with a visible focus indicator and an accessible name.

**Validates: Requirements 8.1, 8.2, 8.3, 10.7, 7.5**

### Property 24: Freshness rendering is monotone with a hard 24-hour threshold

*For any* ISO 8601 terminal-event timestamp and reference time, the freshness string is non-empty and never reports an invalid date, becomes monotonically older as the timestamp recedes, and is rendered in the amber verdict colour exactly when the age exceeds 24 hours.

**Validates: Requirements 9.6, 9.7**

### Property 25: The badge is valid SVG reporting a whole-number percentage

*For any* proven-coverage value, the badge response is well-formed XML with a single `svg` root element whose text content includes that value rounded to a whole-number percentage followed by a percent sign, or the literal `n/a` when coverage is null.

**Validates: Requirements 9.4, 9.5**

### Property 26: The handoff file is complete for every run and fences the agent by branch

*For any* completed hook-triggered invocation, the handoff file validates against its schema and records the outcome, the exit meaning, the terminal-event type and whether a terminal event was seen; for every failing result it additionally records the verdict, the repair branch, the verdict object fields where present, the citation and the resolved evidence path; and the allowed paths are non-empty **only** when the branch is `code-break` *and* some promise carrying it was `proven` before the run (§8.1.1), in which case they contain only fixture source globs while the forbidden paths include the fixture documentation and the test corpus — and on a `code-break` whose promises were never proven the allowed set is empty and every glob the granted fence would have allowed is forbidden.

**Validates: Requirements 11.4, 7.1**

### Property 27: Hook file patterns partition fixture edits

*For any* repository-relative path, the code hook's patterns match it only if it is a fixture source file, the docs hook's patterns match it only if it is a fixture documentation file, and no path is matched by both hooks.

**Validates: Requirements 11.2, 11.3**

### Property 28: Committed evidence and the snapshot are referentially closed

*For any* committed snapshot, every evidence pack identifier, artefact public path and repair evidence reference resolves to a file committed in the repository, and every committed curated pack is referenced by at least one promise, run or amendment.

**Validates: Requirements 13.4, 13.5**

### Property 29: Fixture claims are one-to-one with promises

*For any* line of the fixture README claims block, that line yields exactly one promise whose citation names that file and that line number, no line yields two promises, every claim names one of the fixture's screens, and the claim count is at least six.

**Validates: Requirements 12.4, 12.5**

---

## 18. Droppable scope, in priority order

Everything below is a *nice-to-have*. Tasks must be ordered so these are the last things built and can be cut without touching anything else. Drop from the top of this list first.

| # | Item | Why it is safe to drop | What replaces it |
|---|---|---|---|
| 1 | **Conduit / RealWorld second target** (A8, R14.8) | Explicitly optional, gated on every other deliverable passing | Nothing; do not start it |
| 2 | **`@xterm/xterm` live NDJSON pane** (R8.7) | Dev-only surface, invisible to judges on the deployed build; the score comes from `/runs` | `/runs` page rendered from `snapshot.runs[]`, plus raw terminal output during the video |
| 3 | **`kept watch` loopback accept listener** (§8.5) | Acceptance already works via CLI; the deployed control is the copy-command button either way | `AcceptControl` copies `kept amend accept <id>` |
| 4 | **Shiki syntax highlighting for diffs** | Heavy install against a 7 GB disk; docs-lie diffs are single-line prose where highlighting adds nothing | `lib/diff.ts` unified diff with verdict colours |
| 5 | **`KANE_TESTRUN_MEMBER_DEBUG` stderr capture** (R4.12) | Requirement is conditional (`WHERE per-member diagnostics are requested`) | Member statuses are already in `testrun_member_end` |
| 6 | **`cover gaps` dual-axis ribbon** | `cover --json` already supplies both axes | Metric rail tiles |
| 7 | **Evidence lane in the graph** (evidence nodes + edges) | Evidence is reachable from the promise panel | Panel artefact links only |
| 8 | **Badge visual polish** (shields-style gradients, logo) | R9.4/R9.5 only require valid SVG with a whole-number percentage | Flat two-tone 110×20 SVG |
| 9 | **`kept doctor`** | Convenience only | README prerequisites section |
| 10 | **`maintain evolve` automation for `test-drift`** (R7.2) | Only fires if the spike lands on a drift verdict; the branch is still demonstrated by the review card | Review card built from the failure context with a diagnostic |

### 18.1 Motion flourishes — droppable **individually**, in this order

The five orchestrations of §10.6 are not one feature. Each is independently removable because each goes through the same `play()` gate (§10.6.4), so deleting one call site leaves every other animation and the entire reduced-motion path untouched. Drop from the top.

| # | Flourish | Cost if dropped | What replaces it |
|---|---|---|---|
| M1 | **Edge draw / pulse along the verdict path** (§10.6.3) | Lowest information density of the five, and the only one needing `svg.createDrawable`; React Flow's edge internals make it the fiddliest | Static edge in `--hairline-strong`; the panel already names which test moved the verdict |
| M2 | **Metric count-up** (§10.6.2) | Pleasant, but the figure is legible the instant it renders | Final figure rendered directly; tabular numerals stay (they are typography, §10.7, not motion) |
| M3 | **Panel section stagger** (§10.6.3) | The panel's own slide-and-fade is a plain CSS transition and survives | Panel slides as one unit |
| M4 | **Graph entrance stagger** (§10.6.1) | This is the most visible craft on the page and the most likely thing a judge notices in the first three seconds. Drop reluctantly | Nodes at opacity 1 on first paint — identical to the reduced-motion render, which is already specified and already tested |
| M5 | **Verdict flip scale pulse** (§10.6.3) | Last to go: it marks the one event the product exists to show | The colour transition alone, as a CSS `transition` on `--dur-base` — no anime.js involvement |

If **all five** are dropped, `animejs` comes out of `package.json` and the runtime dependency count returns to eight. That is the cut of last resort, and it is a clean one: `lib/motion.ts` collapses to the synchronous `utils.set`-equivalent branch it already has, and no component changes.

### 18.2 Not droppable — this is the Craft score

The following are **not** on the droppable list and must not be treated as polish. Craft is one of four equally weighted dimensions, and these are what earns it:

- **The palette** (§10.4) and its measured contrast matrix (§10.4.2). Not because it is pretty, but because Property 22 and R10.6 are enforced against it and because the whole point of a distinctive, non-generic palette is that it cannot be swapped for a default without losing the thing being scored.
- **The light and elevation system** (§10.5) — the top-edge highlight, the two-part occlusion shadows, the off-axis plane gradients, and the `.surface-*` classes that make them the only way to author depth. Reverting to flat borders is a visible downgrade for no build-time saving; the whole system is three CSS classes.
- **The reduced-motion path** (§10.6.4). It is an accessibility guarantee and a clause of Property 22, not a feature. It is also *cheaper* than not having it, because the gate is what makes M1–M5 individually droppable in the first place.
- **Typography discipline** (§10.7) — the mono-as-texture rule, tabular numerals, and the metric rail's optical alignment. These are token and class choices, not work items.
- The token parity test and the forbidden-palette scan (§10.4.4), because without them the palette silently rots.

Hard floor — none of these may be dropped, because each is directly scored: the three-contract parser, the `VerdictRouter` with both implementations, the committed snapshot and its schema, the graph hero with citations, the two Kiro hooks and the handoff file, `kept reconcile`'s resolved `--from`/`--source-id` invocation with its fail-fast ladder (§13.2 — a docs branch that always exits 2 is not a closed loop), the fixture with its eight claims including the breakable and never-true ones, `/badge.svg`, the demo command, the deployed Ledger, and everything in §18.2 above.

---

## 19. Build order for the remaining window

Sequenced so that the highest-scoring, least-reversible things exist first and every stage leaves the repo demoable.

1. **Skeleton** — workspaces, tsconfig, vitest, `bin/kept`, `.kept/config.json`. (~30 min)
2. **`kept-core` Kane layer** — `family`, `events`, `coerce`, `exit`, `ndjson`, `evidence`, `invoker`, with the recorded smoke-run regression and Properties 7, 8, 10, 11, 12, 13, 14 green. This is the part that everything else is wrong without. (~2 h)
3. **Promise model + providers + snapshot** — `ids`, admission gate, baseline, merge, canonical snapshot, metrics; Properties 1–6, 21. (~2 h)
4. **Fixture app** — 7 screens, README claims block, `tests/*_test.md` corpus with `@verifies` and `covers`. Snapshot now renders real promises with real citations. (~2 h)
5. **Ledger, structure first** — tokens (§10.4) and `surfaces.css` (§10.5) before any component, because retro-fitting a light model costs more than authoring against one; then graph hero, metric rail, panel, `/coverage`, `/badge.svg`, `/runs`. Read-only scans, contrast, parity and forbidden-palette tests green; Property 22. First screenshot-worthy state. (~3 h)
6. **Router + radius + verify** — `resultCode740`, `failureYamlTriage`, plan cache, `computeBlastRadius`, `kept verify`; Properties 15–18. (~2 h)
7. **Hooks + handoff + source resolution** — both hook files, `writeHandoff`, the fenced agent prompts, `resolveSourceId` with `.kept/sources.json` and the fail-fast ladder (§13.2), `kept reconcile --changed`; Properties 26, 27. (~1.5 h)
8. **Repair surfaces** — review cards, `docsAmendment` propose/accept with the sha256 interlock, `/amendments`, `/reviews`; Properties 19, 20. (~1.5 h)
9. **Live Kane** — opens with the bootstrap of §4.9.1: `context ingest apps/fixture/README.md` then `context extract`, because `cover` refuses until a store exists (§5.3.1) and `maintain reconcile` cannot resolve a source id until one is ingested (§13.2.2). Then the verdict spike, authored runs, committed `output-*/` recordings, curated evidence, closed-loop record; Property 28. (~2 h)
10. **Motion layer** — `lib/motion.ts` and the reduced-motion path first, then M5→M1 from §18.1 in *reverse* drop order, so the most valuable orchestration exists first and the timebox cuts from the cheap end. Reduced-motion equivalence test green before any flourish is added. (~1.5 h)
11. **Submission** — Vercel deploy, README first-20-lines, 120-word summary, 180-second video, commit hygiene. (~1.5 h)
12. **Only if everything above is green** — items from §18, top-down. Never anything from §18.2.

Stages 1–3 are the ones that cannot be rushed. Stage 5 is where the Craft dimension is won or lost, and it is deliberately sequenced *before* the loop work so that the palette and light model exist while there is still energy to get them right; stage 10 layers motion onto a page that is already correct and already accessible. Stage 9 is what makes the Verified dimension real rather than claimed, and its first two commands are the ones that were previously implicit.
