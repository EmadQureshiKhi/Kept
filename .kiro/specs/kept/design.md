# Design Document

## Overview

KEPT is a promise-verification system built as an npm workspaces TypeScript monorepo. It extracts every claim a product makes about itself, cites each claim to a file and line, binds each claim to a Kane CLI test, and keeps the binding honest in both directions: code changes re-verify the promises in their blast radius, documentation changes reconcile what the suite now owes. When a promise goes red, Kane's own failure verdict selects one of three repairs — patch the code, evolve the test, or amend the documentation.

The design is shaped by four hard constraints, in this order of authority:

1. **One day of build time, solo.** Every construction below is chosen because it is provable and boring. No layout engines, no state managers, no ORM, no Docker, no browser-automation dependency of our own. Kane brings its own Chrome. Anything not required to score is marked droppable in [§18](#18-droppable-scope-in-priority-order).
2. **7 GB of free disk.** Zero-install-footprint decisions throughout: system font stack instead of downloaded fonts, a hand-rolled 60-line unified-diff renderer instead of Shiki by default, a hand-rolled deterministic lane layout instead of dagre, a node script instead of `concurrently`. Runtime dependency budget for the whole repo is eight packages ([§2.2](#22-dependency-budget)).
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
│       │               FreshnessChip,VerdictTag,DiffView,AcceptControl,
│       │               ReviewCardList,LiveNdjsonPane}.tsx
│       ├── lib/{snapshot,tokens,relativeTime,diff,layout}.ts
│       └── styles/tokens.css
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

Runtime: `next`, `react`, `react-dom`, `tailwindcss`, `@xyflow/react`, `zod`, `yaml`, `clsx`, plus shadcn/ui **copied source** (not a dependency — the CLI vendors component files). Dev: `typescript`, `vitest`, `fast-check`, `@testing-library/react`, `jsdom`, `@types/*`.

Deliberately not installed: Shiki (replaced by `lib/diff.ts`, ~60 lines; Shiki is a droppable upgrade), dagre/elkjs (replaced by `lib/layout.ts` lane layout), commander/yargs (hand-rolled arg parse, ~40 lines), concurrently (`scripts/demo.mjs`), any font package (system stack), Playwright/Puppeteer (Kane owns the browser), Docker.

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
| `done.status` ∈ error/refused/interrupted/aborted | `assurance-status:<status>` |
| `done.status === 'paused'`, exit 3 | `paused-resumable` |
| killed at 60 s | `enrichment-timeout` |
| `coverage` payload missing or unprojectable | `coverage-payload-unreadable` |
| any line failed JSON parse *and* no `coverage` event | `coverage-payload-unreadable` |

The `coverage` payload's internal schema is not pinned by observation, so `providers/coverage.ts` reads it **tolerantly**: walk the payload for any array of objects, and accept an entry when it carries a recognisable test identity (`test_id` | `id` | `testId`) and/or a path (`path` | `file` | `test_path`), plus optional booleans/enums for designed and proven state (`designed`, `is_designed`, `status`, `proven`, `passed`). Entries that project cleanly become axis overlays keyed by:

1. `test_id` matched against a candidate's `designedTest.testId`, else
2. normalised `path` matched against `designedTest.path`.

Unmatched entries are recorded as diagnostics, not failures. If **zero** entries project, that is `coverage-payload-unreadable` and the build degrades — better a visibly baseline-only ledger than a silently wrong proven number.

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

Loads `<evidenceDir>/<newest pack>/failure.yaml` via the `yaml` package and reads a category-ish field (`triage.category` | `category` | `classification` | `reason`), lower-cased:

| Signal | Branch |
|---|---|
| `product_bug`, `app_error`, `server_error`, `http_5xx`, `crash`, `console_error` | `code-break` |
| `selector_not_found`, `locator`, `element_not_found`, `stale_element`, `timeout`, `navigation`, `flaky`, `timing` | `test-drift` |
| `assertion`, `expectation_mismatch`, `value_mismatch` **and** coerced `result_code` in `700..799` | `docs-lie` |
| file absent, unparseable, or unrecognised signal | `docs-lie` (default) |

The `assertion ⇒ docs-lie` mapping is the interesting one and it is deliberate: an assertion that fails while the app behaves normally and the selector resolves is the signature of a claim that was never true. `code-break` requires positive evidence of a product fault; `test-drift` requires positive evidence of a test-mechanics fault; the residue is the documentation's problem. That ordering is what makes the third branch fire on the fixture's never-true claim rather than mis-routing it.

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
app/layout.tsx           tokens.css, system font stack, dark background, skip-link
app/page.tsx
 ├── MetricRail          ProvenCoverage | DesignedCoverage | SuiteDebt | FreshnessChip | DegradedChip
 ├── PromiseGraph        @xyflow/react, nodes from lib/layout.ts, keyboard-navigable
 │    └── PromiseNode    id chip (mono) · claim (2 lines) · citation path:line (mono) · VerdictTag
 ├── PromisePanel        opens on selection / ?p=; verbatim claim, designed test, verdict,
 │                       evidence artefact links, repair annotation
 └── LiveNdjsonPane      dev-only, xterm, hidden in production   (nice-to-have §18)
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

### 10.4 Design tokens

`apps/ledger/styles/tokens.css`, mirrored as typed constants in `lib/tokens.ts` so tests can compute contrast.

```css
:root {
  /* surfaces */
  --bg-0:   #0B0D10;   /* page */
  --bg-1:   #12151A;   /* panel */
  --bg-2:   #191D24;   /* raised: nodes, cards */
  --line:   #232932;   /* 1px hairlines, the only border treatment */

  /* text */
  --text-0: #E6EAF0;   /* body + headings   — 14.6:1 on --bg-0 */
  --text-1: #9BA6B4;   /* secondary body    —  6.9:1 on --bg-0 */
  --text-2: #7C8794;   /* labels, non-body  —  4.6:1 on --bg-0 */

  /* verdicts — the ONLY saturated colour in the product */
  --proven:     #3DD68C;   /*  8.9:1 on --bg-0 */
  --stale:      #F0B429;   /* 10.4:1 */
  --red:        #FF5C5C;   /*  5.4:1 */
  --undesigned: #7C8794;   /* neutral, deliberately unsaturated (R10.3) */

  /* structural accent: focus rings only, never a state signal */
  --focus:  #5B8DEF;

  /* type scale (16px root) */
  --fs-micro: 0.6875rem;  /* 11px  ids, tags */
  --fs-xs:    0.75rem;    /* 12px  citations */
  --fs-sm:    0.8125rem;  /* 13px  labels */
  --fs-base:  0.875rem;   /* 14px  body */
  --fs-md:    1rem;       /* 16px  panel headings */
  --fs-lg:    1.25rem;    /* 20px  section headings */
  --fs-xl:    1.75rem;    /* 28px  page title */
  --fs-metric:2.5rem;     /* 40px  coverage figures */

  /* spacing: 4-based, no other values permitted */
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
  --s-6: 24px; --s-8: 32px; --s-12: 48px; --s-16: 64px;

  /* radii + motion */
  --r-chip: 2px; --r-card: 6px; --r-panel: 10px;
  --dur-select: 120ms; --dur-verdict: 240ms; --ease: cubic-bezier(.2,.6,.2,1);

  /* type families — system stacks, zero downloads */
  --font-ui:   ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-reduced-motion: reduce) { * { transition-duration: 0ms !important; } }
```

Rules the implementation must not drift from:

- **Monospace** for promise ids, citation `path:line`, test ids, result codes, credit figures, timestamps and metric numbers. UI stack for prose.
- **Colour is a verdict channel.** No coloured buttons, no gradient hero, no brand colour. `--focus` is the single exception and only appears as a 2px focus ring.
- **Every verdict carries a word.** `VerdictTag` always renders the text `proven` / `red` / `stale` / `undesigned` next to its colour (R10.5). No colour-only state anywhere.
- **Motion only on state change**: `--dur-select` on selection outline and panel slide; `--dur-verdict` on verdict colour transition. No entrance animations, no skeleton shimmer, no hover motion. Every declaration is on a `.verdict-*` or `.is-selected` class, which `scripts/check-readonly.mjs`'s sibling CSS scan asserts (R10.4).
- **Borders, not shadows.** Flat dark surfaces separated by `--line`.
- **Density**: node 320×72, rail tile 240×120, panel width 420px, page max width 1680px with `min-width: 1280px` avoided entirely — the graph canvas flexes, so there is no horizontal overflow between 1280 and 1920 (R10.8).

Contrast is not asserted by eye: `lib/tokens.ts` exports the pairs actually used and a property test computes the WCAG ratio for each, requiring ≥4.5 for body text and ≥3 for node labels (R10.6).

### 10.5 Keyboard model (R10.7)

- Graph container is `role="application"` with a visible focus ring; `Tab` enters it, arrow keys move between promise nodes in lane order, `Enter`/`Space` selects and opens the panel, `Escape` closes it and returns focus to the node.
- A parallel `role="list"` of promises is always present in the DOM (visually a compact sidebar list), so keyboard and screen-reader users are never dependent on the canvas.
- `AcceptControl` is a native `<button>` with an accessible name naming the amendment: `Accept amendment am_3b9d21f0 for README line 20`.
- Skip link to main content as the first focusable element.

### 10.6 Diff rendering

`lib/diff.ts` is a ~60-line line-level unified diff (LCS over ≤200 lines is instant) producing `{kind:'ctx'|'del'|'add', text}[]`. `DiffView` renders it in monospace with `--red` for deletions, `--proven` for additions, `--text-2` gutter line numbers. Because the docs-lie diff is nearly always a single line, this looks identical to what a syntax highlighter would produce for prose. Shiki is a droppable upgrade (§18), not a dependency.

### 10.7 Degraded and empty states

- `degraded === true` → `DegradedChip` reading `baseline data only`, and the Proven Coverage tile is **replaced** by the chip rather than showing a number (R2.11).
- `totalPromises === 0` → both figures render the literal `n/a`, no division performed (R9.3).
- `freshness.terminalEventAt === null` → chip reads `never verified` in `--text-2`.
- Age > 24 h → chip in `--stale` amber (R9.7); the boundary is `> 24h`, so exactly 24 h is not amber.

### 10.8 Badge

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

A hand-written 110×20 SVG: label `promises kept`, value `pct`, value background `--proven` when ≥80%, `--stale` 40–79%, `--red` below 40%, `--undesigned` for `n/a`. Only `GET` is exported (R9.4, R9.5).

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
    "prompt": "Run `node bin/kept reconcile`. Then read `.kept/handoff.json` and report: the count of promises with verdict `undesigned` (the suite debt), each newly added claim with its citation, each removed promise, and every open review card. Do not edit documentation, tests or source. If `outcome.exitMeaning` is `paused-resumable`, say so and stop."
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

`bin/kept` → `packages/kept-cli/dist/index.js`. Hand-rolled arg parsing, no dependency. Every command exits **0** unless the CLI itself is broken; Kane's outcomes are data, not exit codes (R2.10).

| Command | Kane invocation (final argv after the invoker adds the enabler) | Family | Timeout | Writes |
|---|---|---|---|---|
| `kept build` | `kane-cli cover --json --mode agent` | Assurance | 60 s | state, snapshot |
| `kept verify --changed <p…>` | `kane-cli testrun run --dry-run` *(plan refresh, if stale)* then `kane-cli testrun run --from-context <ids> --on-failure continue` | ExecutionTestrun | 60 s / 300 s | state, handoff, snapshot |
| `kept verify --all` | `kane-cli testrun run --on-failure continue` | ExecutionTestrun | 300 s | state, handoff, snapshot |
| `kept reconcile` | `kane-cli maintain reconcile --mode agent` | Assurance | 300 s | state, review cards, handoff, snapshot |
| `kept evolve <testPath>` | `kane-cli maintain evolve <ref> --mode agent` | Assurance | 300 s | review cards, handoff |
| `kept amend propose --run <runId>` | none | — | — | amendments, snapshot |
| `kept amend list \| show <id> \| accept <id> \| reject <id>` | none (`accept` triggers a rebuild → `kept build`) | — | — | cited doc file (accept only), amendments, snapshot |
| `kept snapshot` | none | — | — | snapshot only |
| `kept handoff [--run <id>]` | none | — | — | stdout only |
| `kept doctor` | `kane-cli --version` | — | 10 s | stdout only |
| `kept watch` *(nice-to-have)* | none | — | — | loopback accept listener + NDJSON tail |

Flags common to all: `--repo <root>` (default cwd), `--json` (machine-readable stdout), `--router <name>` (overrides config for one invocation), `--member-debug` (sets `KANE_TESTRUN_MEMBER_DEBUG=1` and captures `[member]` stderr lines — R4.12).

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
    assurance-paused.ndjson        ← done status paused, exit_code 3
    failure-*.yaml
  arbitraries.ts                   ← shared fast-check generators (see below)
  *.prop.test.ts                   ← one file per property, tagged
  *.test.ts                        ← examples, edge cases, source-scan checks
```

Shared generators in `arbitraries.ts`: `arbCitation` (file/line/text over generated in-memory docs), `arbPromise`, `arbGraph`, `arbSnapshot` (always schema-valid, includes the empty graph), `arbKaneEvent`, `arbTerminalEvent(family)` (result_code emitted as number *or* string, credits as `credits_consumed` *or* `credits` *or* neither), `arbStream(family)` plus `arbTruncatedStream(family)`, `arbVerdictObject`, `arbMemberStatus`, `arbFailureYaml`, `arbNoisyPrefix` (non-`{` lines), `arbMalformedLine`.

Edge cases the generators must produce, because they are where this system breaks: empty graph; zero `*_test.md` files; `result_code` as `" 740"`; `credits_consumed` absent with `credits` present; a stream whose only line is `run_end`; a stream truncated at every index; a member status string outside the four; a citation line exactly at EOF and exactly one past it; a cited line containing only whitespace; a file with CRLF endings; a doc with no trailing newline; `session_dir` absent from `run_end`.

Non-property tests, deliberately few: the recorded smoke-run regression (R3.25), argv assertions per command, the two source-scan tests (`result_code` strict equality; Ledger mutating handlers/auth/`child_process`), the CSS motion scan, hook-schema validation, and referential integrity of committed evidence. Integration tests (one run each, against the live CLI, recorded and committed): the verdict spike (R6.12), zero-credit replay (R4.6), and the end-to-end closed loop (R11.6).

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

*For any* verdict and *for any* surface that renders it, the verdict's text label is present in the output, the mapped token is the one specified for that verdict with `undesigned` rendered in the neutral token and no non-verdict element using a verdict token; and *for any* foreground and background token pair actually used, the contrast ratio is at least 4.5 to 1 for body text and at least 3 to 1 for graph node labels.

**Validates: Requirements 10.2, 10.3, 10.5, 10.6**

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

*For any* completed hook-triggered invocation, the handoff file validates against its schema and records the outcome, the exit meaning, the terminal-event type and whether a terminal event was seen; for every failing result it additionally records the verdict, the repair branch, the verdict object fields where present, the citation and the resolved evidence path; and whenever the branch is `code-break`, the allowed paths contain only fixture source globs while the forbidden paths include the fixture documentation and the test corpus.

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

Hard floor — none of these may be dropped, because each is directly scored: the three-contract parser, the `VerdictRouter` with both implementations, the committed snapshot and its schema, the graph hero with citations, the two Kiro hooks and the handoff file, the fixture with its eight claims including the breakable and never-true ones, `/badge.svg`, the demo command, and the deployed Ledger.

---

## 19. Build order for the remaining window

Sequenced so that the highest-scoring, least-reversible things exist first and every stage leaves the repo demoable.

1. **Skeleton** — workspaces, tsconfig, vitest, `bin/kept`, `.kept/config.json`. (~30 min)
2. **`kept-core` Kane layer** — `family`, `events`, `coerce`, `exit`, `ndjson`, `evidence`, `invoker`, with the recorded smoke-run regression and Properties 7, 8, 10, 11, 12, 13, 14 green. This is the part that everything else is wrong without. (~2 h)
3. **Promise model + providers + snapshot** — `ids`, admission gate, baseline, merge, canonical snapshot, metrics; Properties 1–6, 21. (~2 h)
4. **Fixture app** — 7 screens, README claims block, `tests/*_test.md` corpus with `@verifies` and `covers`. Snapshot now renders real promises with real citations. (~2 h)
5. **Ledger** — tokens, graph hero, metric rail, panel, `/coverage`, `/badge.svg`, `/runs`; read-only scans green. First screenshot-worthy state. (~3 h)
6. **Router + radius + verify** — `resultCode740`, `failureYamlTriage`, plan cache, `computeBlastRadius`, `kept verify`; Properties 15–18. (~2 h)
7. **Hooks + handoff** — both hook files, `writeHandoff`, the fenced agent prompts; Properties 26, 27. (~1 h)
8. **Repair surfaces** — review cards, `docsAmendment` propose/accept with the sha256 interlock, `/amendments`, `/reviews`; Properties 19, 20. (~1.5 h)
9. **Live Kane** — verdict spike, authored runs, committed `output-*/` recordings, curated evidence, closed-loop record; Property 28. (~2 h)
10. **Submission** — Vercel deploy, README first-20-lines, 120-word summary, 180-second video, commit hygiene. (~1.5 h)
11. **Only if everything above is green** — items from §18, top-down.

Stages 1–3 are the ones that cannot be rushed; stages 5 and 8 are where the visible craft lives; stage 9 is what makes the Verified dimension real rather than claimed.
