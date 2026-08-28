# Implementation Plan: KEPT

## Overview

Twelve stages from design §19, resequenced on one hard change: the Property 18 / R6.12 verdict spike is pulled out of stage 9 and run the moment the fixture has one authored `_test.md` that can be broken (stage 6 below). Everything downstream of the spike depends only on the `VerdictRouter` interface, so its outcome changes exactly one string in `.kept/config.json` — guarded by the router-isolation scan (11.5) — but the answer has to be known before the router, the radius and the hooks are built on top of an assumption.

Two ordering rules carried straight from the amended design:

- **Visual foundation before components.** Stage 8 authors `styles/tokens.css`, `styles/surfaces.css`, the typed token mirror and all three enforcement tests *before* a single Ledger component exists (§19 stage 5), because retro-fitting a light model costs more than authoring against one. Nothing in §18.2 is droppable — the palette, the light/elevation system, the reduced-motion path, typography discipline, the parity test and the forbidden-palette scan are scored Craft, not polish.
- **Motion is built gate-first, then in reverse drop order.** Stage 17 lands `lib/motion.ts`, the `play()` gate and the reduced-motion equivalence test before any flourish, then M5 → M1 from §18.1, so the timebox cuts from the cheap end.

`kept reconcile` is the other substantive change: `kane-cli maintain reconcile` **requires** `--from <file>` and `--source-id <id>`, so stage 12 builds `resolveSourceId` with its four-rung match ladder, the `.kept/sources.json` read-through cache, the seven-row fail-fast ladder including the fork guard, and the six-step no-spawn failure path before `kept reconcile` issues anything.

Every stage leaves the repo demoable: after stage 3 `kept build` writes a snapshot, after stage 5 that snapshot carries real promises with real citations, after stage 9 `npm run demo` is screenshot-worthy, after stage 14 all three repair branches have a surface, after stage 17 the page moves and still renders identically under `prefers-reduced-motion: reduce`.

Commit discipline (R14.2) is not a trailing task. Every implementation sub-task below carries a **Commit** line as part of its definition of done — the plan yields 90-plus named commits with no "commit everything" step, because judges read commit history as evidence of work inside the event window.

Language: TypeScript throughout (design §2.1). Test runner is `vitest --run`, never watch; `fast-check` runs a minimum of 100 cases per property. Runtime dependency budget is the **nine** packages in design §2.2 — `next`, `react`, `react-dom`, `tailwindcss`, `@xyflow/react`, `zod`, `yaml`, `clsx`, and `animejs` pinned to exactly `4.5.0` (not a caret). Do not install Shiki, dagre/elkjs, commander/yargs, concurrently, micromatch, Playwright/Puppeteer, framer-motion, GSAP, lottie, any icon package, any font package, or Docker; the hand-rolled replacements are tasks 9.2, 11.9, 14.6 and 3.18. The Kane skill installs only for Claude Code, Codex CLI and Gemini CLI — **not** Kiro — so no task installs it.

## Tasks

- [x] 1. Repository skeleton and toolchain
  - [x] 1.1 Create the npm workspaces root and test toolchain
    - Root `package.json` with workspaces `apps/*`, `packages/*` and scripts `demo`, `loop`, `build:snapshot`, `test` (`vitest --run`), `check` (`node scripts/check-readonly.mjs && tsc -b && vitest --run`)
    - `tsconfig.base.json` (strict), single root `vitest.config.ts` with projects `kept-core` and `kept-cli` plus a jsdom project for `apps/ledger`
    - Install only the nine runtime packages of design §2.2 with `animejs` written as the exact literal `"4.5.0"`; dev deps `typescript`, `vitest`, `fast-check`, `@testing-library/react`, `jsdom`, `@types/*`
    - Commit: "chore: npm workspaces root, strict tsconfig, vitest root config"
    - _Requirements: 12.3, 13.1_

  - [x] 1.2 Create package skeletons, `bin/kept`, and working state
    - `packages/kept-core` and `packages/kept-cli` (`bin: { "kept": "dist/index.js" }`); `bin/kept` shebang launcher
    - `.kept/config.json` with `verdictRouter`, `memberDebug`, `timeouts.hookMs` 300000, `timeouts.enrichmentMs` 60000
    - `.gitignore`: exclude `.context/` and `.kept/`, force-add `output-*/` and the curated evidence paths
    - Commit: "chore: kept-core and kept-cli packages, bin/kept, .kept config"
    - _Requirements: 6.10, 13.6, 13.7_

  - [x] 1.3 Implement `diagnostics.ts`
    - `Diagnostic { code, severity, message, file, line, at }` and `DiagnosticSink`; every later module reports through this rather than throwing
    - Commit: "feat(core): diagnostic record and sink"
    - _Requirements: 2.3, 3.24_

- [x] 2. Kane three-contract layer
  - [x] 2.1 Implement `kane/family.ts`
    - `CommandFamily`, `TerminalType<F>`, `NdjsonEnabler`, `FamilyContract<F>` with **no public constructor** — `contractFor(family)` is the only way to obtain one
    - `familyForArgv(argv)` reverse lookup; the `CONTRACTS` table encodes terminal type, NDJSON enabler, exit-3 meaning and evidence location once, and lists `context extract`, `context list`, `design tests`, `maintain reconcile`, `maintain evolve`, `cover`, `cover gaps` under Assurance
    - Commit: "feat(core): three Kane command-family contracts"
    - _Requirements: 3.2, 3.4, 3.5_

  - [x] 2.2 Implement `kane/coerce.ts`
    - `resultCode()` accepting number, decimal string and whitespace-padded string, returning null for absent/non-numeric; `credits()` preferring `credits_consumed` and accepting `credits`
    - This file is the only site in the repo permitted to compare `result_code`
    - Commit: "feat(core): result_code and credits coercing accessors"
    - _Requirements: 3.10, 3.11, 3.13, 3.14_

  - [x] 2.3 Write source scan 1 of 6 — no raw `result_code` comparison
    - `packages/kept-core/test/no-raw-result-code.test.ts` reads every `.ts` under `packages/kept-core/src` and `packages/kept-cli/src` and fails if `/result_code\s*(===|!==|==|!=)/` matches outside `kane/coerce.ts`
    - Architectural guard, not coverage — it is what keeps the three-way branch from silently never firing on the observed mixed typing
    - Commit: "test(core): forbid raw result_code comparison outside coerce.ts"
    - _Requirements: 3.12_

  - [x] 2.4 Write property test for result-code coercion
    - **Property 10: `result_code` coercion makes string and number forms equivalent**
    - **Validates: Requirements 3.11, 3.12, 3.13, 6.8**

  - [x] 2.5 Write property test for the credits accessor
    - **Property 11: The credits accessor prefers `credits_consumed` and accepts `credits`**
    - **Validates: Requirements 3.10, 14.7**

  - [x] 2.6 Implement `kane/exit.ts`
    - `exitMeaning(family, code, killed)` total over all integers and null; `(Assurance, 3)` → `paused-resumable`, `(ExecutionTestrun, 2)` → `preflight-rejected`, `130` → `force-interrupted`, `127`/ENOENT → `kane-not-found`, killed → `killed-by-timeout`
    - Commit: "feat(core): per-family exit-code interpretation"
    - _Requirements: 3.15_

  - [x] 2.7 Write property test for exit-code interpretation
    - **Property 12: Exit-code interpretation is total and family-correct**
    - **Validates: Requirements 3.14, 3.15, 4.11, 11.9, 11.10, 11.11**

  - [x] 2.8 Implement `kane/events.ts`
    - Typed `KaneEvent` union plus `Run_End`, `Testrun_Plan`, `testrun_member_end`, `Testrun_Done`, `Assurance_Done`, `ProgressEvent`, `VerdictObject`; the known-type set from design §4.3 treated as open
    - Assurance envelope `{ type, v: 1, verb }` typed as present-and-optional per the verified refusal envelope (§5.3.1); `run_dir` typed as `readonly runDirLegacy?: string` only, never read from disk
    - Commit: "feat(core): typed Kane event surface for all three families"
    - _Requirements: 3.16, 3.17, 3.18, 3.20, 3.21, 3.22_

  - [x] 2.9 Implement `kane/ndjson.ts`
    - `parseStream(contract, lines)` as the only exported entry point — a call cannot exist without a family named at the call site
    - `ParsedStream<F>` discriminated union with `terminal` present only on the `complete` arm; `crashed` carries the expected terminal type and the outcome-unknown diagnostic
    - Line handling: skip non-`{` prefix lines silently, diagnose malformed lines with their one-based line number and continue, classify by `step` key first, last terminal-type event wins, unknown types retained, `coverage` payload exposed raw
    - Commit: "feat(core): family-gated NDJSON parser"
    - _Requirements: 3.1, 3.3, 3.6, 3.8, 3.9, 3.23, 3.24_

  - [x] 2.10 Author the hand-written NDJSON and failure-yaml fixtures
    - `packages/kept-core/test/fixtures/`: `run-passed.ndjson` (copy-reference of the twelve-line `docs/kane/smoke-run.ndjson`), `run-failed-740.ndjson` (`run_end` with `result_code` as the string `"740"` plus a verdict object), `testrun-mixed.ndjson` (`testrun_plan` + one member of **each** of `passed`/`failed`/`broken`/`interrupted` + `testrun_summary` + `testrun_done`), `testrun-preflight-invalid.ndjson` (`valid: false`, one member per rejection reason), `testrun-crashed.ndjson` (truncated before `testrun_done`), `assurance-cover-done.ndjson`, `assurance-paused.ndjson` (`done` status `paused`, `exit_code` 3)
    - `assurance-cover-refused.ndjson` is the **verbatim two lines** of the verified no-context-store refusal envelope from design §5.3.1 — do not paraphrase them
    - `failure-*.yaml`: one per triage class of §6.3 — `failure-product-bug.yaml`, `failure-selector.yaml`, `failure-assertion.yaml`, `failure-unparseable.yaml`
    - Commit: "test(core): hand-authored NDJSON and failure.yaml fixtures"
    - _Requirements: 3.25, 6.7_

  - [x] 2.11 Implement `test/arbitraries.ts`
    - Generators: `arbCitation` (over generated in-memory docs), `arbPromise`, `arbGraph`, `arbSnapshot` (always schema-valid, includes the empty graph), `arbKaneEvent`, `arbTerminalEvent(family)` (emitting `result_code` as number *or* string, credits as `credits_consumed` *or* `credits` *or* neither), `arbStream(family)`, `arbTruncatedStream(family)`, `arbVerdictObject`, `arbMemberStatus`, `arbFailureYaml`, `arbNoisyPrefix`, `arbMalformedLine`, `arbStoreSourceListing`
    - Named edge cases the generators must reach: empty graph; zero `*_test.md` files; `result_code` as `" 740"`; `credits_consumed` absent with `credits` present; a stream whose only line is `run_end`; a stream truncated at every index; a member status outside the four; a citation line exactly at EOF and exactly one past it; a cited line of only whitespace; CRLF endings; a doc with no trailing newline; `session_dir` absent from `run_end`
    - Commit: "test(core): shared fast-check generators and named edge cases"
    - _Requirements: 3.1, 3.13, 3.10_

  - [x] 2.12 Write property test for parser robustness
    - **Property 7: Parsing is robust and lossless per line**
    - **Validates: Requirements 3.1, 3.8, 3.9, 3.23, 3.24**

  - [x] 2.13 Write property test for terminal-event recognition and crash classification
    - **Property 8: Terminal-event recognition is family-determined and crash classification is exhaustive**
    - **Validates: Requirements 2.6, 2.7, 3.2, 3.6, 4.7, 5.2**

  - [x] 2.14 Write property test for faithful field exposure
    - **Property 13: Family-typed fields are exposed faithfully and `run_dir` is never read**
    - **Validates: Requirements 3.16, 3.17, 3.18, 3.21, 3.22**

  - [x] 2.15 Write the pinned smoke-run regression test
    - Parse all twelve lines of the committed `docs/kane/smoke-run.ndjson` as an `ExecutionRun` stream; assert the `run_end` event is identified as terminal, that `resultCode()` reads both the top-level number `100` and the `per_flow_metadata[0]` string `"100"` to the same value, and that **zero** diagnostics are recorded
    - Not optional: this is the only proof the parser reads a real recorded stream
    - Commit: "test(core): pin the recorded smoke run as a parser regression"
    - _Requirements: 3.25_

  - [x] 2.16 Write the `cover` refusal regression test
    - Parse `assurance-cover-refused.ndjson` as an Assurance stream; assert `kind: 'complete'` (a refusal is complete, not crashed), `terminal.status === 'refused'`, event `exit_code` 2 exposed separately from the process exit code, `exitMeaning === 'failure'`, and the resulting `degradedReason` string `assurance-status:refused` with Kane's `message` quoted verbatim in the diagnostic
    - Not optional: it is the regression that keeps a "no context store" state from reading as a crash
    - Commit: "test(core): cover refusal envelope regression"
    - _Requirements: 2.7, 2.8, 3.22_

  - [x] 2.17 Implement `kane/evidence.ts`
    - `resolveEvidenceDir()` — `session_dir/evidence` for ExecutionRun (null when `session_dir` is absent), `<cwd>/.testmuai/evidence` for ExecutionTestrun, null for Assurance; no event field is ever consulted for a path
    - `listArtifacts()` newest pack by directory mtime, classifying `annotated`, `screenshot`, `har`, `console`, `log`, `failure-yaml`, `other` — unknown files listed, never dropped
    - Commit: "feat(core): family-derived evidence pack resolution"
    - _Requirements: 3.19_

  - [x] 2.18 Write property test for evidence resolution
    - **Property 14: Evidence-pack locations are resolved from the family, never from the event**
    - **Validates: Requirements 3.19, 4.13, 6.11**

  - [x] 2.19 Implement `kane/failureYaml.ts`
    - `loadFailureYaml()` over the `yaml` package, returning null for absent or unparseable files; reads the four committed `failure-*.yaml` fixtures
    - Commit: "feat(core): failure.yaml loader"
    - _Requirements: 6.7_

  - [x] 2.20 Implement `kane/invoker.ts`
    - `KaneInvoker.invoke()` resolves the binary once per process, asserts `familyForArgv(argv) === spec.family`, applies the contract's NDJSON enabler (`--agent` / nothing / `--mode agent`) and asserts `--agent` is absent for ExecutionTestrun
    - `stdio: ['ignore','pipe','pipe']` so `ask_user` self-disables — and record in a comment that this is exactly why any `context ingest` KEPT performs lands only and never extracts (§4.9.1); incremental line splitting with `onLine`; SIGTERM then SIGKILL at 2 s on timeout; last 50 stderr lines retained
    - Never throws for any Kane behaviour — absence, auth failure, refusal, crash and timeout are all data
    - Commit: "feat(core): KaneInvoker with per-family enabler and timeout kill"
    - _Requirements: 2.12, 3.4, 3.5, 11.8_

  - [x] 2.21 Write the NDJSON-enabler and family-mismatch assertions
    - Assert against a stub spawn: ExecutionRun argv gains exactly `--agent`; ExecutionTestrun argv gains **nothing** and an `--agent` anywhere in it is rejected; Assurance argv gains `--mode agent`; a family/argv mismatch throws at development time; stdin is always `ignore`
    - Not optional — it is the per-command argv contract at the invoker seam, extended per KEPT command in 12.13
    - Commit: "test(core): per-family NDJSON enabler argv assertions"
    - _Requirements: 3.4, 3.5_

- [x] 3. Promise model, providers, and the snapshot contract
  - [x] 3.1 Implement `model/promise.ts` and `model/ids.ts`
    - `Verdict`, `Citation`, `DesignedTest`, `RepairAnnotation`, `PromiseRecord`, `PromiseGraph`, `GraphEdge`; `designedTest` is explicit null, never undefined
    - `normaliseClaim()` and `promiseId(citationFile, rawClaim)` keyed on file plus normalised claim only — never line number, never ordering; node id prefixes `d_`, `p_`, `t_`, `ev_`
    - Commit: "feat(core): promise model and line-independent id derivation"
    - _Requirements: 1.1, 1.2, 1.6_

  - [x] 3.2 Write property test for identifier stability
    - **Property 1: Promise identifiers are stable across rebuilds**
    - **Validates: Requirements 1.2**

  - [x] 3.3 Implement the citation admission gate
    - `admitPromise()` as the single funnel: reject `no-citation` naming the supplying provider, reject `line-out-of-range` carrying requested line and actual count, reject `file-missing`
    - On admission, overwrite `citation.text` with the verbatim line read from disk; one-based indexing, no trimming, no phantom final line for a file ending in `\n`
    - Commit: "feat(core): citation admission gate"
    - _Requirements: 1.3, 1.4, 1.5_

  - [x] 3.4 Write property test for graph admission
    - **Property 2: Graph admission requires a resolvable citation**
    - **Validates: Requirements 1.3, 1.4, 1.5**

  - [x] 3.5 Implement `providers/baseline.ts`
    - Scan `**/*_test.md` skipping `node_modules`, `.git`, `.next`, `dist`, `output-*`, `.testmuai`; 20-line hand-rolled frontmatter reader; `@verifies\s+(?<file>[^\s:]+):(?<line>\d+)` grammar with trailing free text ignored
    - Every path wrapped so `collect` resolves `ok: true` for every repository state including zero `*_test.md` files; never sets degraded
    - Commit: "feat(core): infallible baseline promise provider"
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.6 Write property test for baseline totality
    - **Property 5: The baseline provider is total**
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [x] 3.7 Implement `providers/enrichment.ts` and `providers/coverage.ts`
    - Invoke `cover --json` under the Assurance family with a 60 s budget; accept enriched axes only on `complete` + `done` + `status: complete` + a `coverage` payload present
    - Map each failure observation to its specific `degradedReason` per design §5.3, including `assurance-status:refused` from the verified envelope; project the coverage payload tolerantly, keyed on `test_id` then normalised path, unmatched entries as diagnostics, zero projected entries as `coverage-payload-unreadable`
    - Commit: "feat(core): enrichment provider gated on the Assurance done event"
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9, 2.12_

  - [x] 3.8 Implement `providers/merge.ts`
    - Baseline is sole citation authority; union by id preferring enrichment for `designedTest` and `verdict`; apply axis overlays; default missing designed test to `undesigned`; set `degraded` from enrichment; sort promises by id and edges by `(kind, from, to)`
    - Commit: "feat(core): canonical provider merge"
    - _Requirements: 1.7, 2.1, 5.5_

  - [x] 3.9 Write property test for merge precedence
    - **Property 4: Provider merge prefers enrichment on the assurance axes and baseline on citations**
    - **Validates: Requirements 1.7, 2.1**

  - [x] 3.10 Write property test for degradation
    - **Property 6: Degradation preserves state and never fails the build**
    - **Validates: Requirements 2.7, 2.8, 2.9, 2.10, 2.12**

  - [x] 3.11 Implement `model/metrics.ts`
    - `computeMetrics()` producing total, designed, proven, red, stale and undesigned counts plus both coverage ratios; both ratios null with **no division performed** when total is zero; `provenCoverage` null when degraded
    - Commit: "feat(core): coverage metrics with zero-promise guard"
    - _Requirements: 5.8, 9.1, 9.2, 9.3_

  - [x] 3.12 Write property test for metric consistency
    - **Property 21: Metrics are arithmetically consistent and never divide by zero**
    - **Validates: Requirements 2.11, 5.8, 9.1, 9.2, 9.3**

  - [x] 3.13 Implement `model/snapshot.ts` — the CLI↔UI seam schema
    - Full zod schema from design §9.1 with the `.superRefine` cross-field rules: count agreement, coverage nullability, evidence-reference resolution, edge endpoint resolution, freshness type/family consistency; violations name the offending path
    - Must exist and be green before anything in the Ledger reads a snapshot
    - Commit: "feat(core): ledger snapshot zod schema with cross-field refinements"
    - _Requirements: 8.8_

  - [x] 3.14 Implement `model/canonical.ts`
    - `serialiseSnapshot()` with recursive sorted keys, 2-space indent, arrays pre-sorted by id, timestamps as strings only, no `Date` surviving into the structure; `parseSnapshot()` zod-parsing and throwing with a field path
    - Commit: "feat(core): canonical snapshot serialisation"
    - _Requirements: 1.8_

  - [x] 3.15 Write property test for snapshot round-tripping
    - **Property 3: Snapshot serialisation round-trips and is canonical**
    - **Validates: Requirements 1.8, 8.8**

  - [x] 3.16 Implement `state.ts` — the single write guard
    - `mayWriteVerdicts(result)` true only for `stream.kind === 'complete'` with `exitMeaning ∈ {success, failure}`; `StateStore.applyRun` calls it first and returns state unchanged otherwise
    - Crashed, timed out, paused, force-interrupted, preflight-rejected and kane-not-found preserve prior verdicts and freshness by construction; untouched records are deep-frozen
    - Commit: "feat(core): state store with the single verdict write guard"
    - _Requirements: 2.10, 3.7, 5.3, 5.4_

  - [x] 3.17 Write property test for the write guard
    - **Property 9 (state clause): Verdicts and freshness move only on a proven outcome**
    - **Validates: Requirements 3.7, 5.3, 11.8, 11.9**

  - [x] 3.18 Implement the CLI entry, `kept build`, and `kept snapshot`
    - Hand-rolled arg parsing (~40 lines, no commander); common flags `--repo`, `--json`, `--router`, `--member-debug`; every command exits 0 unless the CLI itself is broken or was given mutually exclusive flags (§13.2.3, wired in 12.7)
    - `kept build` runs both providers and writes `.kept/state.json`; `kept snapshot` writes `apps/ledger/data/ledger.snapshot.json` through `serialiseSnapshot`
    - Commit: "feat(cli): kept build and kept snapshot"
    - _Requirements: 2.10, 2.12, 4.14_

- [x] 4. Checkpoint — core is honest
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Fixture application and designed-test corpus
  - [x] 5.1 Build Kepler Coffee — 7 screens and state modules
    - Routes `/`, `/shop`, `/product/[slug]`, `/cart`, `/checkout`, `/orders`, `/settings`; `lib/catalog.ts` (six coffees), `lib/cart.ts` (`addItem`, `setQuantity`, `subtotal`), `lib/currency.ts`, `lib/storage.ts`
    - No API routes, no database, no `fetch`; all state in `localStorage`; `next dev -p 3100` / `next start -p 3100`; landing screen is static so it renders well inside 30 s
    - Commit: "feat(fixture): Kepler Coffee, seven screens on port 3100"
    - _Requirements: 12.1, 12.2, 12.3, 12.8_

  - [x] 5.2 Author the README claims block
    - `apps/fixture/README.md` carrying exactly the eight verbatim one-line claims from design §12.2, one claim per line so a citation line number identifies exactly one claim
    - The subtotal claim is the breakable one; the 10-percent-discount claim is the never-true one and no discount logic is ever added
    - Commit: "docs(fixture): eight one-line promises, one breakable, one never true"
    - _Requirements: 12.4, 12.5, 12.6, 12.7_

  - [x] 5.3 Write property test for claim-to-promise correspondence
    - **Property 29: Fixture claims are one-to-one with promises**
    - **Validates: Requirements 12.4, 12.5**

  - [x] 5.4 Write `tests/cart_subtotal_test.md` (T-3) — the spike's subject
    - Frontmatter `test_id`, `tags`, `covers: [apps/fixture/lib/cart.ts, apps/fixture/app/cart/**]`; body with `<!-- @verifies apps/fixture/README.md:16 -->` and the navigate/assert steps
    - This is the one authored test the verdict spike needs, so it lands before the rest of the corpus
    - Commit: "test(kane): cart subtotal test-md, the breakable promise"
    - _Requirements: 12.6, 4.3_

  - [x] 5.5 Write the remaining seven `*_test.md` files
    - `home_cta`, `shop_filter`, `product_currency`, `checkout_validation`, `orders_persist`, `settings_currency`, and `cart_discount` (T-7, the docs-lie test that asserts the never-true claim)
    - Each with `covers:` globs and one `@verifies` tag citing its README line
    - Commit: "test(kane): complete the eight-test designed corpus"
    - _Requirements: 12.4, 12.7, 4.3_

  - [x] 5.6 Rebuild the snapshot from the real fixture
    - Run `kept build && kept snapshot`; assert eight promises with verbatim citations into `apps/fixture/README.md` and commit the resulting `ledger.snapshot.json`
    - Expect `degraded: true` with `degradedReason: assurance-status:refused` at this point — there is no `.context/` store until stage 15.1, and that is the honest state
    - Commit: "chore: first snapshot with eight real cited promises"
    - _Requirements: 1.3, 2.2, 2.11, 4.14_

- [x] 6. Verdict spike — front-loaded empirical confirmation **[LIVE KANE]**
  - [x] 6.1 **[LIVE KANE]** Author T-3 against the running fixture and commit its recording
    - Start the fixture on 3100, author `tests/cart_subtotal_test.md` with `kane-cli`, capture the full NDJSON stream and the reported `credits_consumed`
    - Force-add the produced `output-*/` recording directory so later replays are free
    - Commit: "chore(kane): authored T-3 and committed its replay recording"
    - _Requirements: 13.6, 14.7_

  - [x] 6.2 **[LIVE KANE]** Break the subtotal and replay T-3 from cache
    - Apply the one-line break in `apps/fixture/lib/cart.ts` (`subtotal` ignores quantity), replay T-3 with stdout piped, and capture the failing stream verbatim
    - Record whether the terminal event carries `result_code` 740 and whether an inline `verdict` object is present on a failing cached replay, and what `credits()` reports
    - Commit: "chore(kane): captured failing cached replay of T-3"
    - _Requirements: 4.6, 6.12, 12.6_

  - [x] 6.3 **[LIVE KANE]** Record the spike outcome as a committed integration test and set the default router
    - Write `docs/kane/verdict-spike.md` with the invocation, the observed terminal event, the presence or absence of `result_code` 740 and the `verdict` object, and the resulting decision
    - Commit the captured stream as an integration-test input asserting the routed branch, and set `.kept/config.json` `verdictRouter` accordingly — the only thing in the repo the spike's outcome changes, fenced by the isolation scan in 11.5
    - Commit: "docs(kane): verdict spike outcome and selected default router"
    - _Requirements: 6.12, 6.13_

  - [x] 6.4 Promote the captured streams into the committed fixture set
    - Replace the hand-authored `run-failed-740.ndjson` with the real capture where the observation supports it, and derive `testrun-mixed.ndjson`, `testrun-preflight-invalid.ndjson` and `testrun-crashed.ndjson` from the real stream shape; keep the hand-authored variant only where no real capture exists, annotated as synthetic
    - Re-run the parser and router suites against the promoted fixtures with no test edits — if a test needed editing, the fixture disagreed with reality and the code is what changes
    - Commit: "test(core): promote real captured Kane streams into the fixture set"
    - _Requirements: 3.25, 6.7_

- [x] 7. Checkpoint — the spike's answer is recorded
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Ledger visual foundation — tokens, light, and enforcement before components (§19 stage 5, §18.2)
  - [x] 8.1 Author `styles/tokens.css` and the typed mirror `lib/tokens.ts`
    - The full token set of design §10.4.1 verbatim: warm desaturated ink ramp `--ink-000` `#14120F` → `--ink-050` `#1B1815` → `--ink-100` `#221E1A` → `--ink-150` `#2A251F`; `--hairline`/`--hairline-strong`; light tokens `--light-edge`, `--light-edge-strong`, `--light-wash`, `--occlude`; text ramp `#F2EDE4` / `#B6ADA0` / `#9A9184`
    - Oxidised verdict hues as the only chromatic channel: patina `#6FB894` proven, ochre `#D9A64A` stale, clay `#D97A66` red, stone-sage `#9A9184` undesigned, plus the four low-alpha `--wash-*` tokens and the single `--focus` `#7FA6BC`
    - Motion tokens (`--dur-micro` 90ms → `--dur-figure` 760ms, `--stagger-node` 24ms, the three cubic-bezier eases), the eight-step type scale, line heights, tracking, 4-based spacing, three radii, system font stacks
    - `lib/tokens.ts` exports `TOKENS` as literals and `CONTRAST_PAIRS` with each pair's role `body` | `node-label` | `non-text`
    - Commit: "feat(ledger): warm ink palette, oxidised verdict hues, motion and type tokens"
    - _Requirements: 10.1, 10.2, 10.3, 10.6_

  - [x] 8.2 Author `styles/surfaces.css` — the light and elevation system
    - One implied source above and 15° off vertical: 1px `inset` top-edge highlight per level, two stacked occlusion shadows (tight contact + wide ambient) in warm near-black `--occlude` only, `linear-gradient(176deg, var(--light-wash), transparent 62%)` plane wash at 2.8% amplitude, inverted ramp for wells (inset top shadow, `--light-edge` on the bottom)
    - Exactly three classes — `.surface-raised`, `.surface-raised-2`, `.surface-well` — and they are the **only** way a component authors depth; `--elev-3` declared but unused
    - Commit: "feat(ledger): light, occlusion and elevation as three surface classes"
    - _Requirements: 10.1, 10.6_

  - [x] 8.3 Write the visual enforcement trio (source scan 6 of 6 included)
    - **Contrast** over the whole ramp: compute the WCAG ratio for every `CONTRAST_PAIRS` entry on all four ink surfaces plus the badge's inverted pairs, requiring ≥4.5 for `body`, ≥3 for `node-label`, and asserting the lowest measured ratio in the matrix is 4.89:1 (`--text-200`/`--verdict-undesigned` on `--ink-150`)
    - **Parity** both directions: every `--custom-property` in `tokens.css` has an identical-valued `TOKENS` entry and vice versa, so a palette edit cannot drift the test's input away from the browser's
    - **Forbidden-palette scan**: fails on `backdrop-filter`, any hex whose computed saturation exceeds 70%, a `linear-gradient` mixing more than two hue families, a `box-shadow` whose colour is not `--occlude` or a `--light-edge*` token, an inline `box-shadow` outside `surfaces.css`, and any emoji codepoint under `apps/ledger/**`
    - None of the three is optional (§18.2) — without them the palette silently rots
    - Commit: "test(ledger): contrast over the whole ramp, token parity, forbidden palette"
    - _Requirements: 10.2, 10.3, 10.6_

  - [x] 8.4 Write the typography discipline scan (source scan 5 of 6)
    - Mono-as-texture rule: enumerate mono-classed elements across `apps/ledger/components/**` and fail on any whose text content is a sentence (a space-separated run of four or more non-identifier words); mono is permitted only for promise ids, `path:line` citations, test ids, `result_code`/`reason_code`, credit figures, ISO timestamps, member statuses, diff bodies and metric numerals
    - Assert `font-variant-numeric: tabular-nums lining-nums` is present wherever a number animates or aligns — `MetricFigure`, the credits column, run durations, the diff gutter
    - Assert the `--wash-*` tokens are never applied behind text, cross-checking the exclusion Property 22 relies on rather than trusting it
    - Commit: "test(ledger): mono-as-texture and tabular-numeral typography scan"
    - _Requirements: 10.1, 10.6_

  - [x] 8.5 Build the app shell with the reduced-motion state
    - `app/layout.tsx` importing `tokens.css` then `surfaces.css`, ink background, system font stack, skip link as the first focusable element, page max width 1680px and no `min-width` anywhere
    - The `@media (prefers-reduced-motion: reduce)` block from §10.6.4 as CSS-level insurance: zero durations, `animation-iteration-count: 1`, `scroll-behavior: auto`
    - Commit: "feat(ledger): app shell, skip link, reduced-motion CSS insurance"
    - _Requirements: 10.1, 10.7, 10.4_

  - [x] 8.6 Write the widened CSS motion scan
    - Assert the reduced-motion block exists; that every `transition` and `animation` declaration under `apps/ledger/**` targets only `opacity`, `transform`, `color`, `background-color`, `border-color`, `outline-color` or `box-shadow`; that no declaration animates `width`, `height`, `top` or `left`; and that no `animation-iteration-count` exceeds 1
    - Also fails on hover bounce/scale, skeleton shimmer, parallax, scroll-driven motion and any ambient loop
    - Not optional — it is the guard that keeps stage 17 honest before stage 17 exists
    - Commit: "test(ledger): widened CSS motion scan"
    - _Requirements: 10.4_

  - [x] 8.7 Implement the optical alignment of the metric rail
    - `%` set at `--fs-lg` with `vertical-align: baseline` and `-0.06em` right margin so the digits, not the glyph run, align to each tile's optical left edge; `n/a` set at `--fs-lg` and baseline-aligned to the digits it replaces so a degraded rail keeps the rail's rhythm; tile labels on the shared 4px baseline grid
    - Commit: "feat(ledger): optically aligned metric rail figures and n/a"
    - _Requirements: 9.3, 10.1_

- [x] 9. Ledger projection — components and routes
  - [x] 9.1 Implement build-time snapshot loading
    - `lib/snapshot.ts` importing `data/ledger.snapshot.json` and running `parseSnapshot`, so an absent or invalid snapshot fails the build with a message naming the field path; zero Kane invocations
    - Commit: "feat(ledger): schema-validated build-time snapshot load"
    - _Requirements: 8.6, 8.8_

  - [x] 9.2 Implement `lib/layout.ts` and `lib/relativeTime.ts`
    - Deterministic lane layout (documents 0, promises 1, tests 2, evidence 3; `LANE_X = [0,360,760,1080]`, `ROW_H = 92`; rows sorted by verdict rank then id so red sorts to the top) as a pure function of the snapshot — no dagre, no physics, no jitter between screenshots
    - Relative-time formatter over ISO 8601 strings with a strict `> 24h` ochre boundary and a `never verified` state for null
    - Commit: "feat(ledger): deterministic lane layout and relative time"
    - _Requirements: 9.6, 9.7, 10.8_

  - [x] 9.3 Write property test for freshness rendering
    - **Property 24: Freshness rendering is monotone with a hard 24-hour threshold**
    - **Validates: Requirements 9.6, 9.7**

  - [x] 9.4 Build `MetricRail`, `MetricFigure`, `FreshnessChip`, `DegradedChip`, `VerdictTag`
    - `VerdictTag` always renders the word `proven`/`red`/`stale`/`undesigned` beside its colour; `undesigned` uses the neutral stone-sage token; tag borders may carry a `--wash-*` at 1px and nothing else
    - When `degraded`, the Proven Coverage tile is **replaced** by the `baseline data only` chip at the tile's exact footprint rather than showing a number; `totalPromises === 0` renders the literal `n/a`
    - `MetricFigure` renders its final value directly for now and carries the final value in its accessible name from first paint — the count-up in 17.7 is layered on later and must not change this DOM
    - Commit: "feat(ledger): metric rail, verdict tags, degraded and freshness chips"
    - _Requirements: 2.11, 9.1, 9.2, 9.3, 10.2, 10.3, 10.5_

  - [x] 9.5 Write property test for verdict presentation and contrast
    - **Property 22 (presentation and contrast clauses): Verdict presentation always pairs colour with a word, at accessible contrast on every surface of the elevation ramp**
    - **Validates: Requirements 10.2, 10.3, 10.5, 10.6**

  - [x] 9.6 Build `PromiseGraph`, `PromiseNode`, `PromisePanel`
    - React Flow used for panning, zooming, edges and viewport only; node is 320×76 on `.surface-raised` with an id chip, claim clamped to 2 lines (full text in `title`), `path:line` citation and verdict tag, and a 3px verdict-wash left edge
    - Panel (440px, `.surface-raised-2`) opens on selection or `?p=<id>` with the verbatim cited text in a `.surface-well` citation well, designed test, verdict, repair annotation and evidence artefact links
    - Keyboard model from §10.8: graph as `role="application"` with a visible focus ring, arrow keys in lane order, `Enter`/`Space` to select, `Escape` to close and restore focus, plus the always-present parallel `role="list"` sidebar; no horizontal overflow between 1280 and 1920 px
    - Commit: "feat(ledger): promise graph hero, node, and detail panel"
    - _Requirements: 8.1, 8.2, 8.3, 10.7, 10.8_

  - [x] 9.7 Write property test for projection completeness
    - **Property 23: Every promise is reachable, selectable and evidenced in the projection**
    - **Validates: Requirements 7.5, 8.1, 8.2, 8.3, 10.7**

  - [x] 9.8 Build `/coverage` and `/runs`
    - `/coverage` is the shareable unauthenticated page: both coverage figures, freshness, every promise with its verdict
    - `/runs` renders `snapshot.runs[]`: family, command, status, coerced result code, credits, exit meaning, and the honest failure vocabulary — `outcome unknown`, `paused, resumable`, `timed out`, preflight reasons, `reconcile-source-unresolved` with Kane's suggested `context ingest` command quoted, `reconcile-source-forked` with both conflicting source ids, and the refusal message quoted verbatim
    - Commit: "feat(ledger): public coverage page and terminal-event run log"
    - _Requirements: 9.8, 4.9, 4.11, 5.3_

  - [x] 9.9 Build `/badge.svg`
    - `route.ts` exporting **GET only** with `dynamic = 'force-static'`, `content-type: image/svg+xml`, hand-written flat 110×20 SVG, proven coverage as a whole-number percentage or `n/a`, verdict fill by band with `--ink-000` text
    - Commit: "feat(ledger): GET-only proven-coverage badge"
    - _Requirements: 9.4, 9.5_

  - [x] 9.10 Write property test for the badge
    - **Property 25: The badge is valid SVG reporting a whole-number percentage**
    - **Validates: Requirements 9.4, 9.5**

  - [x] 9.11 Implement `scripts/demo.mjs`
    - Zero-dependency spawner for `next dev -p 3100` in `apps/fixture` and `next dev -p 3000` in `apps/ledger`, prefixed output forwarding, both URLs printed, children killed on SIGINT, zero Kane spawns
    - Commit: "feat: npm run demo boots both apps with zero dependencies"
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 9.12 Write the Ledger read-only source scan (source scan 2 of 6)
    - `scripts/check-readonly.mjs` plus its test wrapper: fail if `apps/ledger` contains any non-GET route handler, server action, `middleware.ts`, auth reference, `child_process`/`exec` import, or the string `kane`
    - Wired into both `npm test` and `npm run check` so the read-only guarantee is checked on every run and every build
    - Commit: "test: source scan for the ledger read-only guarantee"
    - _Requirements: 8.4, 8.5, 8.6_

- [x] 10. Checkpoint — first screenshot-worthy state
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Verdict router, blast radius, and `kept verify`
  - [x] 11.1 Implement `verdict/router.ts` and `verdict/memberStatus.ts`
    - `RepairBranch`, `VerdictObject`, `FailureContext` (with lazy `loadFailureYaml`), `RoutedRepair`, `VerdictRouter`, `selectRouter(cfg)` falling back to `resultCode740` with a diagnostic on an unknown value
    - `memberStatusToVerdict` total: `passed→proven`, `failed`/`broken→red`, `interrupted→stale`, unknown→`stale` flagged unknown; only `failed` and `broken` enter the router
    - Commit: "feat(core): verdict router strategy interface and member status mapping"
    - _Requirements: 4.8, 6.1, 6.10_

  - [x] 11.2 Write property test for member status mapping
    - **Property 15: Member status maps totally onto four verdicts**
    - **Validates: Requirements 3.20, 4.8, 4.9**

  - [x] 11.3 Implement `verdict/resultCode740.ts`
    - Rule order from design §6.2: the verdict object outranks the numeric code; `confirmed: false → test-drift`, `confirmed: true → code-break`, no object with coerced 740 → `code-break`, no object with a code in 700..799 or any other failing code → delegate to `failureYamlTriage`, residue → `docs-lie`
    - Surface `severity`, `category`, `confidence` and a real `evidenceRef` (resolved `failure.yaml`, else the pack directory, else null) — never a fabricated path
    - Commit: "feat(core): resultCode740 verdict router"
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.8, 6.11_

  - [x] 11.4 Implement `verdict/failureYamlTriage.ts`
    - Read a category-ish field (`triage.category` | `category` | `classification` | `reason`) from the newest pack's `failure.yaml` and map per design §6.3, with `assertion`-class signals plus a coerced `result_code` in 700..799 → `docs-lie` and absent/unparseable/unrecognised → `docs-lie`
    - Ships working regardless of the spike outcome (R6.13); tested against all four committed `failure-*.yaml` fixtures
    - Commit: "feat(core): failureYamlTriage fallback router"
    - _Requirements: 6.7, 6.13_

  - [x] 11.5 Write the router-isolation source scan (source scan 3 of 6)
    - Fail if anything outside `packages/kept-core/src/verdict/` imports a concrete router implementation, so the spike outcome can only ever change one config string
    - Commit: "test(core): forbid concrete router imports outside src/verdict"
    - _Requirements: 6.10, 6.14_

  - [x] 11.6 Write property test for verdict-object precedence
    - **Property 18: The verdict object outranks the result code**
    - **Validates: Requirements 6.3, 6.4, 6.5, 6.6**

  - [x] 11.7 Write property test for router totality and strategy isolation
    - **Property 17: The verdict router is total, deterministic and strategy-isolated**
    - **Validates: Requirements 6.1, 6.2, 6.7, 6.9, 6.10, 6.13, 6.14**

  - [x] 11.8 Implement `radius/plan.ts`
    - `readPlan()` over `.kept/plan.json` refreshing via `kane-cli testrun run --dry-run` (ExecutionTestrun, piped stdout, no `--agent`, 60 s) when missing, older than 10 minutes, or older than any `*_test.md` mtime
    - Only `testrun_plan` is consumed but the stream must still reach `testrun_done` to be trusted; a `--dry-run` stream that crashes leaves the previous cache in place
    - Commit: "feat(core): testrun plan cache with dry-run refresh"
    - _Requirements: 4.4_

  - [x] 11.9 Implement `radius/radius.ts`
    - 30-line `*`/`**` glob matcher over repo-relative POSIX paths (no micromatch); changed paths → covering tests → promises → `test_id` values taken **only** from `testrun_plan.members[]`
    - Members without a `test_id` are excluded and diagnosed; empty radius means zero Kane invocations plus one diagnostic per uncovered path
    - Commit: "feat(core): blast radius from plan identifiers only"
    - _Requirements: 4.2, 4.3, 4.5_

  - [x] 11.10 Write property test for blast-radius identifier provenance
    - **Property 16: Blast-radius identifiers come only from the plan**
    - **Validates: Requirements 4.3, 4.4, 4.5**

  - [x] 11.11 Implement `kept verify --changed` / `--all`
    - Invoke `kane-cli testrun run --from-context <ids> --on-failure continue` with stdout piped and a 300 s budget; consume `testrun_plan` (treating `valid: false` as preflight rejection carrying each member's reason), then `testrun_member_end`, then require `testrun_done`
    - Resolve evidence from `<cwd>/.testmuai/evidence/`, route `failed`/`broken` members, write verdicts only for promises in the radius, record `broken`/`interrupted` verbatim in diagnostics, then write state, handoff and snapshot
    - Commit: "feat(cli): kept verify with blast-radius replay"
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.13, 4.14, 4.15, 11.9_

  - [x] 11.12 Write property test for out-of-radius preservation
    - **Property 9 (radius clause): every promise outside the blast radius is byte-identical before and after, including verdict source and freshness**
    - **Validates: Requirements 4.10, 4.15**

- [x] 12. Source resolution, `kept reconcile`, hooks, and the handoff contract
  - [x] 12.1 Implement `context/sources.ts` — types and the four-rung match ladder
    - `StoreSource { sourceId, path, absPath, digest, retired, raw }` and the `SourceResolution` discriminated union: `{ ok: true, source, via }` over `cache | exact-path | abs-path | digest | unique-basename`, or `{ ok: false, reason, diagnostic }` over `no-store | listing-unreadable | crashed-stream | no-match | ambiguous | retired`
    - `resolveSourceId()` walks the ladder first-hit-wins with **no fuzzy matching at any rung**: exact repo-relative POSIX path → absolute path resolved against `repoRoot` → sha256 of the file's current bytes against the recorded digest → basename equality with exactly one candidate
    - Two or more candidates tying at one rung is `ambiguous`, never a guess; titles, use-case names and ordinal position are never consulted; a matched-but-retired entry resolves to `retired` rather than being handed to Kane
    - Commit: "feat(core): source-id resolution with a four-rung match ladder"
    - _Requirements: 5.1, 5.2_

  - [x] 12.2 Implement the tolerant projection of `context list --type source --json`
    - Invoke `kane-cli context list --type source --json` under the Assurance family (invoker appends `--mode agent`) with a 60 s budget, gated on the terminal `done`
    - Project exactly as tolerantly as the coverage payload (§5.3): walk for any array of objects and accept an entry carrying `source_id | id | sourceId`, optionally `path | file | uri | source_path`, `digest | sha256 | hash | content_hash`, and `retired | status`; keep the unprojected entry in `raw` for diagnostics
    - A crashed or unreadable listing is `crashed-stream` / `listing-unreadable`, never an exception
    - Commit: "feat(core): tolerant projection of the Kane source listing"
    - _Requirements: 5.2_

  - [x] 12.3 Implement the `.kept/sources.json` read-through cache
    - `{ schemaVersion, refreshedAt, listingSignature, sources[], byPath{} }` beside `plan.json` and `state.json`; `listingSignature` is a hash of the projected listing so store churn is detected
    - A `byPath` hit is honoured only when younger than `maxAgeMs` (default 10 minutes) **and** the cited file's mtime is not newer than `resolvedAt`; otherwise refresh
    - A refresh whose stream crashes **leaves the previous cache in place and the previous entry is still honoured** — a transient Kane hiccup must not turn a working docs branch into a no-op
    - Commit: "feat(core): sources.json read-through cache with listing signature"
    - _Requirements: 5.2_

  - [x] 12.4 Author the `context-list-sources.ndjson` fixture
    - One committed Assurance listing stream terminating in `done` carrying four deliberately shaped entries: an exact-path match, a digest-only match with no path field, a retired entry, and a duplicate pair where one file backs two live sources (the fork-guard case)
    - Commit: "test(core): source listing fixture covering all four ladder rungs"
    - _Requirements: 5.2_

  - [x] 12.5 Write the source-resolution ladder tests
    - One case per rung asserting the reported `via`, plus one case each for `no-match`, `ambiguous`, `retired` and the fork guard
    - Every failure rung asserts **zero spawns of `kane-cli maintain reconcile`**, zero verdict movement, zero freshness movement, `degraded` still false, a handoff written with `branch: null`, and CLI exit 0
    - Also asserts the cache-crash case still honours the previous entry, and that the fork-guard diagnostic `reconcile-source-forked` names **both** conflicting source ids
    - Not optional — this is the structural test for the branch that was previously dead
    - Commit: "test(core): source-resolution ladder, no-spawn failure rungs, fork guard"
    - _Requirements: 5.1, 5.2, 5.3, 5.7_

  - [x] 12.6 Implement `kept reconcile --changed <paths>`
    - Filter the hook's saved paths to the Docs_Hook pattern set, normalise to repo-relative POSIX, and issue **one invocation per changed doc, sequentially**, each with its own resolved source id; zero changed docs after filtering → no invocation, one diagnostic, exit 0
    - Final argv is `maintain reconcile --from <changedDoc> --source-id <resolvedId> --plan --mode agent` — `--from` and `--source-id` are both mandatory and `--source-id` can only be built from the `ok: true` arm of `SourceResolution`, so an unresolved source is structurally a no-op rather than an exit-2 spawn
    - Mirror locally the seven-row fail-fast ladder of §13.2.4 before spawning: `--from` present, `--source-id` resolved, `--from` exists (`fs.stat`), extension on the ingestable allow-list, source id known, source not retired, and the **fork guard** — a second non-retired listing entry whose path or digest matches `--from` while its id differs
    - Implement the six-step no-match path exactly: diagnostic `reconcile-source-unresolved` quoting the `kane-cli context ingest <file>` remedy, **no spawn at all**, no review card, verdicts and freshness unchanged, handoff with `nextAction.branch: null`, exit 0 — and `degraded` stays **false**, because no proven data was lost
    - Gate the graph rebuild on the terminal `done`; record the head-move that lands even under `--plan` in the run diagnostics; treat `paused` + exit 3 as resumable with nothing changed
    - Commit: "feat(cli): kept reconcile with resolved --from/--source-id and fail-fast ladder"
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 12.7 Implement `kept reconcile apply [planPath]` and the mutually-exclusive-flag rejection
    - Human-only command, never invoked by a hook and absent from both hook prompts: `maintain reconcile --apply [planPath] --mode agent`, bare walks the latest stored plan behind Kane's approval prompt, a path selects one
    - `--plan` together with `--apply` is rejected in KEPT's own arg parser **before any spawn**, with a usage message and **exit 2** — document in the command's header comment that this is the only case `kept` itself exits non-zero
    - Commit: "feat(cli): human-only reconcile apply, plus arg-parser rejection of --plan with --apply"
    - _Requirements: 5.7, 2.10_

  - [x] 12.8 Implement `handoff/handoff.ts`
    - `HandoffFile` type and `writeHandoff()` producing `.kept/handoff.json` plus an immutable `.kept/handoff/<runId>.json`, written for **every** run including crashed, paused, preflight-rejected and source-unresolved ones with `nextAction.branch: null` and populated diagnostics
    - On `code-break`, `allowedPaths` contains only fixture source globs and `forbiddenPaths` includes fixture docs, `tests/**`, `apps/ledger/**` and `packages/**`
    - Commit: "feat(core): handoff file, the closed-loop contract"
    - _Requirements: 11.4, 11.7, 7.1_

  - [x] 12.9 Write property test for handoff completeness and fencing
    - **Property 26: The handoff file is complete for every run and fences the agent by branch**
    - **Validates: Requirements 7.1, 11.4**

  - [x] 12.10 Write the two Kiro hook files
    - `.kiro/hooks/kept-code-verify.json` (`fileEdited` over fixture source globs) with the branch-fenced agent prompt of §11.1
    - `.kiro/hooks/kept-docs-reconcile.json` (`fileEdited` over `apps/fixture/README.md` and `apps/fixture/docs/**/*.md`) with the amended prompt: it runs `kept reconcile --changed <paths>`, states that the CLI resolves the source id itself and passes `--from`/`--source-id`, forbids inventing or passing a source id, forbids `kept reconcile apply`, and instructs the agent to quote the suggested `context ingest` command on `reconcile-source-unresolved` and change nothing
    - Commit: "feat(hooks): code-verify and docs-reconcile with fenced agent prompts"
    - _Requirements: 11.1, 11.2, 11.3, 11.5_

  - [x] 12.11 Write the hook-schema validation test
    - Assert both hook files parse and conform to the Kiro hook JSON schema — `enabled`, `name`, `description`, `version`, `when.type === 'fileEdited'`, non-empty `when.patterns`, `then.type === 'askAgent'`, non-empty `then.prompt`
    - Additionally assert the docs prompt contains no literal `src_` string and no `--apply`, so a hardcoded source id or an apply invocation cannot creep into the prompt
    - Commit: "test(hooks): hook schema validation and prompt content guards"
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 12.12 Write property test for hook pattern partitioning
    - **Property 27: Hook file patterns partition fixture edits**
    - **Validates: Requirements 11.2, 11.3**

  - [x] 12.13 Write the per-command argv assertion suite
    - Against a recording stub spawn, assert the exact final argv of every Kane-invoking KEPT command: `kept build` → `cover --json --mode agent`; plan refresh → `testrun run --dry-run` with no `--agent`; `kept verify --changed` → `testrun run --from-context <ids> --on-failure continue`; `kept verify --all` → `testrun run --on-failure continue`; `kept evolve` → `maintain evolve <ref> --mode agent`; `kept doctor` → `--version`
    - `kept reconcile --changed` explicitly asserts: both `--from` and `--source-id` are present, `--plan` is present, `--apply` is **never** present alongside `--plan`, one invocation per changed doc, and **zero spawns** when the source id is unresolved
    - Not optional — the argv is the contract with Kane and a silently wrong flag is a silently dead branch
    - Commit: "test(cli): per-command argv assertions including reconcile's mandatory flags"
    - _Requirements: 3.4, 3.5, 4.2, 5.2, 7.2_

- [x] 13. Checkpoint — the loop is wired
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Repair surfaces
  - [x] 14.1 Implement `repair/reviewCard.ts`
    - `.kept/review-cards/<id>.json` with id, `createdAt`, `kind` (`test-drift` | `reconcile`), promise id, branch, title, detail, `proposedChanges[]`, `evidenceRef`, strategy and `status`
    - Reconcile mirrors Kane's own `--plan`-staged items into cards rather than reimplementing holding on top of Kane; nothing is ever applied
    - Commit: "feat(core): review cards mirroring Kane's staged plan items"
    - _Requirements: 5.7, 7.7_

  - [x] 14.2 Implement `kept evolve` with the `--mode agent` probe
    - One-time `kane-cli maintain evolve --help` probe cached per process; if the flag is unsupported, skip the invocation, build a `test-drift` review card from the failure context alone, and record the flag-mismatch diagnostic
    - Commit: "feat(cli): kept evolve with documented flag-probe degradation"
    - _Requirements: 7.2_

  - [x] 14.3 Write property test for held-change discipline
    - **Property 20: Reconciliation and evolution only ever produce held review cards**
    - **Validates: Requirements 5.5, 5.6, 5.7, 7.2, 7.7**

  - [x] 14.4 Implement `repair/docsAmendment.ts` and `repair/lineEdit.ts`
    - `propose()` writes **only** under `.kept/`, carrying current text, proposed text, `expectedSha256`, rationale, evidence ref and artefacts; `amendmentId` derived from promise id plus proposed text so re-proposal is idempotent
    - `accept()` guards the sha256 interlock (mismatch → `stale`, exit 0, no write), mutates exactly one array element, writes to `<file>.kept-tmp` and renames atomically preserving line endings and trailing-newline state, then rebuilds the graph and rewrites the snapshot; `reject()` touches nothing else
    - Commit: "feat(core): docs amendments with sha256 staleness interlock"
    - _Requirements: 7.3, 7.4, 7.6_

  - [x] 14.5 Write property test for amendment write discipline
    - **Property 19: A documentation amendment writes nothing until accepted, then edits exactly one line**
    - **Validates: Requirements 7.3, 7.4, 7.6**

  - [x] 14.6 Build `/amendments`, `/reviews`, and the diff renderer
    - `lib/diff.ts` ~60-line line-level unified diff (LCS over ≤200 lines, no Shiki); `DiffView` in mono on `.surface-well` so the diff reads as cut into the card, clay deletions, patina additions, `--text-200` gutter numbers with tabular numerals, and `--wash-*` only on each row's left 3px edge
    - `AcceptControl` is a native keyboard-focusable button with the accessible name `Accept amendment <id> for README line <n>`, copying `kept amend accept <id>` and revealing the command inline — the Ledger still exposes no non-GET handler
    - `/reviews` renders each card with its promise id, repair branch and evidence reference
    - Commit: "feat(ledger): amendment diffs, accept control, review cards"
    - _Requirements: 7.5, 7.7, 10.7_

- [x] 15. Live Kane — bootstrap, recorded integration runs, and the closed loop **[LIVE KANE]**
  - [x] 15.1 **[LIVE KANE]** Bootstrap the context store as two explicit commands
    - `kane-cli context ingest apps/fixture/README.md --mode ci` — **lands only**, because a piped/headless stdin never extracts (§4.9.1); an ingest that appears to do nothing has in fact succeeded
    - Then `kane-cli context extract --mode agent` (Assurance, terminates `done`), then `kane-cli design tests --use-case <ref> --mode agent`
    - Record both streams under `docs/kane/`; this pair is the precondition for `cover` returning anything but `refused` and for `resolveSourceId` finding a match at all
    - Commit: "chore(kane): bootstrap context store with explicit ingest then extract"
    - _Requirements: 2.5, 5.2_

  - [x] 15.2 **[LIVE KANE]** Author the remaining seven tests and commit their recordings
    - Author each `*_test.md` against the running fixture; force-add every produced `output-*/` directory so all later replays are free
    - Commit: "chore(kane): authored the full corpus and committed replay recordings"
    - _Requirements: 13.6_

  - [x] 15.3 **[LIVE KANE]** Integration test — zero-credit replay of the full suite
    - Run `npm run loop` (`kept verify --all --member-debug`) entirely from cached recordings; capture what `credits()` actually reports rather than asserting 0 a priori, and commit the run entry and stream
    - Commit: "test(integration): recorded zero-credit replay of the full suite"
    - _Requirements: 4.6, 14.7_

  - [x] 15.4 **[LIVE KANE]** Integration test — `maintain reconcile --plan` with a real resolved source id
    - Edit `apps/fixture/README.md`, let `kept reconcile --changed` resolve the id against the live store, and assert the recorded argv carries the resolved `--from`/`--source-id`/`--plan`, that the stream reaches `done`, that the head move is recorded in diagnostics, and that every produced change landed as a held review card
    - Also record the negative case once: with the source retired or absent, assert zero spawns and zero verdict movement against the live CLI
    - Commit: "test(integration): recorded reconcile --plan against a live resolved source"
    - _Requirements: 5.2, 5.7_

  - [x] 15.5 **[LIVE KANE]** Drive the docs-lie branch on T-7
    - Replay `tests/cart_discount_test.md` against the correctly-behaving fixture so the assertion fails with the selector resolving; confirm the router returns `docs-lie` and `kept amend propose` produces the amendment replacing the never-true discount claim
    - Commit: "chore(kane): docs-lie branch fires on the never-true discount claim"
    - _Requirements: 7.3, 12.7_

  - [x] 15.6 **[LIVE KANE]** Integration test — one full closed loop, persisted
    - Break `apps/fixture/lib/cart.ts`, let the code hook verify (red, `code-break`), let the agent patch from the handoff, let the save re-fire the hook, land on `proven`
    - Commit both `.kept/handoff/<runId>.json` files, the intervening patch, and the snapshot showing both terminal events on `/runs`
    - Commit: "test(integration): persisted closed-loop record, red to proven"
    - _Requirements: 11.5, 11.6, 11.7_

  - [x] 15.7 Curate and commit the evidence packs
    - `kept snapshot` copies referenced packs into `apps/ledger/public/evidence/<packId>/` and rewrites `publicPath` values; commit the curated packs including `annotated.png` and the per-step screenshots so artefact links are plain static URLs
    - Commit: "chore(evidence): commit curated packs for the credential-free judge path"
    - _Requirements: 13.4, 13.5_

  - [x] 15.8 Write the committed-evidence referential integrity test
    - Assert every snapshot evidence pack id, artefact `publicPath` and `repair.evidenceRef` resolves to a file committed in the repository, and that every committed curated pack is referenced by at least one promise, run or amendment
    - Not optional — a dangling evidence link is the one broken thing a judge will click
    - Commit: "test: referential integrity of committed evidence and the snapshot"
    - _Requirements: 13.4, 13.5_

  - [x] 15.9 Write property test for evidence referential closure
    - **Property 28: Committed evidence and the snapshot are referentially closed**
    - **Validates: Requirements 13.4, 13.5**

  - [x] 15.10 Record the measured credit consumption
    - `docs/kane/credits.md` with the `credits_consumed` figure read from a real authored run's terminal event alongside the replay measurement, each with its run id and full invocation
    - Commit: "docs(kane): measured credits_consumed for authoring and replay"
    - _Requirements: 14.7_

- [x] 16. Checkpoint — Verified dimension is real
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Motion layer — gate first, then M5 → M1 (§19 stage 10, §18.1)
  - [x] 17.1 Implement `apps/ledger/lib/motion.ts` — the only `animejs` entry point
    - Named imports only: `import { animate, createTimeline, stagger, svg, utils, eases } from 'animejs'`
    - `MotionSpec { to, run }`, `motionEnabled()`, and `play(targets, spec)` — when motion is off it applies `spec.to` synchronously via `utils.set` and resolves immediately, so the end state is the first painted state
    - Observe the media query live with `addEventListener('change')`; on a switch to reduced motion, **complete** in-flight timelines rather than cancelling them, because cancelling leaves the DOM mid-way, which is exactly what is being prevented
    - Commit: "feat(ledger): motion gate with a synchronous reduced-motion branch"
    - _Requirements: 10.4_

  - [x] 17.2 Write the `animejs` import-shape and location scan (source scan 4 of 6)
    - Fails on a default import (`import anime from 'animejs'`), on any deep `animejs/lib/*` path, and on any `animejs` import outside `apps/ledger/lib/motion.ts` and `apps/ledger/components/**`
    - Also asserts `package.json` pins `animejs` to the exact string `4.5.0` and that the runtime dependency count is exactly nine
    - Commit: "test(ledger): animejs import shape, import location, exact pin"
    - _Requirements: 10.4_

  - [x] 17.3 Write the reduced-motion equivalence test
    - Render `/` under jsdom with `prefers-reduced-motion: reduce` and again with motion enabled after all timelines complete; compare **every animated declaration** — node opacity, node transform, verdict tag colour and scale, panel offset, edge draw progress, metric figure text
    - Assert the metric figure's accessible name is the final value from first paint in both states, so a screen reader is never read an intermediate number
    - **Property 22 (reduced-motion clause)** — not droppable under any timebox pressure (§18.2); it must be green before any flourish below is added
    - Commit: "test(ledger): reduced-motion equivalence across every animated declaration"
    - _Requirements: 10.4, 10.6_

  - [x] 17.4 Implement M5 — verdict flip pulse
    - One timeline: tag colour `--verdict-*` → `--verdict-*`, tag scale `1 → 1.06 → 1`, node left-edge wash cross-fade, at `--dur-slow` on `--ease-emphasis`; routed through `play()` with the end state declared in `to`
    - Built first because it marks the one event the product exists to show, and is the last of the five to be dropped
    - Commit: "feat(ledger): M5 verdict flip pulse"
    - _Requirements: 10.4_

  - [x] 17.5 Implement M4 — graph entrance stagger
    - `createTimeline` over `.promise-node` animating only `opacity` and a 6px `translateY` from the layout's already-final coordinates, `stagger(24, { from: 'first' })` in lane order, total elapsed capped at `min(nodeCount × 24ms, 620ms)` with the remainder appearing together
    - Gated on a `sessionStorage` flag so it runs once per session; the resting DOM is byte-identical to the no-motion render
    - Commit: "feat(ledger): M4 lane-ordered graph entrance stagger"
    - _Requirements: 10.4_

  - [x] 17.6 Implement M3 — panel section stagger
    - Panel container slide-and-fade stays a plain CSS transition; the panel's three sections stagger 40 ms behind it at `--dur-base` on `--ease-out`
    - Droppable third from the end of §18.1's order; dropping it leaves the container transition intact
    - _Requirements: 10.4_

  - [x] 17.7 Implement M2 — metric count-up
    - Interpolate 0 → value over `--dur-figure` on `--ease-out` using `utils.set` per frame, formatted through the exact formatter the static render uses so the final frame is character-identical; tabular numerals prevent digit reflow; no count-up for a tile replaced by the degraded chip
    - _Requirements: 10.4_

  - [x] 17.8 Implement M1 — edge draw along the verdict path
    - `svg.createDrawable` on the edge between a promise and its designed test, drawn 0 → 100% at `--dur-slow` when that path carried a verdict change; a single 1.4 s pulse, never a loop
    - First to be dropped: lowest information density of the five and the fiddliest against React Flow's edge internals
    - _Requirements: 10.4_

- [x] 18. Checkpoint — the page moves and the reduced-motion render is identical
  - Ensure all tests pass, ask the user if questions arise. The reduced-motion equivalence test, the widened CSS motion scan, the visual trio and the typography scan must all be green before submission work starts.

- [ ] 19. Submission deliverables
  - [x] 19.1 Deploy the Ledger to Vercel
    - Project root `apps/ledger`, install `npm ci` at the monorepo root, build `next build`, **zero environment variables**; confirm the public HTTPS URL serves the committed snapshot with Kane invoked zero times
    - Commit: "chore(deploy): vercel configuration for the read-only ledger"
    - _Requirements: 8.6, 14.6_

  - [x] 19.2 Write the root README front matter and live-loop documentation
    - First 20 lines carry the deployed HTTPS Ledger URL and `npm run demo`; below that, the live-loop command with its prerequisites of a local Chrome installation and Kane CLI credentials, the headless bootstrap recipe (`context ingest … --mode ci` then `context extract --mode agent`), and the public repository URL
    - Add a test asserting the URL and the demo command both appear within the first 20 lines so the constraint cannot silently drift
    - Commit: "docs: README front matter with live URL, demo command, loop prerequisites"
    - _Requirements: 13.8, 13.9, 14.1_

  - [x] 19.3 Assert the judge path is Kane-free and credential-free
    - Test asserting `scripts/demo.mjs` spawns no `kane` process and that `apps/ledger` resolves all data from the committed snapshot with no network call beyond localhost; document the observed time to the rendered landing view
    - Commit: "test: judge path spawns no Kane and needs no credentials"
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 19.4 Write the project summary
    - Single paragraph of **120 words or fewer** covering the promise graph, the citation discipline, and the three-way repair branch; add a word-count assertion in the test suite so the limit cannot silently drift
    - Commit: "docs: 120-word project summary with a word-count assertion"
    - _Requirements: 14.5_

  - [ ] 19.5 Record the demonstration video
    - 180 seconds or less, in this mandated order: (1) the deployed Ledger — graph, citations, coverage, badge, and the motion layer on first paint; (2) a code-break repair — break `lib/cart.ts`, hook fires, verdict red, agent patches from the handoff, second verification lands `proven`; (3) an accepted docs-lie amendment diff on the never-true discount claim
    - Commit the file or its link record together with the shot list and the measured duration
    - Commit: "docs: 180-second demonstration video and shot list"
    - _Requirements: 14.3, 14.4_

  - [x] 19.6 Audit the commit history
    - Confirm the history carries at least 50 named commits (R14.2's floor is 15; this plan yields far more), each message naming the change it makes; fix any squashed or unnamed commit before the deadline
    - Commit: "docs: commit history audit against the submission checklist"
    - _Requirements: 14.2_

- [x] 20. Final checkpoint: the suite, the scans and the type-check passes green together
  - Ensure all tests pass, ask the user if questions arise. Nothing in task 21 may start before this checkpoint is clean.
  - **Retitled, because the original title claimed more than the tree supported.** It read "every submission deliverable green" while 19.5, the demonstration video, was and is still open, so a reader checking this box against the plan would have found a contradiction rather than a checkpoint. What this checkpoint actually asks for is one clean run, and that is what it is now named after. The video is 27.3's, deliberately, because stages 22 to 26 all changed what a recording would show

- [x] 21. Droppable scope — build order is the reverse of the drop order (§18)
  - **Closed. Every row is resolved and only three of the ten were actually dropped**, which is the finding worth keeping: 21.3, 21.4, 21.5, 21.6, 21.8 and 21.9 shipped, 21.2 was superseded by a wider command, and 21.1, 21.7 and 21.10 were closed by decision or by measurement with the reason recorded rather than left as a gap. Two of the ten turned out not to be droppable at all: 21.5's ribbon is the Promise-Ledger half's headline metric, and 21.6's stderr capture is where the only classification signal lives, so dropping it would have collapsed the three-way router into one branch that looked alive
  - [-] 21.1 ~~Wire `maintain evolve` for real~~ (§18 #10) — **CLOSED by measurement: the verb has no headless path, and Kane says so**
    - **The argv was already correct, and correcting it changes nothing.** `evolveArgv` composes `maintain evolve <ref>` and writes no ask-policy flag; the invoker appends `--mode agent` from the Assurance contract, which is what Kane rejects. This task assumed that was the obstacle. It is not
    - **The verb refuses to run without a TTY at all.** Probed once, as this task's second bullet required, against a fresh target chosen so a success could supersede nothing. The whole exchange, captured under `docs/kane/evolve/`: stdout carried the single line `evolving uc-10: reading the graph…`, stderr carried `error: evolve needs a TTY — the blast-radius confirm is the point; headless evolution rides `kane-cli maintain reconcile``, and the exit code was 2
    - **That answers the probe question and closes the task in one stroke.** Piped stdout is not the enabler here the way it is for `testrun run`: it emits human prose and nothing machine-readable, so there was never a stream to consume with or without a flag. The refusal is a design decision rather than a gap, and it is the same decision §8.1 made independently for this branch, that a human looks before a use case's scenario and test pairs are superseded. A tool refusing to let an agent destroy reviewable work unattended is not an obstacle worth defeating
    - **Kane names the headless route, and KEPT already takes it.** `maintain reconcile` is §13.2's command, `kept reconcile` invokes it, and its staged rows already become held review cards through `mirrorReconcileStagedChanges`. So the capability this task wanted, Kane proposing a re-design and KEPT holding it for a human, exists and is exercised. It arrives through the other verb, which is exactly what Kane's error message says to do
    - **The pair-diff review card is therefore unreachable and correctly so.** The third bullet asked for a card built from the pair diff Kane's help text promises. There is no headless invocation to read a pair diff from, and the failure-context card the third bullet named as the fallback is the only path. What changed is the remedy that card prints: it used to say "re-run once the verb accepts `--mode`", which would be a wait with no end, and now names the two real routes, interactive evolution or `kept reconcile`
    - **The probe cost nothing and moved nothing**, which is asserted rather than assumed: exit 2 before any model call, `.context/` at 39 records either side, and `context list --json` byte-identical either side. `packages/kept-cli/test/evolve-headless-refusal.test.ts` pins all of it in 10 assertions, including that the chosen target was the fresh undesigned one rather than uc-2, the only complete and proven use case in the graph
    - **What the task asked for, kept below rather than deleted**, because the reasoning was sound and only the conclusion was wrong, and a plan that erases its own wrong turns teaches nobody anything
    - Commit: "docs(evolve): the verb has no headless path, measured once and recorded"
    - _Requirements: 7.2, 7.10, 7.11_
    - ---
    - **The specified argv cannot work.** `maintain evolve --help` lists exactly two options, `--from-stale` and `--because`; `--mode agent` is rejected with `unknown option '--mode'`, while `maintain reconcile --help` from the same group does list `--mode`. `evolve.ts` already documents the asymmetry and takes the degradation path on every invocation, so the branch has never once called Kane
    - Correct the argv to `maintain evolve <ref>` with no ask-policy flag, and confirm the NDJSON enabler with **one** probe before spending: this command is not in `kane/family.ts`'s contract table, so establish whether piped stdout is the enabler the way it is for `testrun run`, or whether it emits nothing machine-readable at all
    - Build the Review_Card from the **pair diff** the invocation reports — the help text promises "unaffected items are preserved verbatim; reports the pair diff" — and keep the failure-context card as the fallback for a stream that does not reach `done`
    - The invocation **mutates the assurance graph**: it supersedes a use-case's scenario and test pairs. Rehearse against a fresh target with `--because <reason>` before touching a stale one, and record the graph state either side. **This bullet is the one that closed the task**: the rehearsal it demanded is what found the TTY refusal, for nothing, before any pair was superseded

  - [-] 21.2 ~~`kept doctor`~~ (§18 #9) — **SUPERSEDED by 24.3, which is the same command with a wider brief**
    - Shipped. `main.ts` dispatches `doctor`, `PENDING_TASKS` no longer lists it, and `argv-contract.test.ts`'s pending guard was promoted to a real process-boundary assertion, which is exactly what that guard existed to force
    - 24.3 delivered everything this row asked for and three things it did not, because §18 #9 was written while this repository was the only repository: seven checks rather than four, a `pass` / `fail` / `not-configured` vocabulary with a remedy on every non-pass, and the §20.3 fence check reported even when it passes
    - The one-spawn bound is enforced by a type rather than by discipline: the request takes `Pick<KaneInvoker, 'invokePlain'>`, so the context-store check *cannot* ask Kane, because the method that would let it is not on the seam
    - _Requirements: 2.12, 13.1, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10_

  - [x] 21.3 Badge visual polish (§18 #8)
    - 34 lines today, flat two-tone. Shields-style treatment, keeping three contracts intact: the displayed value stays a whole-number percentage, the response stays `image/svg+xml`, and the route stays GET-only
    - **The palette scan is the constraint that bites.** No gradient, no colour outside the token set, and the read-only scan still has to pass over `app/badge.svg/route.ts` — so the polish is geometry, weight and spacing rather than new colour
    - `provenCoverage` is `null` on the committed snapshot today, so the `n/a` state is the one a judge sees first and must look deliberate rather than broken
    - **That premise expired while this task was open, and the work is unaffected.** 22.1 landed the `cover gaps` axis, so the committed snapshot reads `degraded: false` with a real `provenCoverage`, and the badge a judge meets is a percentage on the stale band rather than `n/a`. The polish was built for both arms from the start, `badge.prop.test.ts` generates the withheld one deliberately and asserts the two are drawn on the same plates, and `route.ts` documents the current state. Recorded rather than deleted, because "the state I designed against is no longer the live state" is the most common way a visual task quietly stops being checked
    - Commit: "feat(ledger): a badge worth putting in a README"
    - _Requirements: 9.4, 9.5_

  - [x] 21.4 Prove the evidence lane renders, now that there is evidence (§18 #7)
    - **Already implemented and never verified end to end.** `LANES` has carried `evidence` since §10.3, `LANE_X` has four entries, `layoutSnapshot` emits a node per `snapshot.evidence` entry at `LANE_INDEX.evidence`, and `PromiseGraph.tsx` renders `case 'evidence'`. It was invisible only because `snapshot.evidence` was `[]` until curation was fixed — the committed snapshot now declares one pack with 37 artefacts and two resolving `evidence` edges
    - Add the render assertion that was impossible before: the graph paints one lane-3 node per declared pack, an `evidence` edge reaches it from each promise that names it, the node is keyboard-reachable with an accessible name, and a snapshot declaring no pack paints no lane-3 node and no empty lane
    - Confirm the six edges the snapshot still drops stay dropped and diagnosed — they name a stale conflict-copy id from an older run, and an edge to nothing is worse than an absent edge
    - Commit: "test(ledger): the evidence lane, asserted against a snapshot that finally has one"
    - _Requirements: 8.3_

  - [x] 21.5 `cover gaps` dual-axis ribbon — **reclassified: not droppable** (§18 #6, §5.3.0)
    - The stated reason for droppability was wrong. `cover --json` does not supply both axes on this repository: it reads depth out of a sealed pack and refuses at exit 2 with `carries no coverage/usecases.yaml — the pack predates coverage or its project had no .context at seal time`, because every pack here is a **replay** pack and only authoring mints a coverage document. Dropping this drops the Promise-Ledger half's headline metric
    - `cover gaps --json --mode agent` answers both axes from the **live graph**, verified working: exit 0, `done.status: complete`, `design_completeness {pct 100, acs_designed "6/6", usecases_complete "1/9", ucs_needing_scenarios 8}`, `proven {pct 100, acs_proven "6/6", failing 0, blocked 0, not_run 0, latest_run.execution_id f2cac6b7-…}` with `source: graph_execution_facts` and `denominator: current_live_acs`, plus nine per-use-case entries
    - Switch `EnrichmentProvider` to `['cover', 'gaps', '--json']`, Assurance family, invoker appends `--mode agent`, 60 s budget. Same acceptance gate, `gaps` payload replacing `coverage`, `gaps-payload-unreadable` replacing `coverage-payload-unreadable`. Keep the singular `cover` path and its refusal fixture — it is the right first choice for a repository whose packs are authored
    - Project tolerantly, the way the coverage payload already is: percentages and `n/m` ratio strings verbatim, and one row per use-case carrying `{id, title, risk, design_completeness{pct,status}, proven{pct,status}, stale_acs, pending[]}`
    - Publish `pending[].ready_command` as **text only**. It is a literal `kane-cli …` string; rendering it as a control would give the read-only Ledger a way to spend credits
    - Render the ribbon on `/coverage`, ordered by risk band then id, and **label the two figures apart**: the rail's `provenCoverage` counts promises this repository verified, the ribbon's `proven` counts acceptance criteria Kane holds execution facts for. Different denominators over different objects; they will disagree and the page must not let that read as a bug
    - Record the axes in the snapshot so the shareable page renders them with Kane invoked zero times, and commit the `gaps` stream as the offline fixture
    - Commit: "feat(coverage): the dual-axis ribbon, from the graph rather than from a pack"
    - _Requirements: 9.9, 9.10, 9.11, 9.12, 9.13, 9.14, 9.15_

  - [x] 21.6 `KANE_TESTRUN_MEMBER_DEBUG` stderr capture (§18 #5)
    - Set the variable when `config.memberDebug` is true and capture `[member]`-prefixed stderr lines into run diagnostics
    - _Requirements: 4.12_

  - [-] 21.7 ~~Shiki syntax highlighting for diffs~~ (§18 #4) — **DROPPED by decision, not deferred**
    - The conflict was resolved against Shiki. `package.json` carries exactly **nine** runtime dependencies and the budget is asserted by a test (§2.2); Shiki makes ten, and the artefact it would highlight is one line of English prose
    - The optional-peer escape was considered and rejected: it keeps the budget's number honest while adding a second code path through `lib/diff.ts` that only runs on machines where an optional install happened to succeed, which is a worse property than plain text
    - No work item remains. `lib/diff.ts` is the renderer, as it already was. Recorded in A17 and in §18's table so the decision is auditable rather than an omission
    - _Requirements: 7.5_

  - [x] 21.8 `kept watch` loopback accept listener (§18 #3)
    - No command file exists; `commands/` holds `amend`, `build`, `evolve`, `reconcile`, `snapshot`, `verify`
    - A `127.0.0.1:3199` listener **outside** the Next app, dev-gated behind `NEXT_PUBLIC_KEPT_LOCAL=1`, performing the same `kept amend accept` path the CLI does. It adds **no route** to the Ledger's tree — the read-only scan over `apps/ledger/**` must still pass unchanged, and that is the whole architectural point of putting it in the CLI
    - Bind loopback only, never `0.0.0.0`; accept only the amendment id and nothing that could name a path; refuse every method but the one it needs
    - The deployed Ledger must be byte-identical with and without this feature — assert that the production build contains no reference to port 3199
    - **Asserted at its cause instead, and this bullet was left stale for a while, which is the thing worth recording.** `watch.test.ts` asserts that no file under `apps/` imports this module by any spelling and that no application source names the port in a code position, comment included. A bundler cannot carry into its output a number that appears nowhere in its input, so the cause implies the effect, and unlike a scan over `.next` it holds on a bare checkout where no build exists. Shelling out to `next build` from a unit suite to check the weaker claim would have been the wrong trade. Task 21.9 took the same shape for the same reason
    - Commit: "feat(watch): a loopback accept path that adds no route to the Ledger"
    - _Requirements: 7.5, 7.6_

  - [x] 21.9 Live NDJSON pane in local development (§18 #2)
    - `LiveNdjsonPane` does not exist; `apps/ledger/components/` has no NDJSON component
    - Fed by the invoker's line callback, dev-only and **absent from the production build** — not hidden by CSS, not gated at runtime, genuinely not in the bundle. Assert its absence in the built output rather than trusting the flag
    - It renders Kane's own stream, so it must render an event it does not recognise rather than dropping it (R3.9's spirit at the UI layer), and it must not be the thing that makes a dev page hang on a 200-line-per-member `[member]` capture
    - **Delivered as a pane with no transport of its own.** `apps/ledger/components/LiveNdjsonPane.tsx` takes lines as a prop and an optional subscription seam and reads nothing. A first pass shipped a companion server module that opened the newest capture under `.kept/diagnostics/`, which worked and broke the clause in `judge-path.test.ts` holding that no module under `apps/ledger/` imports `node:fs`, on the grounds that a projection reading nothing at request time has nothing stale to serve. The companion is deleted, the clause stands unweakened, and the transport stays where this task's own first bullet put it: the invoker's line callback, in the CLI process `kept watch` already runs in (§13.1)
    - **Absence is asserted at its cause rather than in the built output**, which is the shape 21.8 settled on for the watch listener's port. Nothing under `apps/ledger/app/` and nothing in any other shipped module names the pane, so it is not a node in the graph the bundler walks. That is stronger than reading `.next`, which can be stale, and it runs on a bare checkout, where `.next` does not exist and a build-output scan would be a guard passing by inspecting nothing
    - The R3.9 claim is asserted against a committed capture, `docs/kane/loop/codebreak-green-f2cac6b7.member.ndjson`, rather than against invented lines: 240 real lines of which only thirteen carry a recognised `type`, so a filtering pane would draw thirteen rows and look like it was working. The suite pins that ratio. It also found a real defect in the pane's own bounding arithmetic, where `Math.max(1, Math.floor(NaN))` is `NaN` and every comparison against the limit is therefore false, so a caller passing a non-finite cap got no bound at all
    - Commit: "feat(ledger): a dev-only NDJSON pane, provably absent from production"
    - _Requirements: 8.7_

  - [-] 21.10 ~~Conduit / RealWorld second target~~ (§18 #1) — **WITHDRAWN, replaced by stage 26**
    - Its only value was proving KEPT is not fixture-specific. Its cost was a backend, a database, a second application to keep running, a second README to keep honest, and a second corpus authored with live credits, which is the exact scope the fixture decision cut deliberately
    - **Stage 26 proves the same thing for one config entry and a `@verifies` tag**, by admitting this repository's own root README as a promise source. It is also the stronger claim: the document making the claims is the document being checked
    - R14.8's `MAY` is therefore not exercised. Recorded in A17, §18's table and §23.3 rather than left as a gap
    - _Requirements: 14.8, 19.6, 19.7_

- [x] 22. Closing the two gaps against the original design
  - Neither of these is droppable and neither is polish. They are the two places the shipped product is narrower than the design it was built from, and both were misdiagnosed as blocked on the interactive assurance chain when only one of them touches it at all.

  - [x] 22.1 The coverage-against-acceptance-criteria axis, end to end
    - This is 21.5's requirement set turned into the thing a judge reads. 21.5 wires the provider and the ribbon; this task is what makes the number *mean* something and proves it stays honest
    - Establish the axis is reproducible offline: commit the `cover gaps` stream, add it as a parser fixture, and assert the projection against those bytes so the ribbon renders in CI with no Kane and no store
    - Assert the degradation path with the same weight as the success path: a `gaps` stream that refuses, one that pauses at exit 3, one truncated before `done`, and one whose payload projects zero rows must each leave the graph degraded with a named reason and the ribbon **withheld** — never a zero, never an empty ribbon that reads as "nothing owed"
    - Property test: *for any* `gaps` payload, both axis percentages are either withheld or in range with a ratio whose denominator matches the live acceptance-criteria count; every use-case row carries both axes; no `ready_command` reaches the DOM as anything but text; and the two proven figures are never rendered under the same label
    - `usecases_complete` reads `1/9` today with eight use-cases needing scenarios. That is a real and honest number — the graph genuinely owes eight designs — and the ribbon must show it as debt rather than rounding it away. **Do not author eight use-cases to make the ribbon look better.** A ledger that shows what it owes is the product; one tuned to look complete is the thing this product exists to prevent
    - Commit: "feat(coverage): the axis a judge reads, with its degradation asserted"
    - _Requirements: 9.9, 9.10, 9.11, 9.12, 9.13, 9.14, 9.15_

  - [-] 22.2 **[LIVE KANE]** The docs-triggered loop, recorded as one cycle
    - §11.4. The machinery is implemented and a live `maintain reconcile --plan` run is recorded, but no continuous cycle exists from "the documentation now claims something untrue" to "an amendment is proposed and nothing was written" — which leaves the more novel of the two triggers reading as the thinner one
    - Add a ninth claim to `apps/fixture/README.md` describing behaviour the fixture does not implement. Let the docs hook fire; `kept reconcile --changed` reports it as outstanding suite debt with verdict `undesigned`
    - Bind a designed test to it. **The safe path is a hand-written `*_test.md`** with an `@verifies` tag and a `<!-- @covers -->` marker, authored like the other eight — one replay, no assurance chain. The richer path is `design tests --use-case <uc> --mode agent`, and if that is taken then `--plan` first: it is transcription-only and commits nothing, so the rehearsal is free and is **not optional**
    - `kept verify --changed` fails the new member. The router answers `docs-lie`; §8.1.1 withholds any write path because the promise was never proven. `kept amend propose` produces the amendment and `/amendments` renders it
    - **Revert the ninth claim.** R5.11: `apps/fixture/README.md` returns to its committed content and its pinned sha256 `b2118de7aef19263a2d6fb18eba0778e4120b5521077e6de4ed0d26383efadef` still holds. The amendment survives as the record; the lie does not survive in the tree
    - Commit the reconciliation stream, the verification stream, both handoffs, the amendment JSON and the snapshot that renders it, plus an integration test asserting against those committed bytes: the branch was `docs-lie`, `allowedPaths` was empty, and no file outside `.kept/` was written
    - **What was delivered, against what this task predicted.** The cycle was driven live on Kane CLI 0.8.4 against a real Chrome and is committed under `docs/kane/loop/t9-*`, asserted by `packages/kept-cli/test/docs-trigger-loop.test.ts` (18 tests, no Kane, 126 ms) and written up in `docs/kane/loop/README.md`. The ninth claim was added, the reconciliation staged nine held changes, the designed test was authored for **41.354 credits** over five `run_end` events, both verifications ran, and the claim was reverted with the pinned sha256 intact. **Three of the four predictions in the fourth bullet did not happen**: the new member never failed, the router never answered `docs-lie`, and no amendment was produced
    - **Why, measured rather than assumed.** KEPT takes a `test_id` only from Kane's plan, never from a path, and the plan reports the value Kane wrote into the recording it keeps beside the document at `tests/output-<slug>/.internal/meta.json`. Across all 17 members of `docs/kane/loop/t9-testrun-plan-test-ids.json` the two agree exactly, and the identifier is `null` for precisely the 8 members with no recording. The new document had no recording when the plan was cached at `11:55:28Z`, both verifications ran inside the next 90 seconds, and the authoring run only finished at `12:01`. So the member was excluded with a `warn radius-member-no-test-id`, which is correct behaviour and is asserted as correct rather than worked around: guessing an identifier from a filename would make every later re-verification a guess
    - **The tempting stronger conclusion is wrong, and the tree says so.** It is not the case that a claim admitted today can never go red. A *failed* authoring run still writes a recording and still mints an identifier: this task's own failed run wrote `test_id: a2bda3fb-07fd-4c0f-a9e7-85e66e878625` with `run_kind: author` and `status: broken`, and T-7, whose authoring run reported `commit: {committed: false, reason: run_failed}`, carries an identifier in the same plan. **No verification was run after the authoring run** (the committed snapshot's freshness is still `11:56:08Z`), so the last three steps are untested rather than unreachable. What the cycle does establish is the ordering §11.4 never stated: author, refresh the plan, then verify. Recorded as **A20** beside A19, in design §7.2.1, at §11.4's step list, and in `docs/checkpoints.md`. The `docs-lie` branch remains demonstrated on T-7
    - **The fuller reason `staleCount` reads 5, which does survive.** The three self-cited designed tests have never been authored at all, so no recording and no identifier exists for them and `verify --changed` cannot select them however the radius is computed. `docs/self-verification.md` now says that instead of "designed, and never run"
    - **What the cycle proved instead, which is worth more than the predicted branch.** Kane produced a *third* answer to a claim that was never true and blamed **itself**: two `test_md_bug_verdict` events, both `confirmed: false`, family `automation_bug`, categories `agent_misstep` at 0.82 and `state_transition_bug` at 0.84, one of whose summaries describes the fixture's correct behaviour and files it as the agent's mistake. T-7's authoring run called an equally false claim a confirmed `application_issue` at 0.95. The category moves run to run and no category ever means "the claim is false", which is the argument §8.1.1 rests on
    - **Also established: a documentation change puts nothing in the blast radius.** `verify --changed apps/fixture/README.md` selected 0 members, started no Kane process and wrote no verdict, because the radius is computed from changed source against each test's `covers:` fence. Correct, and the reason §13.2's `reconcile --changed` is a separate command, but not previously written down anywhere
    - **Four defects found by driving it**, all fixed in the tree: `runSnapshot` had no projection from `.kept/review-cards/`, so the snapshot always wrote `reviewCards: []` and `/reviews` could never show a held change even though `listReviewCards` existed, was exported, was tested and claimed in its own doc comment to be the seam `kept snapshot` filled; the human-readable `kept reconcile` summary hard-coded "review cards none created" while nine were staged; the `reconcile-completed` diagnostic hard-coded "no review card created"; and `docs/publish.md` carried a section headed "Currently red, and blocking" naming a defect already fixed, now guarded by `packages/kept-cli/test/published-docs.test.ts`. Every unit passed in all four cases and the composition was wrong, which is the fourth instance of that shape recorded in `docs/checkpoints.md`
    - **What would finish it, if it is to be finished.** One `kept verify --changed` after the authoring run, against a refreshed plan, with the ninth claim and its designed test back in the tree: on the measured evidence the member would then be selected, and steps 5 to 7 would either run or fail for a reason nobody has seen yet. That costs a replay and a judgement, not an authoring run. The alternative is to accept T-7 as the `docs-lie` demonstration and keep this cycle as the account of Kane's third answer, the cost, and the ordering. Both are recorded; neither has been chosen here
    - **[SECOND CYCLE] That run was made, and it closes A20.** The recording the cheap path needed had been deleted during cleanup, so the real cost was a fresh authoring run rather than a replay: **36.8983 credits** over four `run_end` events, then **10.80946** for the failing member's judgement. Captures are `docs/kane/loop/t9b-*`, asserted by 11 new tests in `packages/kept-cli/test/docs-trigger-loop.test.ts`, which now holds 31. The claim was re-added, the document re-authored, **`.kept/plan.json` deleted so the plan would be recaptured**, and `kept verify --changed apps/fixture/app/shop/page.tsx --member-debug` run against it
    - **Three of the four predictions are now settled, two of them right.** The member **was** selected: its recording id `1080f892-b002-43f4-b123-16dc4ea3837b` is in the radius and `tests/shop_filter_persist_test.md` is in the command Kane was handed, so the ordering this stage inferred (author, refresh the plan, then verify) is demonstrated rather than deduced. The member **did** fail, and the promise went **`red`** with a real verdict source, `resultCode 330`, `reasonCode stuck.ap_stuck`. So a claim admitted today can go red, and the exclusion recorded above was a timeline artefact rather than a property, exactly as the correction predicted
    - **The `docs-lie` prediction is measured wrong for the third time, on a second independent claim.** The router answered **`test-drift`**, because Kane reported `confirmed: false` and R6.4 makes the inline verdict object outrank the numeric code. Kane again blamed itself: one `test_md_bug_verdict`, `family: automation_bug`, `category: state_transition_bug`, confidence 0.81, whose own summary describes the fixture's correct behaviour. Across the corpus one unchanged kind of failure has now drawn `application_issue` at 0.95 and `automation_bug` at 0.81 and 0.84, and **never** a category meaning the claim is false. That is §8.1.1's argument, measured twice rather than argued once. The `docs-lie` branch stays demonstrated on T-7, whose amendment renders on `/amendments`
    - **`kept amend propose` therefore staged nothing, which is the interlock working, and one defect fell out of it.** §8.1.1 only proposes an amendment for the branch the router settled, so an empty proposal off a `test-drift` run is correct and exits 0. But `amend-no-docs-lie` is an `info` diagnostic and `writeDiagnostics` drops `info` on purpose, so the human form printed two lines, its own name and the repository path, and a reader could not tell a refusal from a success. Fixed: `propose` now surfaces that one diagnostic in its summary, reusing the diagnostic's own text so the two cannot drift, with two tests in `amend.test.ts` covering the refusal and the non-refusal
    - **Reverted again, and verified by hash.** `apps/fixture/README.md` is back at `b2118de7aef19263a2d6fb18eba0778e4120b5521077e6de4ed0d26383efadef` and `apps/ledger/data/ledger.snapshot.json` at `3e360ce5ad3a857bdb1d562d12e7021a55b03d9cf4ac722d1b8652d91caa38e9`, both compared against copies taken before the cycle started. The corpus document and its recording are gone. One environmental note worth keeping: the curated evidence pack was deleted and an iCloud sync daemon restored the directory minutes later, so that assertion is made against git's index in `evidence-integrity.test.ts` rather than against the working tree, and the test says why
    - **The inconsistency flagged below is now resolved rather than flagged.** The file header of `docs-trigger-loop.test.ts` read the exclusion as permanent; the second cycle shows it was the plan cache, and the header states that with the run behind it
    - **One inconsistency left standing rather than tidied.** The file header of `packages/kept-cli/test/docs-trigger-loop.test.ts` reads the exclusion as permanent and attributes it to Kane committing a recording only on a pass. Its 18 assertions are sound, because they are about the plan capture and the run; the prose around them overshoots what those bytes support, and `tests/output-shop_filter_persist/.internal/meta.json` in the same tree contradicts it. Which document to edit is a decision, so it is flagged here and in `docs/kane/loop/README.md` rather than made quietly
    - **Two more defects found while putting the tree back, both about counting.** The run log's cap was a plain newest-first slice, and when the log first grew past it the run that earned six of the seven proven verdicts fell off the end while all six promises went on citing it, so `/runs` no longer listed the row a reader clicked through to. The cap is a cap on history rather than on provenance now: a cited run is retained regardless of age, and the assertion is on the property rather than on the retention code. Separately, `maintain reconcile` **appends** use cases rather than matching them, so three `--plan` runs against one document took Kane's graph from nine use cases to thirteen by re-extracting the same three, and `ucs_needing_scenarios` rose from 8 to 12 without a single new use case being described
    - **The committed `1/9` was already carrying one earlier round of that.** Four duplicate pairs exist below it, so the graph describes five distinct use cases and reports nine. It is left at `1/9` rather than corrected, because §5.3.0's rule is that the ribbon publishes Kane's report verbatim, and the moment KEPT deduplicates Kane's graph on the way to the page it stops quoting a source and starts editing one. What a reader is owed is the caveat, not a quieter number. Today's four were undone with `kane-cli context revert`, which inverts a record's effects through a compensation record: `context fsck` verifies 39 records in parity and `cover gaps` reads `1/9` again
    - **The graph earned a second evidence pack**, 20 artefacts, from the two promises re-verified live. It is curated and committed, so four evidence edges resolve where two did, and four of the six previously dropped edges resolve as a consequence. `evidence-lane.test.tsx` was re-counted rather than loosened, and a new clause asserts every published edge names a pack the file carries, so a future curation change that keeps the arithmetic but breaks the referencing still fails
    - Commit: "test(integration): the docs-triggered loop, one cycle, nothing written"
    - _Requirements: 5.9, 5.10, 5.11, 7.3, 7.4_

- [x] 23. Portability — the engine runs against a repository that is not this one (§20)
  - The promise model is already repository-agnostic; a set of literals is not. This stage moves them into Kept_Config and adds the guard that keeps them out. Nothing here needs Kane and nothing here spends a credit.

  - [x] 23.1 Extend the Kept_Config schema and its loader
    - Add `corpus.root`, `subject.source`, `subject.docs`, `subject.baseUrl`, `fences.<branch>.allow` and `timeouts.doctorMs` to the zod shape beside the existing `verdictRouter`, `memberDebug` and `timeouts` keys, per §20.1
    - `fences` declares **only** `allow`; the forbidden set is derived as the corpus root, every documentation glob and both package roots, unioned with every glob the branch does not allow. A hand-written `forbid` key is rejected as an unknown field, because a fence a user can spell is a fence a user can leave a hole in (§20.1)
    - Resolve every optional key to the fail-closed default of §20.4 and emit one `info` diagnostic per applied default naming the key and the value; an absent `fences.*.allow` and an explicit `[]` resolve identically but are reported distinguishably
    - On a schema violation, report the offending field path and the expected type, invoke Kane zero times and leave every verdict unchanged (R15.6)
    - Commit: "feat(core): repository-specific values move into the config schema"
    - _Requirements: 15.1, 15.4, 15.6_

  - [x] 23.2 The fence intersection guard, at load time
    - `loadConfig` computes, for every branch, whether the allow set can match any path under `corpus.root` or any `subject.docs` glob, and refuses the whole configuration when `code-break` can, reporting `config-fence-intersects-claims` and naming the intersecting glob (§20.3)
    - Decide intersection with the hand-rolled matcher of §3.18, not a new dependency. Evaluate over the union of both pattern sets plus a generated adversarial set: `**`, `**/*`, a parent traversal reaching the corpus root, and an allow glob whose prefix is a docs glob's prefix
    - **This is a load-time rejection, never a run-time filter.** A fence checked when it is used has already been trusted once
    - Refusing performs no run and moves no verdict, so the guard cannot itself corrupt state
    - Commit: "feat(core): refuse any config whose code-break fence can reach a claim"
    - _Requirements: 15.7, 15.8_

  - [x] 23.3 Write property test for the fence guard
    - **Property 31: Repair fences never permit editing the claim's own source**
    - **Validates: Requirements 15.7, 15.8, 7.7, 7.8**

  - [x] 23.4 Move the literals, and add the scan that keeps them out
    - Add the seventh source scan of §20.2 over `packages/kept-core/src` and `packages/kept-cli/src`, failing on an `apps/fixture` string, a `3100` port literal, a `tests/` directory literal and `localhost:<digit>`; permitted inside `packages/*/test/**`, `test/fixtures/**` and comments
    - **The scan fails on first run and that is the point.** Move `providers/baseline.ts`'s scan root, the fence table's fixture globs, the reachability probe's URL and the Docs_Hook-facing glob set to read from Kept_Config in the same commit, so the guard and the compliance land together
    - Rewrite both `.kiro/hooks/*.json` pattern lists to match the configured globs, and add the hook-schema assertion that the patterns and `subject.*` agree, so the hooks cannot drift from the config they mirror
    - Commit: "refactor(core): the last fixture literals leave the engine, with a scan to keep them out"
    - _Requirements: 15.2, 15.3, 15.9_

  - [x] 23.5 Write property test for configuration as the only source of repository facts
    - **Property 30: Configuration is the only source of repository-specific values**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.9**

  - [x] 23.6 The host-repository integration test
    - Generate the temporary repository of §20.5 outside the workspace: `docs/product.md` with three one-line claims, `suite/checkout_test.md` carrying one `@verifies docs/product.md:2` and a `covers` glob, `src/checkout.ts`, and a Kept_Config naming none of this repository's paths
    - Run the same `buildGraph` the CLI runs and assert: one admitted promise citing `docs/product.md:2` with that line's verbatim text; the two unadmitted claims reported as candidates rather than promises; the blast radius for `src/checkout.ts` naming the one member; the `code-break` allow set resolving to `src/**` with `suite` and `docs/**/*.md` forbidden
    - **Assert that zero files were written outside the temporary directory.** A path resolved against `process.cwd()` rather than `--repo` writes into the developer's own repository while the test passes, and a test that only checks its own outputs never notices
    - Commit: "test(core): build a graph in a generated repository that shares no path with this one"
    - _Requirements: 15.10, 15.11, 15.12_

  - [x] 23.7 Write property test for host-repository totality
    - **Property 32: The engine builds a graph in any host repository**
    - **Validates: Requirements 15.4, 15.5, 15.6, 15.11, 15.12**

- [x] 24. The onboarding surface — `kept init` and `kept doctor` (§21)
  - For a stranger these are the first two commands run and the only documentation guaranteed to be read. Both are held to the Baseline_Provider's totality discipline: they succeed on every repository state and neither spends a credit.

  - [x] 24.1 Implement `kept init`
    - Four ordered steps per §21.1, stopping at the first that cannot proceed: refuse if configured and `--force` is absent (write nothing, name the existing path, exit 0); detect documentation and corpus candidates; write the fail-closed config; scaffold exactly one `example_test.md`
    - **Report every detected documentation candidate and write a citation for none of them.** Deciding which sentences are promises is the user's judgement, and a tool that guesses produces a graph full of claims nobody meant to make
    - The scaffolded test carries one `@verifies` tag, a `covers` list, and a comment stating in as many words that the tag must be repointed before the file means anything
    - `--force` replaces the config and names what it replaced; it does **not** replace the scaffolded example, because overwriting a test the user has since edited is a different and worse operation
    - Wire the `init` case into `main.ts`'s switch and print `kept doctor` as the next command
    - Commit: "feat(cli): kept init, which detects candidates and invents no citations"
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

  - [x] 24.2 Write property test for initialisation idempotence
    - **Property 33: Initialisation is idempotent and spends nothing**
    - **Validates: Requirements 16.1, 16.2, 16.6, 16.8**

  - [x] 24.3 Implement `kept doctor`
    - The command is unwired today: `node bin/kept doctor` prints "specified in design §13.1 and lands in task 16.2; nothing was run and nothing was written", and `main.ts`'s switch carries only `amend`, `build`, `evolve`, `reconcile`, `snapshot`, `verify`
    - Seven checks per §21.2's table, each reporting `pass`, `fail` or `not-configured` and each carrying a remedy string when it does not pass: Kane binary via `invokePlain` on a 10 s budget, config parse and selected router, corpus file and `@verifies` counts, snapshot presence and schema validity, subject reachability on a 2 s GET or `not-configured` when the base URL is null, context store presence, and the §20.3 fence check reported even when it passes
    - **At most one Kane spawn**: check 1 is the only one that spawns, and the context-store check reads the filesystem rather than asking Kane
    - Exit 0 in every case including a missing binary. Kane's absence is a supported state (R2.12) and `doctor` must not be the command that treats it as fatal
    - Write only the handoff, so an agent reads the diagnosis the way it reads every other outcome rather than parsing stdout
    - Commit: "feat(doctor): seven checks, one spawn, a remedy each, exit zero either way"
    - _Requirements: 2.12, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10_

  - [x] 24.4 Write property test for diagnosis totality
    - **Property 34: Diagnosis is total, bounded and exits zero**
    - **Validates: Requirements 18.1, 18.2, 18.8, 18.9, 18.10**

- [ ] 25. Distribution — the packages install and run outside this workspace (§22)
  - [x] 25.1 Correct both manifests
    - Remove `private: true` from both; set both versions to `0.1.0`; rewrite `kept-cli`'s dependency on `kept-core` from the literal `0.0.0` to `^0.1.0`, which resolves from the registry rather than only through the workspace symlink
    - Add `repository`, `description`, `keywords`, `engines.node` at the repository's stated floor, and the repository's stated license to both
    - Add `prepublishOnly` running `tsc -b` to both, so a stale `dist` cannot publish
    - Add the test asserting the two versions are equal, because a CLI at `0.1.1` depending on `^0.1.0` while the repository builds them together is a drift nobody notices until an install resolves the older core
    - Commit: "chore(packages): manifests that can actually publish, at one shared version"
    - _Requirements: 17.1, 17.2, 17.3, 17.6, 17.7, 17.8_

  - [x] 25.2 Assert the tarball's contents
    - Pack both packages and read the real archive file lists: compiled output and `.d.ts` present; no `*.test.ts`, no `test/fixtures/**`, no `*.evidence/**`, no `output-*/**`
    - **How it is actually packed, since the wording above is looser than the test.** `packaging.test.ts` reads the file lists and sizes from `npm pack --dry-run --json`, which is npm's own answer to "what would go in the archive" and is the same computation the real pack performs, so the lists and the byte counts are real while no archive is written. 25.3 writes real tarballs, into a temporary directory outside this workspace, because that task's whole point is installing them. Splitting it that way keeps the fast assertion fast and the slow one honest
    - Assert the `kept` binary carries an interpreter directive on line one, which is the failure that turns a global install into `Permission denied` on a machine that is not the author's
    - Record the measured tarball sizes so a future publish that suddenly ships four megabytes is visible
    - Commit: "test(packages): the tarball is the deliverable, so assert the tarball"
    - _Requirements: 17.4, 17.5_

  - [x] 25.3 Install outside the workspace and run the binary from there
    - Pack both packages to a temporary directory, `npm install` both tarballs into a **second** temporary directory that is not under the workspace root and has no `node_modules` above it, then run the installed binary
    - Assert: the version command reports `0.1.0`; `kept doctor` exits 0 in that directory with no config, no snapshot, no corpus and no Kane on the path; every check reports `not-configured`; `kept init` is named as the remedy; and **no module resolves from this workspace**
    - The location is the whole test. Inside the workspace root, Node's resolution walks up and finds everything, so the test passes while the published package is broken
    - Commit: "test(packages): install the tarballs outside the workspace and run kept from there"
    - _Requirements: 17.9, 17.10_

  - [x] 25.4 Write property test for the packed tarball
    - **Property 35: The packed tarball is installable and self-sufficient**
    - **Validates: Requirements 17.3, 17.4, 17.5, 17.9, 17.10**

  - [x] 25.5 Write the per-package READMEs and the recorded publish procedure
    - One README per package stating the Kane CLI prerequisite, the local Chrome prerequisite and `kept init` as the first step. A bare npm page undersells this badly and is the only documentation an installer sees
    - `docs/publish.md` recording the procedure of §22.4 in order: bump both versions together, `tsc -b`, `npm pack` both, inspect both file lists, run the outside-the-workspace install test, publish core before cli so the dependency resolves at the moment cli is published
    - **All three documents were written and none of them was asserted, which an audit of this plan caught.** Every other documentation deliverable here carries assertions; these were the one place a claim could rot with nothing going red, inside the repository built to detect exactly that. `packages/kept-cli/test/published-docs.test.ts` closes it in 21 assertions, and it asserts only the things that can silently disagree with the tree rather than the prose: each README's stated Node floor against its own `engines.node`, its install command against its own package name, both prerequisites KEPT cannot supply, and `kept init` as the first step; and in the procedure, the stated version against both manifests, the stated dependency range against the CLI manifest with its floor admitting the core version, core published before cli, every named test file present on disk, and the seven numbered steps in order
    - **The audit was vindicated immediately.** `docs/publish.md` still carried a section headed "Currently red, and blocking", naming the undeclared `yaml` and `zod` dependencies and telling whoever next published to stop and fix them. They had been fixed in 25.3. The document was spending a reader's time and teaching them to disbelieve two passing suites, so there is now a clause refusing any present-tense claim that a test is failing. The past tense is allowed and wanted: that finding is the most valuable paragraph in the file, and it is the argument of the whole repository in miniature
    - Commit: "docs(packages): per-package READMEs and a publish procedure written down"
    - _Requirements: 17.11, 17.12_

  - [ ] 25.6 Publish — **the last task in this stage, and deliberately manual**
    - Run the whole gate first: `npm run check`, then 25.2 and 25.3 green, then publish core, then cli
    - Do not automate this. A publish is irreversible per version, and the one thing worse than an unpublished package is a published broken one
    - Commit: "chore(release): kept-core and kept-cli 0.1.0"
    - _Requirements: 17.1, 17.12_

- [x] 26. Self-verification — KEPT's own README as a promise source (§23)
  - Replaces the withdrawn Conduit target (21.10). Proves the engine is not fixture-specific for one config entry and a `@verifies` tag, and proves something stronger besides: the document making the claims is the document being checked.

  - [x] 26.1 Admit the root README as a promise source
    - Add `README.md` to `subject.docs` and author `*_test.md` files whose `@verifies` tags cite it, choosing the README's statements about **observable behaviour** rather than its prose: the demo command starting both applications, the demo command invoking Kane zero times, the suite passing with no network or credentials, the badge endpoint returning SVG, the deployed Ledger carrying no mutating handler
    - Several of these already have passing tests, so binding them is adding a tag to a document that exists rather than authoring a Kane run. Keep the credit cost at zero for the majority
    - Assert that the fence derivation treats `README.md` as a documentation glob and therefore forbids `code-break` from touching it, which is the same protection the fixture README already has
    - Commit: "feat(promises): KEPT's own README enters the graph it publishes"
    - _Requirements: 19.1, 19.2, 19.3_

  - [x] 26.2 Write property test for self-cited promise parity
    - **Property 36: Self-cited promises are the same kind as fixture promises**
    - **Validates: Requirements 19.1, 19.2, 19.3, 19.4**

  - [x] 26.3 Let the coverage figure fall, and hold it there. **Delivered against a different metric than the one asked for; see the note below**
    - `designedCoverage` reads `1.0` on eight of eight today. Admitting self-cited claims with no bound test lowers it, and the Ledger must report the lower number with the undesigned claims counted as outstanding debt
    - **Do not admit only the claims that already pass.** R19.5 forbids it in the same words §22.1 uses about the coverage ribbon: a `designedCoverage` of `1.0` achieved by leaving out the inconvenient claims is the failure mode of an untested README reproduced inside the tool built to detect it
    - Add the assertion that the admitted self-cited claim count does not decrease between builds, so the temptation is mechanically foreclosed rather than resisted
    - **What was delivered.** `provenCoverage` fell from `0.875` to 7 of 13 and the five new root-README claims are carried as `stale`. `designedCoverage` stayed at `1` and `undesignedCount` stayed at `0`, and the assertion that the self-cited count cannot fall below five is in `packages/kept-cli/test/committed-snapshot.test.ts`. So the figure fell and is held there, on the axis the grammar actually allows
    - **Why the asked-for metric did not move, and why it was left alone.** A promise enters the graph only through a `@verifies` tag, and that tag binds the document carrying it as the claim's designed test, so `packages/kept-core/src/providers/baseline.ts` sets `designedTest` on every candidate it emits. A promise with no designed test is unreachable by construction here, and `designedCoverage` cannot read anything but `1`. Design §23.2 assumed a docs-side scanner that would mint promises from untagged README lines; **no such scanner exists**, and building one so a metric could move would add a second admission grammar used by nothing but this repository's own claims, which is the special case Property 36 forbids
    - `stale` is also the truer word for the five: designed, not yet proven. R19.4's `undesigned` arm stays specified and stays exercised over generated providers in Property 36, so a host repository whose provider supplies an unbound claim still gets it. Recorded in §23.2, in A19 and in `docs/self-verification.md` rather than left as an unexplained gap
    - Commit: "test(coverage): the self-cited debt is counted, and cannot be trimmed away"
    - _Requirements: 19.4, 19.5_

  - [x] 26.4 Record the withdrawal of the second target
    - State in `docs/` and in the README's roadmap that R14.8's `MAY` is not exercised, with the reason: cost, not capability. A backend, a database, a second application and a second corpus authored with live credits, against a self-citation needing one config entry and a tag
    - Commit: "docs: the second target is withdrawn, and why"
    - _Requirements: 19.6, 19.7_

- [ ] 27. Final checkpoint and the re-recorded submission artefacts
  - **Read this before starting stage 22 or later.** Stages 22, 23 and 26 all change what the deployed Ledger shows: 22.1 replaces the withheld `provenCoverage` with a real figure and removes the degraded chip, 22.2 adds an amendment and moves the debt counts, 26.3 lowers `designedCoverage`. The video committed at 19.5 shows the Ledger as it was. Re-record **once**, after all of them, rather than per stage.

  - [x] 27.1 One clean whole-suite run, and the checkpoint 20 sign-off
    - `npm run check` end to end: the read-only scan, three type-check passes, then the suite. Investigate the run duration against the README's stated figure and correct whichever is wrong
    - Nothing in this stage's remaining tasks starts until this is clean
    - **Clean.** The read-only scan reads 47 Ledger source files against 11 rules with no violations, `tsc -b` and both application type-check passes are silent, and the suite is 156 files and 2,755 tests with 2,751 passing and 4 conditionally skipped. Five consecutive runs measured 41.7, 43.5, 43.7, 43.7 and 44.0 seconds, so the README's figure was moved to about 44 seconds rather than the 43 it carried: the number was stale by a second in the direction that flatters, which is the direction worth correcting
    - The four skips are the pair of assertions that hold the README to a placeholder URL rather than a deployed one. The deployment happened, so the opposite assertions run in their place. Nothing is red, nothing is pending, and no skip is a switch
    - _Requirements: 14.2_

  - [x] 27.2 Reconcile every stated figure with the tree
    - The README states a test-file count, a test count, a runtime dependency count and a property count, and a test asserts the first against the files on disk. All four move in this extension. Update them and the badges in the same commit as the last code change, not afterwards
    - `docs/checkpoints.md` quotes `degradedReasons`, which changes when 21.5 lands; `docs/commit-history-audit.md` quotes a commit count and a head sha, which change continuously
    - **Measured, not transcribed.** 156 test files and 2,755 tests, of which 2,751 pass and 4 are conditionally skipped, in about 43 seconds; nine runtime dependencies, unchanged; thirty-seven correctness properties, and every one of them now has a `.prop.test` naming it, which the README previously understated as thirty-five of thirty-six. The property inventory was reconciled in the other direction too: task 22.1's property existed as a test title reading `Property 22.1` and as prose in §5.3.0, with no numbered entry in the design's list. It is now **Property 37**, appended in authoring order beside Properties 35 and 36, and the test titles were moved to match. A decimal ordinal was tried first and refused by the specification format, which was the right refusal: a list of thirty-six integers with one decimal in it is a list a reader has to be told how to count
    - `docs/checkpoints.md` carries a stage 26 entry quoting the regenerated snapshot, and keeps the earlier eight-promise table as recorded history in the past tense rather than writing over it. `docs/commit-history-audit.md` moved from 164 commits at `47fa56e` to 188 at `2fde403`, so twenty-four commits landed between the two passes and the head is a different one, while nothing about the shape moved: still linear, still one author, still every subject named, still inside the event window. It also now records that there are zero configured remotes and that the tree is local-only. The extension's own work is uncommitted, so it is not in that 188 and the next pass will move the count again
    - Three sources of stale prose were fixed alongside, all of them describing a state that had already moved: twenty-two source and test files still called the snapshot degraded with a withheld `provenCoverage`, two hand copies of `subject.docs` had silently gone one entry short of the config when `README.md` was admitted (both now derive from the file rather than restating it), and three modules called the no-store refusal this repository's own live path, which a successful `context list --type source --json` here disproves
    - Commit: "docs: every stated figure re-measured against the tree"
    - _Requirements: 14.2_

  - [ ] 27.3 Re-record the demonstration video against the new Ledger
    - 180 seconds or less, in R14.4's mandated order, now with the dual-axis ribbon rendering a real figure and the docs-triggered cycle showing debt appear before it is bound
    - The debt beat is showable for the first time after 22.2: the snapshot's `undesignedCount` and `reviewCards` are both 0 today, so the "a new claim announces its own debt" moment has nothing to point at until that cycle is recorded. It is also the beat no competing approach describes
    - A new recording means a new URL. Update the README's demo link, `docs/`, and the submission form together
    - Commit the file or its link record with the shot list and the measured duration
    - Commit: "docs: 180-second demonstration video and shot list"
    - _Requirements: 14.3, 14.4_

  - [ ] 27.4 Final checkpoint — every deliverable green and every claim cited
    - Ensure all tests pass, ask the user if questions arise. The suite, the read-only scan, the portability scan, the fence guard, the tarball install test and the self-cited debt assertion must all be green together
    - Re-add the git remote and push only when the user says so. The remote was removed deliberately during this stage of work

## Notes

- **Stages 23 through 27 are the extension, and none of it is polish.** 23 makes the engine usable outside this repository, 24 is the surface a stranger meets, 25 is the claim "a published `kept-cli` and `kept-core` are coming soon" turned into something with a test behind it, 26 replaces a withdrawn target with a stronger and cheaper one, and 27 is the bookkeeping that keeps every stated figure true. Seven new correctness properties (30 through 36) carry the load, and the two that matter most are **31**, which keeps a user-editable fence from authorising the one repair this project must never perform, and **35**, which is the only honest test of "it works when installed".
- **Two items were dropped by decision rather than deferred**, and both are recorded in A17, in §18's table and at their task: **21.7 Shiki** (a tenth dependency against a budget a test asserts, to highlight one line of English prose) and **21.10 Conduit** (a backend, a database and a second corpus, to prove what stage 26 proves with a config entry and a tag).
- **Optional marking, and why nothing carries it any more.** A `*` meant *this may be cut if the timebox bites*. It was never a statement about whether the work happened, and leaving it on completed items made finished work read as unfinished — so it was stripped from all 34 of those. **There are now zero starred tasks**: everything in 21 was promoted to required by decision, and 22 was never optional. The notation is kept documented here because history contains it.
  - **The properties were the bulk of that.** All 29 correctness properties were planned as cuttable and all 29 were built and are green — 33 `*.prop.test.ts` files, 243 assertions. Property 9 splits into 3.17 for the state-guard clause and 11.12 for the out-of-radius byte-identity clause; Property 22 splits into 9.5 for presentation/contrast and 17.3 for the reduced-motion clause, and 17.3 was never cuttable.
  - The design's non-property tests were never cuttable either, because the design treats them as structure: the six source scans (2.3 `result_code`, 9.12 Ledger read-only, 11.5 router isolation, 17.2 `animejs` import shape and location, 8.4 mono-vs-prose typography, 8.3 forbidden palette), the pinned smoke-run regression (2.15), the `cover` refusal regression (2.16), the invoker enabler assertions (2.21), the per-command argv suite (12.13), the source-resolution ladder (12.5), the visual trio (8.3), the widened CSS motion scan (8.6), the reduced-motion equivalence test (17.3), hook-schema validation (12.11), and committed-evidence referential integrity (15.8). Fixture and generator authoring (2.10, 2.11, 6.4, 12.4) is unstarred too — a property with no generators is a property that never ran.
- **Droppables, and three reclassifications.** Tasks 21.1–21.10 and the motion flourishes 17.6–17.8 were the droppable set. **None of the five flourishes was cut** — M1 through M5 all shipped. Three items in §18's table were wrong about themselves and are corrected there and here:
  - **21.6 (`[member]` capture) was never droppable.** `testrun_member_end` carries no `result_code`, no `reason_code` and no verdict object, so this capture is where the *only* classification signal lives. Dropping it removes two of the three repair branches. Shipped.
  - **21.5 (`cover gaps`) is not droppable.** Its stated replacement — "`cover --json` already supplies both axes" — is false here: `cover` reads depth from a sealed pack and refuses on a replay pack, which is every pack this repository has. `cover gaps` is the only working path to the axis.
  - **21.4 (evidence lane) was already built.** It looked droppable because `snapshot.evidence` was empty until curation was fixed. What remains is proving it renders.
- **Everything in 21 is now required by decision**, and 22 closes the two gaps against the original design. Only 21.10 (Conduit) carries a standing instruction to abandon rather than regress a submission deliverable. **Nothing from §18.2 may be dropped** — the palette and its measured matrix, the light/elevation system, the reduced-motion path, typography discipline, the parity test and the forbidden-palette scan are the Craft score, not polish. If all five flourishes were ever cut, `animejs` leaves `package.json` and `lib/motion.ts` collapses to the synchronous branch it already has, with no component changes.
- **[LIVE KANE]** tasks consume credits on authoring, need a local Chrome installation, and cannot run on CI: 6.1, 6.2, 6.3, **21.1**, **22.2**, and 15.1 through 15.6 — now including the stage-15 bootstrap ingest/extract and the reconcile integration run. Everything else is offline and reproducible from committed fixtures.
- **`kept reconcile` is the corrected branch.** `kane-cli maintain reconcile` requires `--from` and `--source-id`; the earlier bare invocation would have exited 2 on every save and looked wired up. `--source-id` can only be constructed from the `ok: true` arm of `SourceResolution`, so an unresolved source is a no-op by type rather than by discipline: no spawn, no card, no verdict movement, `degraded` still false, exit 0. `--plan` is the hook default; `kept reconcile apply` is human-only; `--plan` with `--apply` is the single case `kept` itself exits non-zero.
- **The reduced-motion path is a state, not a fallback.** Every orchestration resolves to its end state synchronously on first paint under `prefers-reduced-motion: reduce`, the media query is observed live, and in-flight timelines are completed rather than cancelled. 17.3 asserts the two renders are the same DOM with the same computed styles.
- **Verified facts now baked in.** `context ingest` is the one-flow entry, but the invoker's `stdio: ['ignore','pipe','pipe']` means any ingest KEPT performs lands only — so stage 15 opens with two explicit commands. The `cover` refusal envelope is committed verbatim as `assurance-cover-refused.ndjson` with `degradedReason: assurance-status:refused`. `context --help` is abridged; nine subcommands are confirmed present. The Kane skill installs for Claude Code, Codex CLI and Gemini CLI only, so no task installs it.
- The verdict spike (task 6) is deliberately out of §19's stage-9 position. Its only downstream effect is the `verdictRouter` string in `.kept/config.json`, fenced by the isolation scan in 11.5, so nothing built after it needs rework whichever way it lands.
- `ledger.snapshot.json` is the CLI↔UI seam. Its zod schema (3.13) is green before any Ledger task reads a snapshot, so a malformed snapshot fails the build rather than rendering a lie.
- `mayWriteVerdicts()` (3.16) is the single write guard: verdicts move only on `kind: 'complete'` plus `exitMeaning ∈ {success, failure}`. Crashed, paused, timed-out, interrupted, preflight-rejected and source-unresolved outcomes preserve prior state by construction.
- `parseStream` cannot be called without a declared `CommandFamily`, and `FamilyContract` has no public constructor — a parser call without a named family is a type error, not a review comment.
- Dependency budget is **nine** runtime packages against roughly 7 GB of free disk, with `animejs` pinned to exactly `4.5.0` and asserted by 17.2. Shiki, dagre/elkjs, commander/yargs, concurrently, micromatch, Playwright/Puppeteer, Docker, framer-motion, GSAP, lottie, icon packages and font packages stay out; the hand-rolled replacements are tasks 9.2, 11.9, 14.6 and 3.18.
- `vitest --run` always, never watch. `fast-check` runs a minimum of 100 cases per property, and every property test names its design property in the test title.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0,  "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1,  "tasks": ["2.1", "2.2", "2.6", "2.8"] },
    { "id": 2,  "tasks": ["2.3", "2.4", "2.5", "2.7", "2.9", "2.17", "2.19"] },
    { "id": 3,  "tasks": ["2.10", "2.18", "2.20"] },
    { "id": 4,  "tasks": ["2.11", "2.15", "2.16", "2.21"] },
    { "id": 5,  "tasks": ["2.12", "2.13", "2.14"] },
    { "id": 6,  "tasks": ["3.1"] },
    { "id": 7,  "tasks": ["3.2", "3.3", "3.11"] },
    { "id": 8,  "tasks": ["3.4", "3.5", "3.7", "3.12"] },
    { "id": 9,  "tasks": ["3.6", "3.8", "3.13", "3.16"] },
    { "id": 10, "tasks": ["3.9", "3.10", "3.14", "3.17"] },
    { "id": 11, "tasks": ["3.15", "3.18"] },
    { "id": 12, "tasks": ["5.1", "5.2"] },
    { "id": 13, "tasks": ["5.3", "5.4"] },
    { "id": 14, "tasks": ["5.5"] },
    { "id": 15, "tasks": ["5.6"] },
    { "id": 16, "tasks": ["6.1"] },
    { "id": 17, "tasks": ["6.2"] },
    { "id": 18, "tasks": ["6.3"] },
    { "id": 19, "tasks": ["6.4"] },
    { "id": 20, "tasks": ["8.1", "8.2"] },
    { "id": 21, "tasks": ["8.3", "8.5"] },
    { "id": 22, "tasks": ["8.4", "8.6", "8.7", "9.1", "9.2", "9.11"] },
    { "id": 23, "tasks": ["9.3", "9.4", "9.9"] },
    { "id": 24, "tasks": ["9.5", "9.6", "9.10"] },
    { "id": 25, "tasks": ["9.7", "9.8", "9.12"] },
    { "id": 26, "tasks": ["11.1", "11.8"] },
    { "id": 27, "tasks": ["11.2", "11.3", "11.4", "11.9"] },
    { "id": 28, "tasks": ["11.5", "11.6", "11.7", "11.10"] },
    { "id": 29, "tasks": ["11.11"] },
    { "id": 30, "tasks": ["11.12", "12.1", "12.4"] },
    { "id": 31, "tasks": ["12.2", "12.8"] },
    { "id": 32, "tasks": ["12.3", "12.9", "12.10"] },
    { "id": 33, "tasks": ["12.6", "12.11", "12.12"] },
    { "id": 34, "tasks": ["12.5", "12.7"] },
    { "id": 35, "tasks": ["12.13", "14.1"] },
    { "id": 36, "tasks": ["14.2", "14.4"] },
    { "id": 37, "tasks": ["14.3", "14.5", "14.6"] },
    { "id": 38, "tasks": ["15.1"] },
    { "id": 39, "tasks": ["15.2"] },
    { "id": 40, "tasks": ["15.3", "15.4", "15.5"] },
    { "id": 41, "tasks": ["15.6"] },
    { "id": 42, "tasks": ["15.7", "15.10"] },
    { "id": 43, "tasks": ["15.8", "15.9"] },
    { "id": 44, "tasks": ["17.1"] },
    { "id": 45, "tasks": ["17.2", "17.3"] },
    { "id": 46, "tasks": ["17.4", "17.5"] },
    { "id": 47, "tasks": ["17.6", "17.7", "17.8"] },
    { "id": 48, "tasks": ["19.1"] },
    { "id": 49, "tasks": ["19.2", "19.3", "19.4"] },
    { "id": 50, "tasks": ["19.5"] },
    { "id": 51, "tasks": ["19.6"] },
    { "id": 52, "tasks": ["21.4"] },
    { "id": 53, "tasks": ["21.2", "21.3"] },
    { "id": 54, "tasks": ["22.2"] },
    { "id": 55, "tasks": ["21.5", "22.1"] },
    { "id": 56, "tasks": ["21.1"] },
    { "id": 57, "tasks": ["21.7"] },
    { "id": 58, "tasks": ["21.8", "21.9"] },
    { "id": 59, "tasks": ["21.10"] }
  ]
}
```
