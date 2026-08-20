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

- [ ] 1. Repository skeleton and toolchain
  - [ ] 1.1 Create the npm workspaces root and test toolchain
    - Root `package.json` with workspaces `apps/*`, `packages/*` and scripts `demo`, `loop`, `build:snapshot`, `test` (`vitest --run`), `check` (`node scripts/check-readonly.mjs && tsc -b && vitest --run`)
    - `tsconfig.base.json` (strict), single root `vitest.config.ts` with projects `kept-core` and `kept-cli` plus a jsdom project for `apps/ledger`
    - Install only the nine runtime packages of design §2.2 with `animejs` written as the exact literal `"4.5.0"`; dev deps `typescript`, `vitest`, `fast-check`, `@testing-library/react`, `jsdom`, `@types/*`
    - Commit: "chore: npm workspaces root, strict tsconfig, vitest root config"
    - _Requirements: 12.3, 13.1_

  - [ ] 1.2 Create package skeletons, `bin/kept`, and working state
    - `packages/kept-core` and `packages/kept-cli` (`bin: { "kept": "dist/index.js" }`); `bin/kept` shebang launcher
    - `.kept/config.json` with `verdictRouter`, `memberDebug`, `timeouts.hookMs` 300000, `timeouts.enrichmentMs` 60000
    - `.gitignore`: exclude `.context/` and `.kept/`, force-add `output-*/` and the curated evidence paths
    - Commit: "chore: kept-core and kept-cli packages, bin/kept, .kept config"
    - _Requirements: 6.10, 13.6, 13.7_

  - [ ] 1.3 Implement `diagnostics.ts`
    - `Diagnostic { code, severity, message, file, line, at }` and `DiagnosticSink`; every later module reports through this rather than throwing
    - Commit: "feat(core): diagnostic record and sink"
    - _Requirements: 2.3, 3.24_

- [ ] 2. Kane three-contract layer
  - [ ] 2.1 Implement `kane/family.ts`
    - `CommandFamily`, `TerminalType<F>`, `NdjsonEnabler`, `FamilyContract<F>` with **no public constructor** — `contractFor(family)` is the only way to obtain one
    - `familyForArgv(argv)` reverse lookup; the `CONTRACTS` table encodes terminal type, NDJSON enabler, exit-3 meaning and evidence location once, and lists `context extract`, `context list`, `design tests`, `maintain reconcile`, `maintain evolve`, `cover`, `cover gaps` under Assurance
    - Commit: "feat(core): three Kane command-family contracts"
    - _Requirements: 3.2, 3.4, 3.5_

  - [ ] 2.2 Implement `kane/coerce.ts`
    - `resultCode()` accepting number, decimal string and whitespace-padded string, returning null for absent/non-numeric; `credits()` preferring `credits_consumed` and accepting `credits`
    - This file is the only site in the repo permitted to compare `result_code`
    - Commit: "feat(core): result_code and credits coercing accessors"
    - _Requirements: 3.10, 3.11, 3.13, 3.14_

  - [ ] 2.3 Write source scan 1 of 6 — no raw `result_code` comparison
    - `packages/kept-core/test/no-raw-result-code.test.ts` reads every `.ts` under `packages/kept-core/src` and `packages/kept-cli/src` and fails if `/result_code\s*(===|!==|==|!=)/` matches outside `kane/coerce.ts`
    - Architectural guard, not coverage — it is what keeps the three-way branch from silently never firing on the observed mixed typing
    - Commit: "test(core): forbid raw result_code comparison outside coerce.ts"
    - _Requirements: 3.12_

  - [ ]* 2.4 Write property test for result-code coercion
    - **Property 10: `result_code` coercion makes string and number forms equivalent**
    - **Validates: Requirements 3.11, 3.12, 3.13, 6.8**

  - [ ]* 2.5 Write property test for the credits accessor
    - **Property 11: The credits accessor prefers `credits_consumed` and accepts `credits`**
    - **Validates: Requirements 3.10, 14.7**

  - [ ] 2.6 Implement `kane/exit.ts`
    - `exitMeaning(family, code, killed)` total over all integers and null; `(Assurance, 3)` → `paused-resumable`, `(ExecutionTestrun, 2)` → `preflight-rejected`, `130` → `force-interrupted`, `127`/ENOENT → `kane-not-found`, killed → `killed-by-timeout`
    - Commit: "feat(core): per-family exit-code interpretation"
    - _Requirements: 3.15_

  - [ ]* 2.7 Write property test for exit-code interpretation
    - **Property 12: Exit-code interpretation is total and family-correct**
    - **Validates: Requirements 3.14, 3.15, 4.11, 11.9, 11.10, 11.11**

  - [ ] 2.8 Implement `kane/events.ts`
    - Typed `KaneEvent` union plus `Run_End`, `Testrun_Plan`, `testrun_member_end`, `Testrun_Done`, `Assurance_Done`, `ProgressEvent`, `VerdictObject`; the known-type set from design §4.3 treated as open
    - Assurance envelope `{ type, v: 1, verb }` typed as present-and-optional per the verified refusal envelope (§5.3.1); `run_dir` typed as `readonly runDirLegacy?: string` only, never read from disk
    - Commit: "feat(core): typed Kane event surface for all three families"
    - _Requirements: 3.16, 3.17, 3.18, 3.20, 3.21, 3.22_

  - [ ] 2.9 Implement `kane/ndjson.ts`
    - `parseStream(contract, lines)` as the only exported entry point — a call cannot exist without a family named at the call site
    - `ParsedStream<F>` discriminated union with `terminal` present only on the `complete` arm; `crashed` carries the expected terminal type and the outcome-unknown diagnostic
    - Line handling: skip non-`{` prefix lines silently, diagnose malformed lines with their one-based line number and continue, classify by `step` key first, last terminal-type event wins, unknown types retained, `coverage` payload exposed raw
    - Commit: "feat(core): family-gated NDJSON parser"
    - _Requirements: 3.1, 3.3, 3.6, 3.8, 3.9, 3.23, 3.24_

  - [ ] 2.10 Author the hand-written NDJSON and failure-yaml fixtures
    - `packages/kept-core/test/fixtures/`: `run-passed.ndjson` (copy-reference of the twelve-line `docs/kane/smoke-run.ndjson`), `run-failed-740.ndjson` (`run_end` with `result_code` as the string `"740"` plus a verdict object), `testrun-mixed.ndjson` (`testrun_plan` + one member of **each** of `passed`/`failed`/`broken`/`interrupted` + `testrun_summary` + `testrun_done`), `testrun-preflight-invalid.ndjson` (`valid: false`, one member per rejection reason), `testrun-crashed.ndjson` (truncated before `testrun_done`), `assurance-cover-done.ndjson`, `assurance-paused.ndjson` (`done` status `paused`, `exit_code` 3)
    - `assurance-cover-refused.ndjson` is the **verbatim two lines** of the verified no-context-store refusal envelope from design §5.3.1 — do not paraphrase them
    - `failure-*.yaml`: one per triage class of §6.3 — `failure-product-bug.yaml`, `failure-selector.yaml`, `failure-assertion.yaml`, `failure-unparseable.yaml`
    - Commit: "test(core): hand-authored NDJSON and failure.yaml fixtures"
    - _Requirements: 3.25, 6.7_

  - [ ] 2.11 Implement `test/arbitraries.ts`
    - Generators: `arbCitation` (over generated in-memory docs), `arbPromise`, `arbGraph`, `arbSnapshot` (always schema-valid, includes the empty graph), `arbKaneEvent`, `arbTerminalEvent(family)` (emitting `result_code` as number *or* string, credits as `credits_consumed` *or* `credits` *or* neither), `arbStream(family)`, `arbTruncatedStream(family)`, `arbVerdictObject`, `arbMemberStatus`, `arbFailureYaml`, `arbNoisyPrefix`, `arbMalformedLine`, `arbStoreSourceListing`
    - Named edge cases the generators must reach: empty graph; zero `*_test.md` files; `result_code` as `" 740"`; `credits_consumed` absent with `credits` present; a stream whose only line is `run_end`; a stream truncated at every index; a member status outside the four; a citation line exactly at EOF and exactly one past it; a cited line of only whitespace; CRLF endings; a doc with no trailing newline; `session_dir` absent from `run_end`
    - Commit: "test(core): shared fast-check generators and named edge cases"
    - _Requirements: 3.1, 3.13, 3.10_

  - [ ]* 2.12 Write property test for parser robustness
    - **Property 7: Parsing is robust and lossless per line**
    - **Validates: Requirements 3.1, 3.8, 3.9, 3.23, 3.24**

  - [ ]* 2.13 Write property test for terminal-event recognition and crash classification
    - **Property 8: Terminal-event recognition is family-determined and crash classification is exhaustive**
    - **Validates: Requirements 2.6, 2.7, 3.2, 3.6, 4.7, 5.2**

  - [ ]* 2.14 Write property test for faithful field exposure
    - **Property 13: Family-typed fields are exposed faithfully and `run_dir` is never read**
    - **Validates: Requirements 3.16, 3.17, 3.18, 3.21, 3.22**

  - [ ] 2.15 Write the pinned smoke-run regression test
    - Parse all twelve lines of the committed `docs/kane/smoke-run.ndjson` as an `ExecutionRun` stream; assert the `run_end` event is identified as terminal, that `resultCode()` reads both the top-level number `100` and the `per_flow_metadata[0]` string `"100"` to the same value, and that **zero** diagnostics are recorded
    - Not optional: this is the only proof the parser reads a real recorded stream
    - Commit: "test(core): pin the recorded smoke run as a parser regression"
    - _Requirements: 3.25_

  - [ ] 2.16 Write the `cover` refusal regression test
    - Parse `assurance-cover-refused.ndjson` as an Assurance stream; assert `kind: 'complete'` (a refusal is complete, not crashed), `terminal.status === 'refused'`, event `exit_code` 2 exposed separately from the process exit code, `exitMeaning === 'failure'`, and the resulting `degradedReason` string `assurance-status:refused` with Kane's `message` quoted verbatim in the diagnostic
    - Not optional: it is the regression that keeps a "no context store" state from reading as a crash
    - Commit: "test(core): cover refusal envelope regression"
    - _Requirements: 2.7, 2.8, 3.22_

  - [ ] 2.17 Implement `kane/evidence.ts`
    - `resolveEvidenceDir()` — `session_dir/evidence` for ExecutionRun (null when `session_dir` is absent), `<cwd>/.testmuai/evidence` for ExecutionTestrun, null for Assurance; no event field is ever consulted for a path
    - `listArtifacts()` newest pack by directory mtime, classifying `annotated`, `screenshot`, `har`, `console`, `log`, `failure-yaml`, `other` — unknown files listed, never dropped
    - Commit: "feat(core): family-derived evidence pack resolution"
    - _Requirements: 3.19_

  - [ ]* 2.18 Write property test for evidence resolution
    - **Property 14: Evidence-pack locations are resolved from the family, never from the event**
    - **Validates: Requirements 3.19, 4.13, 6.11**

  - [ ] 2.19 Implement `kane/failureYaml.ts`
    - `loadFailureYaml()` over the `yaml` package, returning null for absent or unparseable files; reads the four committed `failure-*.yaml` fixtures
    - Commit: "feat(core): failure.yaml loader"
    - _Requirements: 6.7_

  - [ ] 2.20 Implement `kane/invoker.ts`
    - `KaneInvoker.invoke()` resolves the binary once per process, asserts `familyForArgv(argv) === spec.family`, applies the contract's NDJSON enabler (`--agent` / nothing / `--mode agent`) and asserts `--agent` is absent for ExecutionTestrun
    - `stdio: ['ignore','pipe','pipe']` so `ask_user` self-disables — and record in a comment that this is exactly why any `context ingest` KEPT performs lands only and never extracts (§4.9.1); incremental line splitting with `onLine`; SIGTERM then SIGKILL at 2 s on timeout; last 50 stderr lines retained
    - Never throws for any Kane behaviour — absence, auth failure, refusal, crash and timeout are all data
    - Commit: "feat(core): KaneInvoker with per-family enabler and timeout kill"
    - _Requirements: 2.12, 3.4, 3.5, 11.8_

  - [ ] 2.21 Write the NDJSON-enabler and family-mismatch assertions
    - Assert against a stub spawn: ExecutionRun argv gains exactly `--agent`; ExecutionTestrun argv gains **nothing** and an `--agent` anywhere in it is rejected; Assurance argv gains `--mode agent`; a family/argv mismatch throws at development time; stdin is always `ignore`
    - Not optional — it is the per-command argv contract at the invoker seam, extended per KEPT command in 12.13
    - Commit: "test(core): per-family NDJSON enabler argv assertions"
    - _Requirements: 3.4, 3.5_

- [ ] 3. Promise model, providers, and the snapshot contract
  - [ ] 3.1 Implement `model/promise.ts` and `model/ids.ts`
    - `Verdict`, `Citation`, `DesignedTest`, `RepairAnnotation`, `PromiseRecord`, `PromiseGraph`, `GraphEdge`; `designedTest` is explicit null, never undefined
    - `normaliseClaim()` and `promiseId(citationFile, rawClaim)` keyed on file plus normalised claim only — never line number, never ordering; node id prefixes `d_`, `p_`, `t_`, `ev_`
    - Commit: "feat(core): promise model and line-independent id derivation"
    - _Requirements: 1.1, 1.2, 1.6_

  - [ ]* 3.2 Write property test for identifier stability
    - **Property 1: Promise identifiers are stable across rebuilds**
    - **Validates: Requirements 1.2**

  - [ ] 3.3 Implement the citation admission gate
    - `admitPromise()` as the single funnel: reject `no-citation` naming the supplying provider, reject `line-out-of-range` carrying requested line and actual count, reject `file-missing`
    - On admission, overwrite `citation.text` with the verbatim line read from disk; one-based indexing, no trimming, no phantom final line for a file ending in `\n`
    - Commit: "feat(core): citation admission gate"
    - _Requirements: 1.3, 1.4, 1.5_

  - [ ]* 3.4 Write property test for graph admission
    - **Property 2: Graph admission requires a resolvable citation**
    - **Validates: Requirements 1.3, 1.4, 1.5**

  - [ ] 3.5 Implement `providers/baseline.ts`
    - Scan `**/*_test.md` skipping `node_modules`, `.git`, `.next`, `dist`, `output-*`, `.testmuai`; 20-line hand-rolled frontmatter reader; `@verifies\s+(?<file>[^\s:]+):(?<line>\d+)` grammar with trailing free text ignored
    - Every path wrapped so `collect` resolves `ok: true` for every repository state including zero `*_test.md` files; never sets degraded
    - Commit: "feat(core): infallible baseline promise provider"
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 3.6 Write property test for baseline totality
    - **Property 5: The baseline provider is total**
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [ ] 3.7 Implement `providers/enrichment.ts` and `providers/coverage.ts`
    - Invoke `cover --json` under the Assurance family with a 60 s budget; accept enriched axes only on `complete` + `done` + `status: complete` + a `coverage` payload present
    - Map each failure observation to its specific `degradedReason` per design §5.3, including `assurance-status:refused` from the verified envelope; project the coverage payload tolerantly, keyed on `test_id` then normalised path, unmatched entries as diagnostics, zero projected entries as `coverage-payload-unreadable`
    - Commit: "feat(core): enrichment provider gated on the Assurance done event"
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9, 2.12_

  - [ ] 3.8 Implement `providers/merge.ts`
    - Baseline is sole citation authority; union by id preferring enrichment for `designedTest` and `verdict`; apply axis overlays; default missing designed test to `undesigned`; set `degraded` from enrichment; sort promises by id and edges by `(kind, from, to)`
    - Commit: "feat(core): canonical provider merge"
    - _Requirements: 1.7, 2.1, 5.5_

  - [ ]* 3.9 Write property test for merge precedence
    - **Property 4: Provider merge prefers enrichment on the assurance axes and baseline on citations**
    - **Validates: Requirements 1.7, 2.1**

  - [ ]* 3.10 Write property test for degradation
    - **Property 6: Degradation preserves state and never fails the build**
    - **Validates: Requirements 2.7, 2.8, 2.9, 2.10, 2.12**

  - [ ] 3.11 Implement `model/metrics.ts`
    - `computeMetrics()` producing total, designed, proven, red, stale and undesigned counts plus both coverage ratios; both ratios null with **no division performed** when total is zero; `provenCoverage` null when degraded
    - Commit: "feat(core): coverage metrics with zero-promise guard"
    - _Requirements: 5.8, 9.1, 9.2, 9.3_

  - [ ]* 3.12 Write property test for metric consistency
    - **Property 21: Metrics are arithmetically consistent and never divide by zero**
    - **Validates: Requirements 2.11, 5.8, 9.1, 9.2, 9.3**

  - [ ] 3.13 Implement `model/snapshot.ts` — the CLI↔UI seam schema
    - Full zod schema from design §9.1 with the `.superRefine` cross-field rules: count agreement, coverage nullability, evidence-reference resolution, edge endpoint resolution, freshness type/family consistency; violations name the offending path
    - Must exist and be green before anything in the Ledger reads a snapshot
    - Commit: "feat(core): ledger snapshot zod schema with cross-field refinements"
    - _Requirements: 8.8_

  - [ ] 3.14 Implement `model/canonical.ts`
    - `serialiseSnapshot()` with recursive sorted keys, 2-space indent, arrays pre-sorted by id, timestamps as strings only, no `Date` surviving into the structure; `parseSnapshot()` zod-parsing and throwing with a field path
    - Commit: "feat(core): canonical snapshot serialisation"
    - _Requirements: 1.8_

  - [ ]* 3.15 Write property test for snapshot round-tripping
    - **Property 3: Snapshot serialisation round-trips and is canonical**
    - **Validates: Requirements 1.8, 8.8**

  - [ ] 3.16 Implement `state.ts` — the single write guard
    - `mayWriteVerdicts(result)` true only for `stream.kind === 'complete'` with `exitMeaning ∈ {success, failure}`; `StateStore.applyRun` calls it first and returns state unchanged otherwise
    - Crashed, timed out, paused, force-interrupted, preflight-rejected and kane-not-found preserve prior verdicts and freshness by construction; untouched records are deep-frozen
    - Commit: "feat(core): state store with the single verdict write guard"
    - _Requirements: 2.10, 3.7, 5.3, 5.4_

  - [ ]* 3.17 Write property test for the write guard
    - **Property 9 (state clause): Verdicts and freshness move only on a proven outcome**
    - **Validates: Requirements 3.7, 5.3, 11.8, 11.9**

  - [ ] 3.18 Implement the CLI entry, `kept build`, and `kept snapshot`
    - Hand-rolled arg parsing (~40 lines, no commander); common flags `--repo`, `--json`, `--router`, `--member-debug`; every command exits 0 unless the CLI itself is broken or was given mutually exclusive flags (§13.2.3, wired in 12.7)
    - `kept build` runs both providers and writes `.kept/state.json`; `kept snapshot` writes `apps/ledger/data/ledger.snapshot.json` through `serialiseSnapshot`
    - Commit: "feat(cli): kept build and kept snapshot"
    - _Requirements: 2.10, 2.12, 4.14_

- [ ] 4. Checkpoint — core is honest
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Fixture application and designed-test corpus
  - [ ] 5.1 Build Kepler Coffee — 7 screens and state modules
    - Routes `/`, `/shop`, `/product/[slug]`, `/cart`, `/checkout`, `/orders`, `/settings`; `lib/catalog.ts` (six coffees), `lib/cart.ts` (`addItem`, `setQuantity`, `subtotal`), `lib/currency.ts`, `lib/storage.ts`
    - No API routes, no database, no `fetch`; all state in `localStorage`; `next dev -p 3100` / `next start -p 3100`; landing screen is static so it renders well inside 30 s
    - Commit: "feat(fixture): Kepler Coffee, seven screens on port 3100"
    - _Requirements: 12.1, 12.2, 12.3, 12.8_

  - [ ] 5.2 Author the README claims block
    - `apps/fixture/README.md` carrying exactly the eight verbatim one-line claims from design §12.2, one claim per line so a citation line number identifies exactly one claim
    - The subtotal claim is the breakable one; the 10-percent-discount claim is the never-true one and no discount logic is ever added
    - Commit: "docs(fixture): eight one-line promises, one breakable, one never true"
    - _Requirements: 12.4, 12.5, 12.6, 12.7_

  - [ ]* 5.3 Write property test for claim-to-promise correspondence
    - **Property 29: Fixture claims are one-to-one with promises**
    - **Validates: Requirements 12.4, 12.5**

  - [ ] 5.4 Write `tests/cart_subtotal_test.md` (T-3) — the spike's subject
    - Frontmatter `test_id`, `tags`, `covers: [apps/fixture/lib/cart.ts, apps/fixture/app/cart/**]`; body with `<!-- @verifies apps/fixture/README.md:16 -->` and the navigate/assert steps
    - This is the one authored test the verdict spike needs, so it lands before the rest of the corpus
    - Commit: "test(kane): cart subtotal test-md, the breakable promise"
    - _Requirements: 12.6, 4.3_

  - [ ] 5.5 Write the remaining seven `*_test.md` files
    - `home_cta`, `shop_filter`, `product_currency`, `checkout_validation`, `orders_persist`, `settings_currency`, and `cart_discount` (T-7, the docs-lie test that asserts the never-true claim)
    - Each with `covers:` globs and one `@verifies` tag citing its README line
    - Commit: "test(kane): complete the eight-test designed corpus"
    - _Requirements: 12.4, 12.7, 4.3_

  - [ ] 5.6 Rebuild the snapshot from the real fixture
    - Run `kept build && kept snapshot`; assert eight promises with verbatim citations into `apps/fixture/README.md` and commit the resulting `ledger.snapshot.json`
    - Expect `degraded: true` with `degradedReason: assurance-status:refused` at this point — there is no `.context/` store until stage 15.1, and that is the honest state
    - Commit: "chore: first snapshot with eight real cited promises"
    - _Requirements: 1.3, 2.2, 2.11, 4.14_

- [ ] 6. Verdict spike — front-loaded empirical confirmation **[LIVE KANE]**
  - [ ] 6.1 **[LIVE KANE]** Author T-3 against the running fixture and commit its recording
    - Start the fixture on 3100, author `tests/cart_subtotal_test.md` with `kane-cli`, capture the full NDJSON stream and the reported `credits_consumed`
    - Force-add the produced `output-*/` recording directory so later replays are free
    - Commit: "chore(kane): authored T-3 and committed its replay recording"
    - _Requirements: 13.6, 14.7_

  - [ ] 6.2 **[LIVE KANE]** Break the subtotal and replay T-3 from cache
    - Apply the one-line break in `apps/fixture/lib/cart.ts` (`subtotal` ignores quantity), replay T-3 with stdout piped, and capture the failing stream verbatim
    - Record whether the terminal event carries `result_code` 740 and whether an inline `verdict` object is present on a failing cached replay, and what `credits()` reports
    - Commit: "chore(kane): captured failing cached replay of T-3"
    - _Requirements: 4.6, 6.12, 12.6_

  - [ ] 6.3 **[LIVE KANE]** Record the spike outcome as a committed integration test and set the default router
    - Write `docs/kane/verdict-spike.md` with the invocation, the observed terminal event, the presence or absence of `result_code` 740 and the `verdict` object, and the resulting decision
    - Commit the captured stream as an integration-test input asserting the routed branch, and set `.kept/config.json` `verdictRouter` accordingly — the only thing in the repo the spike's outcome changes, fenced by the isolation scan in 11.5
    - Commit: "docs(kane): verdict spike outcome and selected default router"
    - _Requirements: 6.12, 6.13_

  - [ ] 6.4 Promote the captured streams into the committed fixture set
    - Replace the hand-authored `run-failed-740.ndjson` with the real capture where the observation supports it, and derive `testrun-mixed.ndjson`, `testrun-preflight-invalid.ndjson` and `testrun-crashed.ndjson` from the real stream shape; keep the hand-authored variant only where no real capture exists, annotated as synthetic
    - Re-run the parser and router suites against the promoted fixtures with no test edits — if a test needed editing, the fixture disagreed with reality and the code is what changes
    - Commit: "test(core): promote real captured Kane streams into the fixture set"
    - _Requirements: 3.25, 6.7_

- [ ] 7. Checkpoint — the spike's answer is recorded
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Ledger visual foundation — tokens, light, and enforcement before components (§19 stage 5, §18.2)
  - [ ] 8.1 Author `styles/tokens.css` and the typed mirror `lib/tokens.ts`
    - The full token set of design §10.4.1 verbatim: warm desaturated ink ramp `--ink-000` `#14120F` → `--ink-050` `#1B1815` → `--ink-100` `#221E1A` → `--ink-150` `#2A251F`; `--hairline`/`--hairline-strong`; light tokens `--light-edge`, `--light-edge-strong`, `--light-wash`, `--occlude`; text ramp `#F2EDE4` / `#B6ADA0` / `#9A9184`
    - Oxidised verdict hues as the only chromatic channel: patina `#6FB894` proven, ochre `#D9A64A` stale, clay `#D97A66` red, stone-sage `#9A9184` undesigned, plus the four low-alpha `--wash-*` tokens and the single `--focus` `#7FA6BC`
    - Motion tokens (`--dur-micro` 90ms → `--dur-figure` 760ms, `--stagger-node` 24ms, the three cubic-bezier eases), the eight-step type scale, line heights, tracking, 4-based spacing, three radii, system font stacks
    - `lib/tokens.ts` exports `TOKENS` as literals and `CONTRAST_PAIRS` with each pair's role `body` | `node-label` | `non-text`
    - Commit: "feat(ledger): warm ink palette, oxidised verdict hues, motion and type tokens"
    - _Requirements: 10.1, 10.2, 10.3, 10.6_

  - [ ] 8.2 Author `styles/surfaces.css` — the light and elevation system
    - One implied source above and 15° off vertical: 1px `inset` top-edge highlight per level, two stacked occlusion shadows (tight contact + wide ambient) in warm near-black `--occlude` only, `linear-gradient(176deg, var(--light-wash), transparent 62%)` plane wash at 2.8% amplitude, inverted ramp for wells (inset top shadow, `--light-edge` on the bottom)
    - Exactly three classes — `.surface-raised`, `.surface-raised-2`, `.surface-well` — and they are the **only** way a component authors depth; `--elev-3` declared but unused
    - Commit: "feat(ledger): light, occlusion and elevation as three surface classes"
    - _Requirements: 10.1, 10.6_

  - [ ] 8.3 Write the visual enforcement trio (source scan 6 of 6 included)
    - **Contrast** over the whole ramp: compute the WCAG ratio for every `CONTRAST_PAIRS` entry on all four ink surfaces plus the badge's inverted pairs, requiring ≥4.5 for `body`, ≥3 for `node-label`, and asserting the lowest measured ratio in the matrix is 4.89:1 (`--text-200`/`--verdict-undesigned` on `--ink-150`)
    - **Parity** both directions: every `--custom-property` in `tokens.css` has an identical-valued `TOKENS` entry and vice versa, so a palette edit cannot drift the test's input away from the browser's
    - **Forbidden-palette scan**: fails on `backdrop-filter`, any hex whose computed saturation exceeds 70%, a `linear-gradient` mixing more than two hue families, a `box-shadow` whose colour is not `--occlude` or a `--light-edge*` token, an inline `box-shadow` outside `surfaces.css`, and any emoji codepoint under `apps/ledger/**`
    - None of the three is optional (§18.2) — without them the palette silently rots
    - Commit: "test(ledger): contrast over the whole ramp, token parity, forbidden palette"
    - _Requirements: 10.2, 10.3, 10.6_

  - [ ] 8.4 Write the typography discipline scan (source scan 5 of 6)
    - Mono-as-texture rule: enumerate mono-classed elements across `apps/ledger/components/**` and fail on any whose text content is a sentence (a space-separated run of four or more non-identifier words); mono is permitted only for promise ids, `path:line` citations, test ids, `result_code`/`reason_code`, credit figures, ISO timestamps, member statuses, diff bodies and metric numerals
    - Assert `font-variant-numeric: tabular-nums lining-nums` is present wherever a number animates or aligns — `MetricFigure`, the credits column, run durations, the diff gutter
    - Assert the `--wash-*` tokens are never applied behind text, cross-checking the exclusion Property 22 relies on rather than trusting it
    - Commit: "test(ledger): mono-as-texture and tabular-numeral typography scan"
    - _Requirements: 10.1, 10.6_

  - [ ] 8.5 Build the app shell with the reduced-motion state
    - `app/layout.tsx` importing `tokens.css` then `surfaces.css`, ink background, system font stack, skip link as the first focusable element, page max width 1680px and no `min-width` anywhere
    - The `@media (prefers-reduced-motion: reduce)` block from §10.6.4 as CSS-level insurance: zero durations, `animation-iteration-count: 1`, `scroll-behavior: auto`
    - Commit: "feat(ledger): app shell, skip link, reduced-motion CSS insurance"
    - _Requirements: 10.1, 10.7, 10.4_

  - [ ] 8.6 Write the widened CSS motion scan
    - Assert the reduced-motion block exists; that every `transition` and `animation` declaration under `apps/ledger/**` targets only `opacity`, `transform`, `color`, `background-color`, `border-color`, `outline-color` or `box-shadow`; that no declaration animates `width`, `height`, `top` or `left`; and that no `animation-iteration-count` exceeds 1
    - Also fails on hover bounce/scale, skeleton shimmer, parallax, scroll-driven motion and any ambient loop
    - Not optional — it is the guard that keeps stage 17 honest before stage 17 exists
    - Commit: "test(ledger): widened CSS motion scan"
    - _Requirements: 10.4_

  - [ ] 8.7 Implement the optical alignment of the metric rail
    - `%` set at `--fs-lg` with `vertical-align: baseline` and `-0.06em` right margin so the digits, not the glyph run, align to each tile's optical left edge; `n/a` set at `--fs-lg` and baseline-aligned to the digits it replaces so a degraded rail keeps the rail's rhythm; tile labels on the shared 4px baseline grid
    - Commit: "feat(ledger): optically aligned metric rail figures and n/a"
    - _Requirements: 9.3, 10.1_

- [ ] 9. Ledger projection — components and routes
  - [ ] 9.1 Implement build-time snapshot loading
    - `lib/snapshot.ts` importing `data/ledger.snapshot.json` and running `parseSnapshot`, so an absent or invalid snapshot fails the build with a message naming the field path; zero Kane invocations
    - Commit: "feat(ledger): schema-validated build-time snapshot load"
    - _Requirements: 8.6, 8.8_

  - [ ] 9.2 Implement `lib/layout.ts` and `lib/relativeTime.ts`
    - Deterministic lane layout (documents 0, promises 1, tests 2, evidence 3; `LANE_X = [0,360,760,1080]`, `ROW_H = 92`; rows sorted by verdict rank then id so red sorts to the top) as a pure function of the snapshot — no dagre, no physics, no jitter between screenshots
    - Relative-time formatter over ISO 8601 strings with a strict `> 24h` ochre boundary and a `never verified` state for null
    - Commit: "feat(ledger): deterministic lane layout and relative time"
    - _Requirements: 9.6, 9.7, 10.8_

  - [ ]* 9.3 Write property test for freshness rendering
    - **Property 24: Freshness rendering is monotone with a hard 24-hour threshold**
    - **Validates: Requirements 9.6, 9.7**

  - [ ] 9.4 Build `MetricRail`, `MetricFigure`, `FreshnessChip`, `DegradedChip`, `VerdictTag`
    - `VerdictTag` always renders the word `proven`/`red`/`stale`/`undesigned` beside its colour; `undesigned` uses the neutral stone-sage token; tag borders may carry a `--wash-*` at 1px and nothing else
    - When `degraded`, the Proven Coverage tile is **replaced** by the `baseline data only` chip at the tile's exact footprint rather than showing a number; `totalPromises === 0` renders the literal `n/a`
    - `MetricFigure` renders its final value directly for now and carries the final value in its accessible name from first paint — the count-up in 17.7 is layered on later and must not change this DOM
    - Commit: "feat(ledger): metric rail, verdict tags, degraded and freshness chips"
    - _Requirements: 2.11, 9.1, 9.2, 9.3, 10.2, 10.3, 10.5_

  - [ ]* 9.5 Write property test for verdict presentation and contrast
    - **Property 22 (presentation and contrast clauses): Verdict presentation always pairs colour with a word, at accessible contrast on every surface of the elevation ramp**
    - **Validates: Requirements 10.2, 10.3, 10.5, 10.6**

  - [ ] 9.6 Build `PromiseGraph`, `PromiseNode`, `PromisePanel`
    - React Flow used for panning, zooming, edges and viewport only; node is 320×76 on `.surface-raised` with an id chip, claim clamped to 2 lines (full text in `title`), `path:line` citation and verdict tag, and a 3px verdict-wash left edge
    - Panel (440px, `.surface-raised-2`) opens on selection or `?p=<id>` with the verbatim cited text in a `.surface-well` citation well, designed test, verdict, repair annotation and evidence artefact links
    - Keyboard model from §10.8: graph as `role="application"` with a visible focus ring, arrow keys in lane order, `Enter`/`Space` to select, `Escape` to close and restore focus, plus the always-present parallel `role="list"` sidebar; no horizontal overflow between 1280 and 1920 px
    - Commit: "feat(ledger): promise graph hero, node, and detail panel"
    - _Requirements: 8.1, 8.2, 8.3, 10.7, 10.8_

  - [ ]* 9.7 Write property test for projection completeness
    - **Property 23: Every promise is reachable, selectable and evidenced in the projection**
    - **Validates: Requirements 7.5, 8.1, 8.2, 8.3, 10.7**

  - [ ] 9.8 Build `/coverage` and `/runs`
    - `/coverage` is the shareable unauthenticated page: both coverage figures, freshness, every promise with its verdict
    - `/runs` renders `snapshot.runs[]`: family, command, status, coerced result code, credits, exit meaning, and the honest failure vocabulary — `outcome unknown`, `paused, resumable`, `timed out`, preflight reasons, `reconcile-source-unresolved` with Kane's suggested `context ingest` command quoted, `reconcile-source-forked` with both conflicting source ids, and the refusal message quoted verbatim
    - Commit: "feat(ledger): public coverage page and terminal-event run log"
    - _Requirements: 9.8, 4.9, 4.11, 5.3_

  - [ ] 9.9 Build `/badge.svg`
    - `route.ts` exporting **GET only** with `dynamic = 'force-static'`, `content-type: image/svg+xml`, hand-written flat 110×20 SVG, proven coverage as a whole-number percentage or `n/a`, verdict fill by band with `--ink-000` text
    - Commit: "feat(ledger): GET-only proven-coverage badge"
    - _Requirements: 9.4, 9.5_

  - [ ]* 9.10 Write property test for the badge
    - **Property 25: The badge is valid SVG reporting a whole-number percentage**
    - **Validates: Requirements 9.4, 9.5**

  - [ ] 9.11 Implement `scripts/demo.mjs`
    - Zero-dependency spawner for `next dev -p 3100` in `apps/fixture` and `next dev -p 3000` in `apps/ledger`, prefixed output forwarding, both URLs printed, children killed on SIGINT, zero Kane spawns
    - Commit: "feat: npm run demo boots both apps with zero dependencies"
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ] 9.12 Write the Ledger read-only source scan (source scan 2 of 6)
    - `scripts/check-readonly.mjs` plus its test wrapper: fail if `apps/ledger` contains any non-GET route handler, server action, `middleware.ts`, auth reference, `child_process`/`exec` import, or the string `kane`
    - Wired into both `npm test` and `npm run check` so the read-only guarantee is checked on every run and every build
    - Commit: "test: source scan for the ledger read-only guarantee"
    - _Requirements: 8.4, 8.5, 8.6_

- [ ] 10. Checkpoint — first screenshot-worthy state
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Verdict router, blast radius, and `kept verify`
  - [ ] 11.1 Implement `verdict/router.ts` and `verdict/memberStatus.ts`
    - `RepairBranch`, `VerdictObject`, `FailureContext` (with lazy `loadFailureYaml`), `RoutedRepair`, `VerdictRouter`, `selectRouter(cfg)` falling back to `resultCode740` with a diagnostic on an unknown value
    - `memberStatusToVerdict` total: `passed→proven`, `failed`/`broken→red`, `interrupted→stale`, unknown→`stale` flagged unknown; only `failed` and `broken` enter the router
    - Commit: "feat(core): verdict router strategy interface and member status mapping"
    - _Requirements: 4.8, 6.1, 6.10_

  - [ ]* 11.2 Write property test for member status mapping
    - **Property 15: Member status maps totally onto four verdicts**
    - **Validates: Requirements 3.20, 4.8, 4.9**

  - [ ] 11.3 Implement `verdict/resultCode740.ts`
    - Rule order from design §6.2: the verdict object outranks the numeric code; `confirmed: false → test-drift`, `confirmed: true → code-break`, no object with coerced 740 → `code-break`, no object with a code in 700..799 or any other failing code → delegate to `failureYamlTriage`, residue → `docs-lie`
    - Surface `severity`, `category`, `confidence` and a real `evidenceRef` (resolved `failure.yaml`, else the pack directory, else null) — never a fabricated path
    - Commit: "feat(core): resultCode740 verdict router"
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.8, 6.11_

  - [ ] 11.4 Implement `verdict/failureYamlTriage.ts`
    - Read a category-ish field (`triage.category` | `category` | `classification` | `reason`) from the newest pack's `failure.yaml` and map per design §6.3, with `assertion`-class signals plus a coerced `result_code` in 700..799 → `docs-lie` and absent/unparseable/unrecognised → `docs-lie`
    - Ships working regardless of the spike outcome (R6.13); tested against all four committed `failure-*.yaml` fixtures
    - Commit: "feat(core): failureYamlTriage fallback router"
    - _Requirements: 6.7, 6.13_

  - [ ] 11.5 Write the router-isolation source scan (source scan 3 of 6)
    - Fail if anything outside `packages/kept-core/src/verdict/` imports a concrete router implementation, so the spike outcome can only ever change one config string
    - Commit: "test(core): forbid concrete router imports outside src/verdict"
    - _Requirements: 6.10, 6.14_

  - [ ]* 11.6 Write property test for verdict-object precedence
    - **Property 18: The verdict object outranks the result code**
    - **Validates: Requirements 6.3, 6.4, 6.5, 6.6**

  - [ ]* 11.7 Write property test for router totality and strategy isolation
    - **Property 17: The verdict router is total, deterministic and strategy-isolated**
    - **Validates: Requirements 6.1, 6.2, 6.7, 6.9, 6.10, 6.13, 6.14**

  - [ ] 11.8 Implement `radius/plan.ts`
    - `readPlan()` over `.kept/plan.json` refreshing via `kane-cli testrun run --dry-run` (ExecutionTestrun, piped stdout, no `--agent`, 60 s) when missing, older than 10 minutes, or older than any `*_test.md` mtime
    - Only `testrun_plan` is consumed but the stream must still reach `testrun_done` to be trusted; a `--dry-run` stream that crashes leaves the previous cache in place
    - Commit: "feat(core): testrun plan cache with dry-run refresh"
    - _Requirements: 4.4_

  - [ ] 11.9 Implement `radius/radius.ts`
    - 30-line `*`/`**` glob matcher over repo-relative POSIX paths (no micromatch); changed paths → covering tests → promises → `test_id` values taken **only** from `testrun_plan.members[]`
    - Members without a `test_id` are excluded and diagnosed; empty radius means zero Kane invocations plus one diagnostic per uncovered path
    - Commit: "feat(core): blast radius from plan identifiers only"
    - _Requirements: 4.2, 4.3, 4.5_

  - [ ]* 11.10 Write property test for blast-radius identifier provenance
    - **Property 16: Blast-radius identifiers come only from the plan**
    - **Validates: Requirements 4.3, 4.4, 4.5**

  - [ ] 11.11 Implement `kept verify --changed` / `--all`
    - Invoke `kane-cli testrun run --from-context <ids> --on-failure continue` with stdout piped and a 300 s budget; consume `testrun_plan` (treating `valid: false` as preflight rejection carrying each member's reason), then `testrun_member_end`, then require `testrun_done`
    - Resolve evidence from `<cwd>/.testmuai/evidence/`, route `failed`/`broken` members, write verdicts only for promises in the radius, record `broken`/`interrupted` verbatim in diagnostics, then write state, handoff and snapshot
    - Commit: "feat(cli): kept verify with blast-radius replay"
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.13, 4.14, 4.15, 11.9_

  - [ ]* 11.12 Write property test for out-of-radius preservation
    - **Property 9 (radius clause): every promise outside the blast radius is byte-identical before and after, including verdict source and freshness**
    - **Validates: Requirements 4.10, 4.15**

- [ ] 12. Source resolution, `kept reconcile`, hooks, and the handoff contract
  - [ ] 12.1 Implement `context/sources.ts` — types and the four-rung match ladder
    - `StoreSource { sourceId, path, absPath, digest, retired, raw }` and the `SourceResolution` discriminated union: `{ ok: true, source, via }` over `cache | exact-path | abs-path | digest | unique-basename`, or `{ ok: false, reason, diagnostic }` over `no-store | listing-unreadable | crashed-stream | no-match | ambiguous | retired`
    - `resolveSourceId()` walks the ladder first-hit-wins with **no fuzzy matching at any rung**: exact repo-relative POSIX path → absolute path resolved against `repoRoot` → sha256 of the file's current bytes against the recorded digest → basename equality with exactly one candidate
    - Two or more candidates tying at one rung is `ambiguous`, never a guess; titles, use-case names and ordinal position are never consulted; a matched-but-retired entry resolves to `retired` rather than being handed to Kane
    - Commit: "feat(core): source-id resolution with a four-rung match ladder"
    - _Requirements: 5.1, 5.2_

  - [ ] 12.2 Implement the tolerant projection of `context list --type source --json`
    - Invoke `kane-cli context list --type source --json` under the Assurance family (invoker appends `--mode agent`) with a 60 s budget, gated on the terminal `done`
    - Project exactly as tolerantly as the coverage payload (§5.3): walk for any array of objects and accept an entry carrying `source_id | id | sourceId`, optionally `path | file | uri | source_path`, `digest | sha256 | hash | content_hash`, and `retired | status`; keep the unprojected entry in `raw` for diagnostics
    - A crashed or unreadable listing is `crashed-stream` / `listing-unreadable`, never an exception
    - Commit: "feat(core): tolerant projection of the Kane source listing"
    - _Requirements: 5.2_

  - [ ] 12.3 Implement the `.kept/sources.json` read-through cache
    - `{ schemaVersion, refreshedAt, listingSignature, sources[], byPath{} }` beside `plan.json` and `state.json`; `listingSignature` is a hash of the projected listing so store churn is detected
    - A `byPath` hit is honoured only when younger than `maxAgeMs` (default 10 minutes) **and** the cited file's mtime is not newer than `resolvedAt`; otherwise refresh
    - A refresh whose stream crashes **leaves the previous cache in place and the previous entry is still honoured** — a transient Kane hiccup must not turn a working docs branch into a no-op
    - Commit: "feat(core): sources.json read-through cache with listing signature"
    - _Requirements: 5.2_

  - [ ] 12.4 Author the `context-list-sources.ndjson` fixture
    - One committed Assurance listing stream terminating in `done` carrying four deliberately shaped entries: an exact-path match, a digest-only match with no path field, a retired entry, and a duplicate pair where one file backs two live sources (the fork-guard case)
    - Commit: "test(core): source listing fixture covering all four ladder rungs"
    - _Requirements: 5.2_

  - [ ] 12.5 Write the source-resolution ladder tests
    - One case per rung asserting the reported `via`, plus one case each for `no-match`, `ambiguous`, `retired` and the fork guard
    - Every failure rung asserts **zero spawns of `kane-cli maintain reconcile`**, zero verdict movement, zero freshness movement, `degraded` still false, a handoff written with `branch: null`, and CLI exit 0
    - Also asserts the cache-crash case still honours the previous entry, and that the fork-guard diagnostic `reconcile-source-forked` names **both** conflicting source ids
    - Not optional — this is the structural test for the branch that was previously dead
    - Commit: "test(core): source-resolution ladder, no-spawn failure rungs, fork guard"
    - _Requirements: 5.1, 5.2, 5.3, 5.7_

  - [ ] 12.6 Implement `kept reconcile --changed <paths>`
    - Filter the hook's saved paths to the Docs_Hook pattern set, normalise to repo-relative POSIX, and issue **one invocation per changed doc, sequentially**, each with its own resolved source id; zero changed docs after filtering → no invocation, one diagnostic, exit 0
    - Final argv is `maintain reconcile --from <changedDoc> --source-id <resolvedId> --plan --mode agent` — `--from` and `--source-id` are both mandatory and `--source-id` can only be built from the `ok: true` arm of `SourceResolution`, so an unresolved source is structurally a no-op rather than an exit-2 spawn
    - Mirror locally the seven-row fail-fast ladder of §13.2.4 before spawning: `--from` present, `--source-id` resolved, `--from` exists (`fs.stat`), extension on the ingestable allow-list, source id known, source not retired, and the **fork guard** — a second non-retired listing entry whose path or digest matches `--from` while its id differs
    - Implement the six-step no-match path exactly: diagnostic `reconcile-source-unresolved` quoting the `kane-cli context ingest <file>` remedy, **no spawn at all**, no review card, verdicts and freshness unchanged, handoff with `nextAction.branch: null`, exit 0 — and `degraded` stays **false**, because no proven data was lost
    - Gate the graph rebuild on the terminal `done`; record the head-move that lands even under `--plan` in the run diagnostics; treat `paused` + exit 3 as resumable with nothing changed
    - Commit: "feat(cli): kept reconcile with resolved --from/--source-id and fail-fast ladder"
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [ ] 12.7 Implement `kept reconcile apply [planPath]` and the mutually-exclusive-flag rejection
    - Human-only command, never invoked by a hook and absent from both hook prompts: `maintain reconcile --apply [planPath] --mode agent`, bare walks the latest stored plan behind Kane's approval prompt, a path selects one
    - `--plan` together with `--apply` is rejected in KEPT's own arg parser **before any spawn**, with a usage message and **exit 2** — document in the command's header comment that this is the only case `kept` itself exits non-zero
    - Commit: "feat(cli): human-only reconcile apply, plus arg-parser rejection of --plan with --apply"
    - _Requirements: 5.7, 2.10_

  - [ ] 12.8 Implement `handoff/handoff.ts`
    - `HandoffFile` type and `writeHandoff()` producing `.kept/handoff.json` plus an immutable `.kept/handoff/<runId>.json`, written for **every** run including crashed, paused, preflight-rejected and source-unresolved ones with `nextAction.branch: null` and populated diagnostics
    - On `code-break`, `allowedPaths` contains only fixture source globs and `forbiddenPaths` includes fixture docs, `tests/**`, `apps/ledger/**` and `packages/**`
    - Commit: "feat(core): handoff file, the closed-loop contract"
    - _Requirements: 11.4, 11.7, 7.1_

  - [ ]* 12.9 Write property test for handoff completeness and fencing
    - **Property 26: The handoff file is complete for every run and fences the agent by branch**
    - **Validates: Requirements 7.1, 11.4**

  - [ ] 12.10 Write the two Kiro hook files
    - `.kiro/hooks/kept-code-verify.json` (`fileEdited` over fixture source globs) with the branch-fenced agent prompt of §11.1
    - `.kiro/hooks/kept-docs-reconcile.json` (`fileEdited` over `apps/fixture/README.md` and `apps/fixture/docs/**/*.md`) with the amended prompt: it runs `kept reconcile --changed <paths>`, states that the CLI resolves the source id itself and passes `--from`/`--source-id`, forbids inventing or passing a source id, forbids `kept reconcile apply`, and instructs the agent to quote the suggested `context ingest` command on `reconcile-source-unresolved` and change nothing
    - Commit: "feat(hooks): code-verify and docs-reconcile with fenced agent prompts"
    - _Requirements: 11.1, 11.2, 11.3, 11.5_

  - [ ] 12.11 Write the hook-schema validation test
    - Assert both hook files parse and conform to the Kiro hook JSON schema — `enabled`, `name`, `description`, `version`, `when.type === 'fileEdited'`, non-empty `when.patterns`, `then.type === 'askAgent'`, non-empty `then.prompt`
    - Additionally assert the docs prompt contains no literal `src_` string and no `--apply`, so a hardcoded source id or an apply invocation cannot creep into the prompt
    - Commit: "test(hooks): hook schema validation and prompt content guards"
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ]* 12.12 Write property test for hook pattern partitioning
    - **Property 27: Hook file patterns partition fixture edits**
    - **Validates: Requirements 11.2, 11.3**

  - [ ] 12.13 Write the per-command argv assertion suite
    - Against a recording stub spawn, assert the exact final argv of every Kane-invoking KEPT command: `kept build` → `cover --json --mode agent`; plan refresh → `testrun run --dry-run` with no `--agent`; `kept verify --changed` → `testrun run --from-context <ids> --on-failure continue`; `kept verify --all` → `testrun run --on-failure continue`; `kept evolve` → `maintain evolve <ref> --mode agent`; `kept doctor` → `--version`
    - `kept reconcile --changed` explicitly asserts: both `--from` and `--source-id` are present, `--plan` is present, `--apply` is **never** present alongside `--plan`, one invocation per changed doc, and **zero spawns** when the source id is unresolved
    - Not optional — the argv is the contract with Kane and a silently wrong flag is a silently dead branch
    - Commit: "test(cli): per-command argv assertions including reconcile's mandatory flags"
    - _Requirements: 3.4, 3.5, 4.2, 5.2, 7.2_

- [ ] 13. Checkpoint — the loop is wired
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Repair surfaces
  - [ ] 14.1 Implement `repair/reviewCard.ts`
    - `.kept/review-cards/<id>.json` with id, `createdAt`, `kind` (`test-drift` | `reconcile`), promise id, branch, title, detail, `proposedChanges[]`, `evidenceRef`, strategy and `status`
    - Reconcile mirrors Kane's own `--plan`-staged items into cards rather than reimplementing holding on top of Kane; nothing is ever applied
    - Commit: "feat(core): review cards mirroring Kane's staged plan items"
    - _Requirements: 5.7, 7.7_

  - [ ] 14.2 Implement `kept evolve` with the `--mode agent` probe
    - One-time `kane-cli maintain evolve --help` probe cached per process; if the flag is unsupported, skip the invocation, build a `test-drift` review card from the failure context alone, and record the flag-mismatch diagnostic
    - Commit: "feat(cli): kept evolve with documented flag-probe degradation"
    - _Requirements: 7.2_

  - [ ]* 14.3 Write property test for held-change discipline
    - **Property 20: Reconciliation and evolution only ever produce held review cards**
    - **Validates: Requirements 5.5, 5.6, 5.7, 7.2, 7.7**

  - [ ] 14.4 Implement `repair/docsAmendment.ts` and `repair/lineEdit.ts`
    - `propose()` writes **only** under `.kept/`, carrying current text, proposed text, `expectedSha256`, rationale, evidence ref and artefacts; `amendmentId` derived from promise id plus proposed text so re-proposal is idempotent
    - `accept()` guards the sha256 interlock (mismatch → `stale`, exit 0, no write), mutates exactly one array element, writes to `<file>.kept-tmp` and renames atomically preserving line endings and trailing-newline state, then rebuilds the graph and rewrites the snapshot; `reject()` touches nothing else
    - Commit: "feat(core): docs amendments with sha256 staleness interlock"
    - _Requirements: 7.3, 7.4, 7.6_

  - [ ]* 14.5 Write property test for amendment write discipline
    - **Property 19: A documentation amendment writes nothing until accepted, then edits exactly one line**
    - **Validates: Requirements 7.3, 7.4, 7.6**

  - [ ] 14.6 Build `/amendments`, `/reviews`, and the diff renderer
    - `lib/diff.ts` ~60-line line-level unified diff (LCS over ≤200 lines, no Shiki); `DiffView` in mono on `.surface-well` so the diff reads as cut into the card, clay deletions, patina additions, `--text-200` gutter numbers with tabular numerals, and `--wash-*` only on each row's left 3px edge
    - `AcceptControl` is a native keyboard-focusable button with the accessible name `Accept amendment <id> for README line <n>`, copying `kept amend accept <id>` and revealing the command inline — the Ledger still exposes no non-GET handler
    - `/reviews` renders each card with its promise id, repair branch and evidence reference
    - Commit: "feat(ledger): amendment diffs, accept control, review cards"
    - _Requirements: 7.5, 7.7, 10.7_

- [ ] 15. Live Kane — bootstrap, recorded integration runs, and the closed loop **[LIVE KANE]**
  - [ ] 15.1 **[LIVE KANE]** Bootstrap the context store as two explicit commands
    - `kane-cli context ingest apps/fixture/README.md --mode ci` — **lands only**, because a piped/headless stdin never extracts (§4.9.1); an ingest that appears to do nothing has in fact succeeded
    - Then `kane-cli context extract --mode agent` (Assurance, terminates `done`), then `kane-cli design tests --use-case <ref> --mode agent`
    - Record both streams under `docs/kane/`; this pair is the precondition for `cover` returning anything but `refused` and for `resolveSourceId` finding a match at all
    - Commit: "chore(kane): bootstrap context store with explicit ingest then extract"
    - _Requirements: 2.5, 5.2_

  - [ ] 15.2 **[LIVE KANE]** Author the remaining seven tests and commit their recordings
    - Author each `*_test.md` against the running fixture; force-add every produced `output-*/` directory so all later replays are free
    - Commit: "chore(kane): authored the full corpus and committed replay recordings"
    - _Requirements: 13.6_

  - [ ] 15.3 **[LIVE KANE]** Integration test — zero-credit replay of the full suite
    - Run `npm run loop` (`kept verify --all --member-debug`) entirely from cached recordings; capture what `credits()` actually reports rather than asserting 0 a priori, and commit the run entry and stream
    - Commit: "test(integration): recorded zero-credit replay of the full suite"
    - _Requirements: 4.6, 14.7_

  - [ ] 15.4 **[LIVE KANE]** Integration test — `maintain reconcile --plan` with a real resolved source id
    - Edit `apps/fixture/README.md`, let `kept reconcile --changed` resolve the id against the live store, and assert the recorded argv carries the resolved `--from`/`--source-id`/`--plan`, that the stream reaches `done`, that the head move is recorded in diagnostics, and that every produced change landed as a held review card
    - Also record the negative case once: with the source retired or absent, assert zero spawns and zero verdict movement against the live CLI
    - Commit: "test(integration): recorded reconcile --plan against a live resolved source"
    - _Requirements: 5.2, 5.7_

  - [ ] 15.5 **[LIVE KANE]** Drive the docs-lie branch on T-7
    - Replay `tests/cart_discount_test.md` against the correctly-behaving fixture so the assertion fails with the selector resolving; confirm the router returns `docs-lie` and `kept amend propose` produces the amendment replacing the never-true discount claim
    - Commit: "chore(kane): docs-lie branch fires on the never-true discount claim"
    - _Requirements: 7.3, 12.7_

  - [ ] 15.6 **[LIVE KANE]** Integration test — one full closed loop, persisted
    - Break `apps/fixture/lib/cart.ts`, let the code hook verify (red, `code-break`), let the agent patch from the handoff, let the save re-fire the hook, land on `proven`
    - Commit both `.kept/handoff/<runId>.json` files, the intervening patch, and the snapshot showing both terminal events on `/runs`
    - Commit: "test(integration): persisted closed-loop record, red to proven"
    - _Requirements: 11.5, 11.6, 11.7_

  - [ ] 15.7 Curate and commit the evidence packs
    - `kept snapshot` copies referenced packs into `apps/ledger/public/evidence/<packId>/` and rewrites `publicPath` values; commit the curated packs including `annotated.png` and the per-step screenshots so artefact links are plain static URLs
    - Commit: "chore(evidence): commit curated packs for the credential-free judge path"
    - _Requirements: 13.4, 13.5_

  - [ ] 15.8 Write the committed-evidence referential integrity test
    - Assert every snapshot evidence pack id, artefact `publicPath` and `repair.evidenceRef` resolves to a file committed in the repository, and that every committed curated pack is referenced by at least one promise, run or amendment
    - Not optional — a dangling evidence link is the one broken thing a judge will click
    - Commit: "test: referential integrity of committed evidence and the snapshot"
    - _Requirements: 13.4, 13.5_

  - [ ]* 15.9 Write property test for evidence referential closure
    - **Property 28: Committed evidence and the snapshot are referentially closed**
    - **Validates: Requirements 13.4, 13.5**

  - [ ] 15.10 Record the measured credit consumption
    - `docs/kane/credits.md` with the `credits_consumed` figure read from a real authored run's terminal event alongside the replay measurement, each with its run id and full invocation
    - Commit: "docs(kane): measured credits_consumed for authoring and replay"
    - _Requirements: 14.7_

- [ ] 16. Checkpoint — Verified dimension is real
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Motion layer — gate first, then M5 → M1 (§19 stage 10, §18.1)
  - [ ] 17.1 Implement `apps/ledger/lib/motion.ts` — the only `animejs` entry point
    - Named imports only: `import { animate, createTimeline, stagger, svg, utils, eases } from 'animejs'`
    - `MotionSpec { to, run }`, `motionEnabled()`, and `play(targets, spec)` — when motion is off it applies `spec.to` synchronously via `utils.set` and resolves immediately, so the end state is the first painted state
    - Observe the media query live with `addEventListener('change')`; on a switch to reduced motion, **complete** in-flight timelines rather than cancelling them, because cancelling leaves the DOM mid-way, which is exactly what is being prevented
    - Commit: "feat(ledger): motion gate with a synchronous reduced-motion branch"
    - _Requirements: 10.4_

  - [ ] 17.2 Write the `animejs` import-shape and location scan (source scan 4 of 6)
    - Fails on a default import (`import anime from 'animejs'`), on any deep `animejs/lib/*` path, and on any `animejs` import outside `apps/ledger/lib/motion.ts` and `apps/ledger/components/**`
    - Also asserts `package.json` pins `animejs` to the exact string `4.5.0` and that the runtime dependency count is exactly nine
    - Commit: "test(ledger): animejs import shape, import location, exact pin"
    - _Requirements: 10.4_

  - [ ] 17.3 Write the reduced-motion equivalence test
    - Render `/` under jsdom with `prefers-reduced-motion: reduce` and again with motion enabled after all timelines complete; compare **every animated declaration** — node opacity, node transform, verdict tag colour and scale, panel offset, edge draw progress, metric figure text
    - Assert the metric figure's accessible name is the final value from first paint in both states, so a screen reader is never read an intermediate number
    - **Property 22 (reduced-motion clause)** — not droppable under any timebox pressure (§18.2); it must be green before any flourish below is added
    - Commit: "test(ledger): reduced-motion equivalence across every animated declaration"
    - _Requirements: 10.4, 10.6_

  - [ ] 17.4 Implement M5 — verdict flip pulse
    - One timeline: tag colour `--verdict-*` → `--verdict-*`, tag scale `1 → 1.06 → 1`, node left-edge wash cross-fade, at `--dur-slow` on `--ease-emphasis`; routed through `play()` with the end state declared in `to`
    - Built first because it marks the one event the product exists to show, and is the last of the five to be dropped
    - Commit: "feat(ledger): M5 verdict flip pulse"
    - _Requirements: 10.4_

  - [ ] 17.5 Implement M4 — graph entrance stagger
    - `createTimeline` over `.promise-node` animating only `opacity` and a 6px `translateY` from the layout's already-final coordinates, `stagger(24, { from: 'first' })` in lane order, total elapsed capped at `min(nodeCount × 24ms, 620ms)` with the remainder appearing together
    - Gated on a `sessionStorage` flag so it runs once per session; the resting DOM is byte-identical to the no-motion render
    - Commit: "feat(ledger): M4 lane-ordered graph entrance stagger"
    - _Requirements: 10.4_

  - [ ]* 17.6 Implement M3 — panel section stagger
    - Panel container slide-and-fade stays a plain CSS transition; the panel's three sections stagger 40 ms behind it at `--dur-base` on `--ease-out`
    - Droppable third from the end of §18.1's order; dropping it leaves the container transition intact
    - _Requirements: 10.4_

  - [ ]* 17.7 Implement M2 — metric count-up
    - Interpolate 0 → value over `--dur-figure` on `--ease-out` using `utils.set` per frame, formatted through the exact formatter the static render uses so the final frame is character-identical; tabular numerals prevent digit reflow; no count-up for a tile replaced by the degraded chip
    - _Requirements: 10.4_

  - [ ]* 17.8 Implement M1 — edge draw along the verdict path
    - `svg.createDrawable` on the edge between a promise and its designed test, drawn 0 → 100% at `--dur-slow` when that path carried a verdict change; a single 1.4 s pulse, never a loop
    - First to be dropped: lowest information density of the five and the fiddliest against React Flow's edge internals
    - _Requirements: 10.4_

- [ ] 18. Checkpoint — the page moves and the reduced-motion render is identical
  - Ensure all tests pass, ask the user if questions arise. The reduced-motion equivalence test, the widened CSS motion scan, the visual trio and the typography scan must all be green before submission work starts.

- [ ] 19. Submission deliverables
  - [ ] 19.1 Deploy the Ledger to Vercel
    - Project root `apps/ledger`, install `npm ci` at the monorepo root, build `next build`, **zero environment variables**; confirm the public HTTPS URL serves the committed snapshot with Kane invoked zero times
    - Commit: "chore(deploy): vercel configuration for the read-only ledger"
    - _Requirements: 8.6, 14.6_

  - [ ] 19.2 Write the root README front matter and live-loop documentation
    - First 20 lines carry the deployed HTTPS Ledger URL and `npm run demo`; below that, the live-loop command with its prerequisites of a local Chrome installation and Kane CLI credentials, the headless bootstrap recipe (`context ingest … --mode ci` then `context extract --mode agent`), and the public repository URL
    - Add a test asserting the URL and the demo command both appear within the first 20 lines so the constraint cannot silently drift
    - Commit: "docs: README front matter with live URL, demo command, loop prerequisites"
    - _Requirements: 13.8, 13.9, 14.1_

  - [ ] 19.3 Assert the judge path is Kane-free and credential-free
    - Test asserting `scripts/demo.mjs` spawns no `kane` process and that `apps/ledger` resolves all data from the committed snapshot with no network call beyond localhost; document the observed time to the rendered landing view
    - Commit: "test: judge path spawns no Kane and needs no credentials"
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ] 19.4 Write the project summary
    - Single paragraph of **120 words or fewer** covering the promise graph, the citation discipline, and the three-way repair branch; add a word-count assertion in the test suite so the limit cannot silently drift
    - Commit: "docs: 120-word project summary with a word-count assertion"
    - _Requirements: 14.5_

  - [ ] 19.5 Record the demonstration video
    - 180 seconds or less, in this mandated order: (1) the deployed Ledger — graph, citations, coverage, badge, and the motion layer on first paint; (2) a code-break repair — break `lib/cart.ts`, hook fires, verdict red, agent patches from the handoff, second verification lands `proven`; (3) an accepted docs-lie amendment diff on the never-true discount claim
    - Commit the file or its link record together with the shot list and the measured duration
    - Commit: "docs: 180-second demonstration video and shot list"
    - _Requirements: 14.3, 14.4_

  - [ ] 19.6 Audit the commit history
    - Confirm the history carries at least 50 named commits (R14.2's floor is 15; this plan yields far more), each message naming the change it makes; fix any squashed or unnamed commit before the deadline
    - Commit: "docs: commit history audit against the submission checklist"
    - _Requirements: 14.2_

- [ ] 20. Final checkpoint — every submission deliverable green
  - Ensure all tests pass, ask the user if questions arise. Nothing in task 21 may start before this checkpoint is clean.

- [ ] 21. Droppable scope — build order is the reverse of the drop order (§18)
  - [ ]* 21.1 `maintain evolve` automation for `test-drift` (§18 #10)
    - Replace the failure-context review card with a real `kane-cli maintain evolve --mode agent` invocation when the probe accepts the flag
    - _Requirements: 7.2_

  - [ ]* 21.2 `kept doctor` (§18 #9)
    - `kane-cli --version` probe with a 10 s budget, reporting binary presence and resolved path

  - [ ]* 21.3 Badge visual polish (§18 #8)
    - Shields-style treatment; must keep the whole-number percentage and `image/svg+xml` contract intact and must not introduce a gradient the forbidden-palette scan rejects
    - _Requirements: 9.4, 9.5_

  - [ ]* 21.4 Evidence lane in the graph (§18 #7)
    - Evidence nodes and `evidence` edges in lane 3; the promise panel already reaches every artefact without this
    - _Requirements: 8.3_

  - [ ]* 21.5 `cover gaps` dual-axis ribbon (§18 #6)
    - Second Assurance invocation feeding a designed-versus-proven ribbon; `cover --json` already supplies both axes
    - _Requirements: 9.1, 9.2_

  - [ ]* 21.6 `KANE_TESTRUN_MEMBER_DEBUG` stderr capture (§18 #5)
    - Set the variable when `config.memberDebug` is true and capture `[member]`-prefixed stderr lines into run diagnostics
    - _Requirements: 4.12_

  - [ ]* 21.7 Shiki syntax highlighting for diffs (§18 #4)
    - Gated on disk headroom; the hand-rolled `lib/diff.ts` stays the default and Shiki must not become a required dependency or push the runtime budget past nine
    - _Requirements: 7.5_

  - [ ]* 21.8 `kept watch` loopback accept listener (§18 #3)
    - `127.0.0.1:3199` listener outside the Next app, dev-gated behind `NEXT_PUBLIC_KEPT_LOCAL=1`, performing the same `kept amend accept` path; must add no route to the Ledger's tree
    - _Requirements: 7.5, 7.6_

  - [ ]* 21.9 Live NDJSON pane in local development (§18 #2)
    - `LiveNdjsonPane` fed by the invoker's `onLine`, dev-only and absent from the production build
    - _Requirements: 8.7_

  - [ ]* 21.10 Conduit / RealWorld second target (§18 #1) — the very last task
    - Start only when every task in 19 is complete and passing and checkpoint 20 is clean; abandon on any regression to a submission deliverable
    - _Requirements: 14.8_

## Notes

- **Optional marking.** Sub-tasks marked `*` may be cut. All 29 correctness properties carry `*` (Property 9 splits into 3.17 for the state-guard clause and 11.12 for the out-of-radius byte-identity clause; Property 22 splits into 9.5 for presentation/contrast and the **unstarred** 17.3 for the reduced-motion clause). The design's non-property tests are **not** starred, because the design treats them as structure: the six source scans (2.3 `result_code`, 9.12 Ledger read-only, 11.5 router isolation, 17.2 `animejs` import shape and location, 8.4 mono-vs-prose typography, 8.3 forbidden palette), the pinned smoke-run regression (2.15), the `cover` refusal regression (2.16), the invoker enabler assertions (2.21), the per-command argv suite (12.13), the source-resolution ladder (12.5), the visual trio (8.3), the widened CSS motion scan (8.6), the reduced-motion equivalence test (17.3), hook-schema validation (12.11), and committed-evidence referential integrity (15.8). Fixture and generator authoring (2.10, 2.11, 6.4, 12.4) is unstarred too — a property with no generators is a property that never ran.
- **Droppables.** Only tasks 21.1–21.10 and the motion flourishes 17.6 (M3), 17.7 (M2), 17.8 (M1) are droppable. M5 (17.4) and M4 (17.5) are built first and dropped last per §18.1, so they are unstarred; if the timebox bites, cut from the M1 end. **Nothing from §18.2 may be dropped** — the palette and its measured matrix, the light/elevation system, the reduced-motion path, typography discipline, the parity test and the forbidden-palette scan are the Craft score, not polish. If all five flourishes were ever cut, `animejs` leaves `package.json` and `lib/motion.ts` collapses to the synchronous branch it already has, with no component changes.
- **[LIVE KANE]** tasks consume credits on authoring, need a local Chrome installation, and cannot run on CI: 6.1, 6.2, 6.3, and 15.1 through 15.6 — now including the stage-15 bootstrap ingest/extract and the reconcile integration run. Everything else is offline and reproducible from committed fixtures.
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
    { "id": 52, "tasks": ["21.1", "21.2", "21.3"] },
    { "id": 53, "tasks": ["21.4", "21.5", "21.6"] },
    { "id": 54, "tasks": ["21.7", "21.8", "21.9"] },
    { "id": 55, "tasks": ["21.10"] }
  ]
}
```
