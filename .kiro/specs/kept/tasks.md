# Implementation Plan: KEPT

## Overview

Eleven stages from design §19, resequenced on one hard change: the Property 18 / R6.12 verdict spike is pulled out of stage 9 and run the moment the fixture has one authored `_test.md` that can be broken (stage 6 below). Everything downstream of the spike depends only on the `VerdictRouter` interface, so its outcome changes exactly one string in `.kept/config.json` — but the answer has to be known before the router, the radius and the hooks are built on top of an assumption.

Every stage leaves the repo demoable: after stage 3 `kept build` writes a snapshot, after stage 5 that snapshot carries real promises with real citations, after stage 8 `npm run demo` is screenshot-worthy, after stage 13 all three repair branches have a surface.

Commit discipline (R14.2, ≥15 commits) is not a trailing task. Every implementation sub-task below carries a **Commit** line as part of its definition of done, because judges read commit history as evidence of work inside the event window.

Language: TypeScript throughout (design §2.1). Runtime dependency budget is the eight packages in design §2.2 — `next`, `react`, `react-dom`, `tailwindcss`, `@xyflow/react`, `zod`, `yaml`, `clsx`. Do not install Shiki, dagre/elkjs, commander/yargs, concurrently, micromatch, Playwright/Puppeteer, any font package, or Docker; hand-rolled replacements are specified in the design and are part of the plan.

## Tasks

- [ ] 1. Repository skeleton and toolchain
  - [ ] 1.1 Create the npm workspaces root and test toolchain
    - Root `package.json` with workspaces `apps/*`, `packages/*` and scripts `demo`, `loop`, `build:snapshot`, `test` (`vitest --run`, never watch), `check`
    - `tsconfig.base.json` (strict), single root `vitest.config.ts` with projects `kept-core` and `kept-cli`
    - Install only the dependencies named in design §2.2; add none of the deliberately-excluded packages
    - Commit: "chore: npm workspaces root, strict tsconfig, vitest root config"
    - _Requirements: 12.3, 13.1_

  - [ ] 1.2 Create package skeletons, `bin/kept`, and working state
    - `packages/kept-core` and `packages/kept-cli` (`bin: { "kept": "dist/index.js" }`); `bin/kept` shebang launcher
    - `.kept/config.json` with `verdictRouter`, `memberDebug`, `timeouts.hookMs` 300000, `timeouts.enrichmentMs` 60000
    - `.gitignore`: exclude `.context/`, force-add `output-*/` and curated evidence paths
    - Commit: "chore: kept-core and kept-cli packages, bin/kept, .kept config"
    - _Requirements: 6.10, 13.6, 13.7_

  - [ ] 1.3 Implement `diagnostics.ts`
    - `Diagnostic { code, severity, message, file, line, at }` and `DiagnosticSink`; every later module reports through this rather than throwing
    - Commit: "feat(core): diagnostic record and sink"
    - _Requirements: 2.3, 3.24_

- [ ] 2. Kane three-contract layer
  - [ ] 2.1 Implement `kane/family.ts`
    - `CommandFamily`, `TerminalType<F>`, `NdjsonEnabler`, `FamilyContract<F>` with **no public constructor** — `contractFor(family)` is the only way to obtain one
    - `familyForArgv(argv)` reverse lookup; the `CONTRACTS` table encodes terminal type, NDJSON enabler, exit-3 meaning and evidence location once
    - Commit: "feat(core): three Kane command-family contracts"
    - _Requirements: 3.2, 3.4, 3.5_

  - [ ] 2.2 Implement `kane/coerce.ts`
    - `resultCode()` accepting number, decimal string and whitespace-padded string, returning null for absent/non-numeric; `credits()` preferring `credits_consumed` and accepting `credits`
    - This file is the only site in the repo permitted to compare `result_code`
    - Commit: "feat(core): result_code and credits coercing accessors"
    - _Requirements: 3.10, 3.11, 3.13, 3.14_

  - [ ] 2.3 Write the `result_code` source-scan guard test
    - `packages/kept-core/test/no-raw-result-code.test.ts` reads every `.ts` under `packages/kept-core/src` and `packages/kept-cli/src` and fails if `/result_code\s*(===|!==|==|!=)/` matches outside `kane/coerce.ts`
    - Architectural guard, not an extra — it is what keeps the three-way branch from silently never firing
    - Commit: "test(core): forbid raw result_code comparison outside coerce.ts"
    - _Requirements: 3.12_

  - [ ]* 2.4 Write property test for result-code coercion
    - **Property 10: `result_code` coercion makes string and number forms equivalent**
    - **Validates: Requirements 3.11, 3.12, 3.13, 6.8**

  - [ ]* 2.5 Write property test for the credits accessor
    - **Property 11: The credits accessor prefers `credits_consumed` and accepts `credits`**
    - **Validates: Requirements 3.10, 14.7**

  - [ ] 2.6 Implement `kane/exit.ts`
    - `exitMeaning(family, code, killed)` total over all integers and null; `(Assurance, 3)` → `paused-resumable`, `(ExecutionTestrun, 2)` → `preflight-rejected`, `130` → `force-interrupted`, `127`/ENOENT → `kane-not-found`
    - Commit: "feat(core): per-family exit-code interpretation"
    - _Requirements: 3.15_

  - [ ]* 2.7 Write property test for exit-code interpretation
    - **Property 12: Exit-code interpretation is total and family-correct**
    - **Validates: Requirements 3.14, 3.15, 4.11, 11.9, 11.10, 11.11**

  - [ ] 2.8 Implement `kane/events.ts`
    - Typed `KaneEvent` union plus `Run_End`, `Testrun_Plan`, `testrun_member_end`, `Testrun_Done`, `Assurance_Done`, `ProgressEvent`, `VerdictObject`; the known-type set from design §4.3 treated as open
    - `run_dir` typed as `readonly runDirLegacy?: string` only, never read from disk
    - Commit: "feat(core): typed Kane event surface for all three families"
    - _Requirements: 3.16, 3.17, 3.18, 3.20, 3.21, 3.22_

  - [ ] 2.9 Implement `kane/ndjson.ts`
    - `parseStream(contract, lines)` as the only exported entry point — a call cannot exist without a family named at the call site
    - `ParsedStream<F>` discriminated union with `terminal` present only on the `complete` arm; `crashed` carries the expected terminal type and the outcome-unknown diagnostic
    - Line handling: skip non-`{` prefix lines silently, diagnose malformed lines with their one-based line number and continue, classify by `step` key first, last terminal-type event wins, unknown types retained
    - Commit: "feat(core): family-gated NDJSON parser"
    - _Requirements: 3.1, 3.3, 3.6, 3.8, 3.9, 3.23, 3.24_

  - [ ]* 2.10 Write property test for parser robustness
    - **Property 7: Parsing is robust and lossless per line**
    - **Validates: Requirements 3.1, 3.8, 3.9, 3.23, 3.24**

  - [ ]* 2.11 Write property test for terminal-event recognition and crash classification
    - **Property 8: Terminal-event recognition is family-determined and crash classification is exhaustive**
    - **Validates: Requirements 2.6, 2.7, 3.2, 3.6, 4.7, 5.2**

  - [ ]* 2.12 Write property test for faithful field exposure
    - **Property 13: Family-typed fields are exposed faithfully and `run_dir` is never read**
    - **Validates: Requirements 3.16, 3.17, 3.18, 3.21, 3.22**

  - [ ] 2.13 Write the pinned smoke-run regression test
    - Parse all twelve lines of the committed `docs/kane/smoke-run.ndjson` as an `ExecutionRun` stream, assert the `run_end` event is identified as terminal and that zero diagnostics are recorded
    - Copy-reference it into `packages/kept-core/test/fixtures/run-passed.ndjson`; this is the only proof the parser reads a real recorded stream
    - Commit: "test(core): pin the recorded smoke run as a parser regression"
    - _Requirements: 3.25_

  - [ ] 2.14 Implement `kane/evidence.ts`
    - `resolveEvidenceDir()` — `session_dir/evidence` for ExecutionRun, `<cwd>/.testmuai/evidence` for ExecutionTestrun, null for Assurance; no event field is ever consulted for a path
    - `listArtifacts()` newest pack by mtime, classifying `annotated`, `screenshot`, `har`, `console`, `log`, `failure-yaml`, `other`
    - Commit: "feat(core): family-derived evidence pack resolution"
    - _Requirements: 3.19_

  - [ ]* 2.15 Write property test for evidence resolution
    - **Property 14: Evidence-pack locations are resolved from the family, never from the event**
    - **Validates: Requirements 3.19, 4.13, 6.11**

  - [ ] 2.16 Implement `kane/failureYaml.ts`
    - `loadFailureYaml()` over the `yaml` package, returning null for absent or unparseable files
    - Commit: "feat(core): failure.yaml loader"
    - _Requirements: 6.7_

  - [ ] 2.17 Implement `kane/invoker.ts`
    - `KaneInvoker.invoke()` resolves the binary once per process, asserts `familyForArgv(argv) === spec.family`, applies the contract's NDJSON enabler (`--agent` / nothing / `--mode agent`) and asserts `--agent` is absent for ExecutionTestrun
    - stdin `ignore`; incremental line splitting with `onLine`; SIGTERM then SIGKILL at 2 s on timeout; last 50 stderr lines retained
    - Never throws for any Kane behaviour — absence, auth failure, crash and timeout are all data
    - Commit: "feat(core): KaneInvoker with per-family enabler and timeout kill"
    - _Requirements: 2.12, 3.4, 3.5, 11.8_

- [ ] 3. Promise model, providers, and the snapshot contract
  - [ ] 3.1 Implement `model/promise.ts` and `model/ids.ts`
    - `Verdict`, `Citation`, `DesignedTest`, `RepairAnnotation`, `PromiseRecord`, `PromiseGraph`, `GraphEdge`; `designedTest` is explicit null, never undefined
    - `normaliseClaim()` and `promiseId(citationFile, rawClaim)` keyed on file plus normalised claim only — never line number, never ordering
    - Commit: "feat(core): promise model and line-independent id derivation"
    - _Requirements: 1.1, 1.2, 1.6_

  - [ ]* 3.2 Write property test for identifier stability
    - **Property 1: Promise identifiers are stable across rebuilds**
    - **Validates: Requirements 1.2**

  - [ ] 3.3 Implement the citation admission gate
    - `admitPromise()` as the single funnel: reject `no-citation` naming the supplying provider, reject `line-out-of-range` carrying requested line and actual count, reject `file-missing`
    - On admission, overwrite `citation.text` with the verbatim line read from disk; one-based indexing, no trimming, no phantom final line
    - Commit: "feat(core): citation admission gate"
    - _Requirements: 1.3, 1.4, 1.5_

  - [ ]* 3.4 Write property test for graph admission
    - **Property 2: Graph admission requires a resolvable citation**
    - **Validates: Requirements 1.3, 1.4, 1.5**

  - [ ] 3.5 Implement `providers/baseline.ts`
    - Scan `**/*_test.md` skipping `node_modules`, `.git`, `.next`, `dist`, `output-*`, `.testmuai`; 20-line hand-rolled frontmatter reader; `@verifies\s+(?<file>[^\s:]+):(?<line>\d+)` grammar
    - Every path wrapped so `collect` resolves `ok: true` for every repository state including zero `*_test.md` files; never sets degraded
    - Commit: "feat(core): infallible baseline promise provider"
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 3.6 Write property test for baseline totality
    - **Property 5: The baseline provider is total**
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [ ] 3.7 Implement `providers/enrichment.ts` and `providers/coverage.ts`
    - Invoke `cover --json` under the Assurance family with a 60 s budget; accept enriched axes only on `complete` + `done` + `status: complete` + a `coverage` payload
    - Map each failure observation to its specific `degradedReason` per design §5.3; project the coverage payload tolerantly, keyed on `test_id` then normalised path, with unmatched entries as diagnostics
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
    - `computeMetrics()` producing total, designed, proven, red, stale and undesigned counts plus both coverage ratios; both ratios null with no division performed when total is zero; `provenCoverage` null when degraded
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
    - `serialiseSnapshot()` with recursive sorted keys, 2-space indent, arrays pre-sorted by id, timestamps as strings only; `parseSnapshot()` zod-parsing and throwing with a field path
    - Commit: "feat(core): canonical snapshot serialisation"
    - _Requirements: 1.8_

  - [ ]* 3.15 Write property test for snapshot round-tripping
    - **Property 3: Snapshot serialisation round-trips and is canonical**
    - **Validates: Requirements 1.8, 8.8**

  - [ ] 3.16 Implement `state.ts` — the single write guard
    - `mayWriteVerdicts(result)` true only for `stream.kind === 'complete'` with `exitMeaning ∈ {success, failure}`; `StateStore.applyRun` calls it first and returns state unchanged otherwise
    - Crashed, timed out, paused, force-interrupted, preflight-rejected and kane-not-found preserve prior verdicts and freshness by construction
    - Commit: "feat(core): state store with the single verdict write guard"
    - _Requirements: 2.10, 3.7, 5.3, 5.4_

  - [ ]* 3.17 Write property test for the write guard
    - **Property 9 (state clause): Verdicts and freshness move only on a proven outcome**
    - **Validates: Requirements 3.7, 5.3, 11.8, 11.9**

  - [ ] 3.18 Implement the CLI entry, `kept build`, and `kept snapshot`
    - Hand-rolled arg parsing (~40 lines, no commander); common flags `--repo`, `--json`, `--router`, `--member-debug`; every command exits 0 unless the CLI itself is broken
    - `kept build` runs both providers and writes `.kept/state.json`; `kept snapshot` writes `apps/ledger/data/ledger.snapshot.json`
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
    - Commit: "chore: first snapshot with eight real cited promises"
    - _Requirements: 1.3, 2.2, 4.14_

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

  - [ ] 6.3 **[LIVE KANE]** Record the spike outcome and set the default router
    - Write `docs/kane/verdict-spike.md` with the invocation, the observed terminal event, the presence or absence of `result_code` 740 and the `verdict` object, and the resulting decision
    - Set `.kept/config.json` `verdictRouter` accordingly — this is the only thing in the repo the spike's outcome changes
    - Commit: "docs(kane): verdict spike outcome and selected default router"
    - _Requirements: 6.12_

  - [ ] 6.4 Commit the captured streams as test fixtures
    - `run-failed-740.ndjson` (or the observed equivalent), `testrun-mixed.ndjson`, `testrun-preflight-invalid.ndjson`, `testrun-crashed.ndjson`, `assurance-cover-done.ndjson`, `assurance-paused.ndjson`, plus `failure-*.yaml`
    - Truncated and preflight variants may be derived from the real capture; every router and parser property below reads these
    - Commit: "test(core): commit captured Kane streams as parser fixtures"
    - _Requirements: 3.25, 6.7_

- [ ] 7. Checkpoint — the spike's answer is recorded
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Ledger projection and design system
  - [ ] 8.1 Build the Ledger shell, tokens, and typed token mirror
    - `styles/tokens.css` exactly as design §10.4 (dark surfaces, system font stacks, verdict colours as the only saturated colour, 4-based spacing, reduced-motion override); `lib/tokens.ts` mirroring the pairs actually used
    - `app/layout.tsx` with skip link as first focusable element
    - Commit: "feat(ledger): dark token system and app shell"
    - _Requirements: 10.1, 10.4_

  - [ ] 8.2 Implement build-time snapshot loading
    - `lib/snapshot.ts` importing `data/ledger.snapshot.json` and running `parseSnapshot`, so an absent or invalid snapshot fails the build with a message naming the field path; zero Kane invocations
    - Commit: "feat(ledger): schema-validated build-time snapshot load"
    - _Requirements: 8.6, 8.8_

  - [ ] 8.3 Implement `lib/layout.ts` and `lib/relativeTime.ts`
    - Deterministic lane layout (documents 0, promises 1, tests 2, evidence 3; `LANE_X`, `ROW_H`; rows sorted by verdict rank then id so red sorts to the top) as a pure function of the snapshot — no dagre, no physics
    - Relative-time formatter over ISO 8601 strings with a `> 24h` amber boundary
    - Commit: "feat(ledger): deterministic lane layout and relative time"
    - _Requirements: 9.6, 9.7, 10.8_

  - [ ]* 8.4 Write property test for freshness rendering
    - **Property 24: Freshness rendering is monotone with a hard 24-hour threshold**
    - **Validates: Requirements 9.6, 9.7**

  - [ ] 8.5 Build `MetricRail`, `FreshnessChip`, `DegradedChip`, `VerdictTag`
    - `VerdictTag` always renders the word `proven`/`red`/`stale`/`undesigned` beside its colour; `undesigned` uses the neutral token
    - When `degraded`, the Proven Coverage tile is replaced by the `baseline data only` chip rather than showing a number; `totalPromises === 0` renders literal `n/a`
    - Commit: "feat(ledger): metric rail, verdict tags, degraded and freshness chips"
    - _Requirements: 2.11, 9.1, 9.2, 9.3, 10.2, 10.3, 10.5_

  - [ ]* 8.6 Write property test for verdict presentation and contrast
    - **Property 22: Verdict presentation always pairs colour with a word, at accessible contrast**
    - **Validates: Requirements 10.2, 10.3, 10.5, 10.6**

  - [ ] 8.7 Build `PromiseGraph`, `PromiseNode`, `PromisePanel`
    - React Flow used for panning, zooming, edges and viewport only; node shows id chip, claim, `path:line` citation and verdict tag
    - Panel opens on selection or `?p=<id>` with verbatim cited text, designed test, verdict and evidence artefact links; keyboard model from design §10.5 including the parallel `role="list"` sidebar
    - No horizontal overflow between 1280 and 1920 px
    - Commit: "feat(ledger): promise graph hero, node, and detail panel"
    - _Requirements: 8.1, 8.2, 8.3, 10.7, 10.8_

  - [ ]* 8.8 Write property test for projection completeness
    - **Property 23: Every promise is reachable, selectable and evidenced in the projection**
    - **Validates: Requirements 7.5, 8.1, 8.2, 8.3, 10.7**

  - [ ] 8.9 Build `/coverage` and `/runs`
    - `/coverage` is the shareable unauthenticated page: both coverage figures, freshness, every promise with its verdict
    - `/runs` renders `snapshot.runs[]`: family, command, status, coerced result code, credits, exit meaning, `outcome unknown` / `paused, resumable` / `timed out` / preflight reasons
    - Commit: "feat(ledger): public coverage page and terminal-event run log"
    - _Requirements: 9.8, 4.9, 4.11_

  - [ ] 8.10 Build `/badge.svg`
    - `route.ts` exporting **GET only** with `dynamic = 'force-static'`, `content-type: image/svg+xml`, hand-written 110×20 SVG, proven coverage as a whole-number percentage or `n/a`
    - Commit: "feat(ledger): GET-only proven-coverage badge"
    - _Requirements: 9.4, 9.5_

  - [ ]* 8.11 Write property test for the badge
    - **Property 25: The badge is valid SVG reporting a whole-number percentage**
    - **Validates: Requirements 9.4, 9.5**

  - [ ] 8.12 Implement `scripts/demo.mjs`
    - Zero-dependency spawner for `next dev -p 3100` in `apps/fixture` and `next dev -p 3000` in `apps/ledger`, prefixed output forwarding, both URLs printed, children killed on SIGINT, zero Kane spawns
    - Commit: "feat: npm run demo boots both apps with zero dependencies"
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ] 8.13 Write the Ledger read-only and motion source scans
    - `scripts/check-readonly.mjs` plus its test wrapper: fail if `apps/ledger` contains any non-GET route handler, server action, `middleware.ts`, auth reference, `child_process`/`exec` import, or the string `kane`
    - Sibling CSS scan: every transition declaration must sit on a `.verdict-*` or `.is-selected` class — no entrance animation, skeleton shimmer or hover motion
    - Architectural guards, wired into both `npm test` and `npm run check`
    - Commit: "test: source scans for ledger read-only guarantee and motion policy"
    - _Requirements: 8.4, 8.5, 10.4_

- [ ] 9. Checkpoint — first screenshot-worthy state
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Verdict router, blast radius, and `kept verify`
  - [ ] 10.1 Implement `verdict/router.ts` and `verdict/memberStatus.ts`
    - `RepairBranch`, `VerdictObject`, `FailureContext` (with lazy `loadFailureYaml`), `RoutedRepair`, `VerdictRouter`, `selectRouter(cfg)` falling back to `resultCode740` with a diagnostic on an unknown value
    - `memberStatusToVerdict` total: `passed→proven`, `failed`/`broken→red`, `interrupted→stale`, unknown→`stale` flagged unknown
    - Commit: "feat(core): verdict router strategy interface and member status mapping"
    - _Requirements: 4.8, 6.1, 6.10_

  - [ ]* 10.2 Write property test for member status mapping
    - **Property 15: Member status maps totally onto four verdicts**
    - **Validates: Requirements 3.20, 4.8, 4.9**

  - [ ] 10.3 Implement `verdict/resultCode740.ts`
    - Rule order from design §6.2: verdict object outranks the numeric code; `confirmed: false → test-drift`, `confirmed: true → code-break`, no object with coerced 740 → `code-break`, other failing codes delegate to `failureYamlTriage`, residue → `docs-lie`
    - Surface `severity`, `category`, `confidence` and a real `evidenceRef` or null — never a fabricated path
    - Commit: "feat(core): resultCode740 verdict router"
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.8, 6.11_

  - [ ] 10.4 Implement `verdict/failureYamlTriage.ts`
    - Read a category-ish field from the newest pack's `failure.yaml` and map per design §6.3, with `assertion` + coerced `result_code` in 700..799 → `docs-lie` and unrecognised/absent → `docs-lie`
    - Ships working regardless of the spike outcome
    - Commit: "feat(core): failureYamlTriage fallback router"
    - _Requirements: 6.7, 6.13_

  - [ ] 10.5 Write the router-isolation source scan
    - Fail if anything outside `packages/kept-core/src/verdict/` imports a concrete router implementation, so the spike outcome can only ever change one config string
    - Commit: "test(core): forbid concrete router imports outside src/verdict"
    - _Requirements: 6.10, 6.14_

  - [ ]* 10.6 Write property test for verdict-object precedence
    - **Property 18: The verdict object outranks the result code**
    - **Validates: Requirements 6.3, 6.4, 6.5, 6.6**

  - [ ]* 10.7 Write property test for router totality and strategy isolation
    - **Property 17: The verdict router is total, deterministic and strategy-isolated**
    - **Validates: Requirements 6.1, 6.2, 6.7, 6.9, 6.10, 6.13, 6.14**

  - [ ] 10.8 Implement `radius/plan.ts`
    - `readPlan()` over `.kept/plan.json` refreshing via `kane-cli testrun run --dry-run` (ExecutionTestrun, piped stdout, no `--agent`, 60 s) when missing, older than 10 minutes, or older than any `*_test.md` mtime
    - A `--dry-run` stream that never reaches `testrun_done` leaves the previous cache in place
    - Commit: "feat(core): testrun plan cache with dry-run refresh"
    - _Requirements: 4.4_

  - [ ] 10.9 Implement `radius/radius.ts`
    - 30-line `*`/`**` glob matcher over repo-relative POSIX paths (no micromatch); changed paths → covering tests → promises → `test_id` values taken only from `testrun_plan.members[]`
    - Members without a `test_id` are excluded and diagnosed; empty radius means zero Kane invocations plus one diagnostic per uncovered path
    - Commit: "feat(core): blast radius from plan identifiers only"
    - _Requirements: 4.2, 4.3, 4.5_

  - [ ]* 10.10 Write property test for blast-radius identifier provenance
    - **Property 16: Blast-radius identifiers come only from the plan**
    - **Validates: Requirements 4.3, 4.4, 4.5**

  - [ ] 10.11 Implement `kept verify --changed` / `--all`
    - Invoke `kane-cli testrun run --from-context <ids> --on-failure continue` with stdout piped and a 300 s budget; consume `testrun_plan` (treating `valid: false` as preflight rejection with each member's reason), then `testrun_member_end`, then require `testrun_done`
    - Resolve evidence from `<cwd>/.testmuai/evidence/`, route `failed`/`broken` members, write verdicts only for promises in the radius, record `broken`/`interrupted` verbatim in diagnostics, then write state and snapshot
    - Commit: "feat(cli): kept verify with blast-radius replay"
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.13, 4.14, 4.15, 11.9_

  - [ ]* 10.12 Write property test for out-of-radius preservation
    - **Property 9 (radius clause): every promise outside the blast radius is byte-identical before and after, including verdict source and freshness**
    - **Validates: Requirements 4.10, 4.15**

- [ ] 11. Kiro hooks and the handoff contract
  - [ ] 11.1 Implement `handoff/handoff.ts`
    - `HandoffFile` type and `writeHandoff()` producing `.kept/handoff.json` plus an immutable `.kept/handoff/<runId>.json`, written for **every** run including crashed, paused and preflight-rejected ones with `nextAction.branch: null` and populated diagnostics
    - On `code-break`, `allowedPaths` contains only fixture source globs and `forbiddenPaths` includes fixture docs and `tests/**`
    - Commit: "feat(core): handoff file, the closed-loop contract"
    - _Requirements: 11.4, 11.7, 7.1_

  - [ ]* 11.2 Write property test for handoff completeness and fencing
    - **Property 26: The handoff file is complete for every run and fences the agent by branch**
    - **Validates: Requirements 7.1, 11.4**

  - [ ] 11.3 Write the two Kiro hook files
    - `.kiro/hooks/kept-code-verify.json` (`fileEdited` over fixture source globs) and `.kiro/hooks/kept-docs-reconcile.json` (`fileEdited` over `apps/fixture/README.md` and `apps/fixture/docs/**/*.md`), with the branch-fenced agent prompts from design §11.1
    - Include a hook-schema validation test asserting both files conform
    - Commit: "feat(hooks): code-verify and docs-reconcile with fenced agent prompts"
    - _Requirements: 11.1, 11.2, 11.3, 11.5_

  - [ ]* 11.4 Write property test for hook pattern partitioning
    - **Property 27: Hook file patterns partition fixture edits**
    - **Validates: Requirements 11.2, 11.3**

- [ ] 12. Checkpoint — the loop is wired
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Repair surfaces
  - [ ] 13.1 Implement `kept reconcile` and review cards
    - `kane-cli maintain reconcile --mode agent` gated on `done`; crashed or paused leaves every verdict unchanged and creates no card; every produced change is held as `.kept/review-cards/<id>.json` and never applied
    - Promises with no designed test become `undesigned`; promises whose cited claim text is gone are removed with a diagnostic; the snapshot reports the undesigned count as suite debt
    - Commit: "feat(cli): kept reconcile with held review cards"
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [ ] 13.2 Implement `kept evolve` with the `--mode agent` probe
    - One-time `kane-cli maintain evolve --help` probe cached per process; if the flag is unsupported, skip the invocation, build a `test-drift` review card from the failure context alone, and record the flag-mismatch diagnostic
    - Commit: "feat(cli): kept evolve with documented flag-probe degradation"
    - _Requirements: 7.2_

  - [ ]* 13.3 Write property test for held-change discipline
    - **Property 20: Reconciliation and evolution only ever produce held review cards**
    - **Validates: Requirements 5.5, 5.6, 5.7, 7.2, 7.7**

  - [ ] 13.4 Implement `repair/docsAmendment.ts` and `repair/lineEdit.ts`
    - `propose()` writes only under `.kept/`, carrying current text, proposed text, `expectedSha256`, rationale, evidence ref and artefacts; `amendmentId` derived from promise id plus proposed text so re-proposal is idempotent
    - `accept()` guards the sha256 interlock (mismatch → `stale`, exit 0, no write), mutates exactly one array element, writes to `<file>.kept-tmp` and renames atomically preserving line endings and trailing-newline state, then rebuilds the graph and rewrites the snapshot; `reject()` touches nothing else
    - Commit: "feat(core): docs amendments with sha256 staleness interlock"
    - _Requirements: 7.3, 7.4, 7.6_

  - [ ]* 13.5 Write property test for amendment write discipline
    - **Property 19: A documentation amendment writes nothing until accepted, then edits exactly one line**
    - **Validates: Requirements 7.3, 7.4, 7.6**

  - [ ] 13.6 Build `/amendments`, `/reviews`, and the diff renderer
    - `lib/diff.ts` ~60-line line-level unified diff (LCS over ≤200 lines, no Shiki); `DiffView` in monospace with red deletions and green additions; `AcceptControl` as a native keyboard-focusable button copying `kept amend accept <id>` and revealing the command inline — the Ledger still exposes no non-GET handler
    - `/reviews` renders each card with its promise id, repair branch and evidence reference
    - Commit: "feat(ledger): amendment diffs, accept control, review cards"
    - _Requirements: 7.5, 7.7, 10.7_

- [ ] 14. Live Kane evidence and the recorded closed loop **[LIVE KANE]**
  - [ ] 14.1 **[LIVE KANE]** Author the remaining seven tests and commit their recordings
    - Author each `*_test.md` against the running fixture; force-add every produced `output-*/` directory so all later replays are free
    - Commit: "chore(kane): authored the full corpus and committed replay recordings"
    - _Requirements: 13.6_

  - [ ] 14.2 **[LIVE KANE]** Measure and record zero-credit replay
    - Run `npm run loop` (`kept verify --all --member-debug`) entirely from cached recordings; capture what `credits()` reports rather than assuming 0, and commit the run entry
    - Commit: "chore(kane): recorded zero-credit replay of the full suite"
    - _Requirements: 4.6_

  - [ ] 14.3 **[LIVE KANE]** Drive the docs-lie branch on T-7
    - Replay `tests/cart_discount_test.md` against the correctly-behaving fixture so the assertion fails with the selector resolving; confirm the router returns `docs-lie` and `kept amend propose` produces the amendment replacing the never-true discount claim
    - Commit: "chore(kane): docs-lie branch fires on the never-true discount claim"
    - _Requirements: 7.3, 12.7_

  - [ ] 14.4 **[LIVE KANE]** Execute and persist one full closed loop
    - Break `apps/fixture/lib/cart.ts`, let the code hook verify (red, `code-break`), let the agent patch from the handoff, let the save re-fire the hook, land on `proven`
    - Commit both `.kept/handoff/<runId>.json` files, the intervening patch, and the snapshot showing both terminal events on `/runs`
    - Commit: "chore(loop): persisted closed-loop record, red to proven"
    - _Requirements: 11.5, 11.6, 11.7_

  - [ ] 14.5 Curate and commit the evidence packs
    - `kept snapshot` copies referenced packs into `apps/ledger/public/evidence/<packId>/` and rewrites `publicPath` values; commit the curated packs including `annotated.png` and the per-step screenshots so artefact links are plain static URLs
    - Commit: "chore(evidence): commit curated packs for the credential-free judge path"
    - _Requirements: 13.4, 13.5_

  - [ ]* 14.6 Write property test for evidence referential closure
    - **Property 28: Committed evidence and the snapshot are referentially closed**
    - **Validates: Requirements 13.4, 13.5**

  - [ ] 14.7 Record the measured authoring credit consumption
    - Write `docs/kane/credits.md` with the `credits_consumed` figure read from a real authored run's terminal event, alongside the zero-credit replay measurement, each with its run id and invocation
    - Commit: "docs(kane): measured credits_consumed for authoring and replay"
    - _Requirements: 14.7_

- [ ] 15. Checkpoint — Verified dimension is real
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Submission deliverables
  - [ ] 16.1 Deploy the Ledger to Vercel
    - Project root `apps/ledger`, install `npm ci` at the monorepo root, build `next build`, **zero environment variables**; confirm the public HTTPS URL serves the committed snapshot with Kane invoked zero times
    - Commit: "chore(deploy): vercel configuration for the read-only ledger"
    - _Requirements: 8.6, 14.6_

  - [ ] 16.2 Write the root README front matter and live-loop documentation
    - First 20 lines carry the deployed HTTPS Ledger URL and `npm run demo`; below that, the live-loop command with its prerequisites of a local Chrome installation and Kane CLI credentials, plus the public repository URL
    - Commit: "docs: README front matter with live URL, demo command, loop prerequisites"
    - _Requirements: 13.8, 13.9, 14.1_

  - [ ] 16.3 Assert the judge path is Kane-free and credential-free
    - Test asserting `scripts/demo.mjs` spawns no `kane` process and that `apps/ledger` resolves all data from the committed snapshot with no network call beyond localhost; document the observed time to the rendered landing view
    - Commit: "test: judge path spawns no Kane and needs no credentials"
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ] 16.4 Write the project summary
    - Single paragraph of 120 words or fewer covering the promise graph, the citation discipline, and the three-way repair branch; add a word-count assertion so the limit cannot silently drift
    - Commit: "docs: 120-word project summary"
    - _Requirements: 14.5_

  - [ ] 16.5 Record the demonstration video
    - 180 seconds or less, in this mandated order: (1) the deployed Ledger — graph, citations, coverage, badge; (2) a code-break repair — break `lib/cart.ts`, hook fires, verdict red, agent patches from the handoff, second verification lands `proven`; (3) an accepted docs-lie amendment diff on the never-true discount claim
    - Commit the file or its link record together with the shot list
    - Commit: "docs: 180-second demonstration video and shot list"
    - _Requirements: 14.3, 14.4_

  - [ ] 16.6 Audit the commit history
    - Confirm at least 15 commits, each message naming the change it makes; fix any squashed or unnamed commit before the deadline
    - Commit: "docs: commit history audit against the submission checklist"
    - _Requirements: 14.2_

- [ ] 17. Final checkpoint — every submission deliverable green
  - Ensure all tests pass, ask the user if questions arise. Nothing in task 18 may start before this checkpoint is clean.

- [ ] 18. Droppable scope — build order is the reverse of the drop order (§18)
  - [ ]* 18.1 `maintain evolve` automation for `test-drift` (§18 #10)
    - Replace the failure-context review card with a real `kane-cli maintain evolve --mode agent` invocation when the probe accepts the flag
    - _Requirements: 7.2_

  - [ ]* 18.2 `kept doctor` (§18 #9)
    - `kane-cli --version` probe with a 10 s budget, reporting binary presence and resolved path

  - [ ]* 18.3 Badge visual polish (§18 #8)
    - Shields-style treatment; must keep the whole-number percentage and `image/svg+xml` contract intact
    - _Requirements: 9.4, 9.5_

  - [ ]* 18.4 Evidence lane in the graph (§18 #7)
    - Evidence nodes and `evidence` edges in lane 3; the promise panel already reaches every artefact without this
    - _Requirements: 8.3_

  - [ ]* 18.5 `cover gaps` dual-axis ribbon (§18 #6)
    - Second Assurance invocation feeding a designed-versus-proven ribbon; `cover --json` already supplies both axes
    - _Requirements: 9.1, 9.2_

  - [ ]* 18.6 `KANE_TESTRUN_MEMBER_DEBUG` stderr capture (§18 #5)
    - Set the variable when `config.memberDebug` is true and capture `[member]`-prefixed stderr lines into run diagnostics
    - _Requirements: 4.12_

  - [ ]* 18.7 Shiki syntax highlighting for diffs (§18 #4)
    - Gated on disk headroom; the hand-rolled `lib/diff.ts` stays the default and Shiki must not become a required dependency
    - _Requirements: 7.5_

  - [ ]* 18.8 `kept watch` loopback accept listener (§18 #3)
    - `127.0.0.1:3199` listener outside the Next app, dev-gated behind `NEXT_PUBLIC_KEPT_LOCAL=1`, performing the same `kept amend accept` path; must add no route to the Ledger's tree
    - _Requirements: 7.5, 7.6_

  - [ ]* 18.9 Live NDJSON pane in local development (§18 #2)
    - `LiveNdjsonPane` fed by the invoker's `onLine`, dev-only and absent from the production build
    - _Requirements: 8.7_

  - [ ]* 18.10 Conduit / RealWorld second target (§18 #1) — the very last task
    - Start only when every task in 16 is complete and passing and checkpoint 17 is clean; abandon on any regression to a submission deliverable
    - _Requirements: 14.8_

## Notes

- Sub-tasks marked `*` are optional and may be cut. Property tests carry `*`; the four architectural source-scan guards (2.3 `result_code` comparison, 8.13 Ledger read-only plus CSS motion, 10.5 router isolation) and the pinned smoke-run regression (2.13) do not, because the design treats them as structure rather than coverage.
- Tasks marked **[LIVE KANE]** consume credits on authoring, require a local Chrome installation, and cannot run on CI. They are the only tasks in this plan with those properties; everything else is offline and reproducible from committed fixtures.
- Every implementation sub-task ends in a commit (R14.2). The plan yields well over 15 named commits without a trailing "commit everything" step, which is the point — history is evidence.
- The verdict spike (task 6) is deliberately out of design §19's stage-9 position. Its only downstream effect is the `verdictRouter` string in `.kept/config.json`, guarded by the isolation scan in 10.5, so nothing built after it needs rework whichever way it lands.
- `ledger.snapshot.json` is the CLI↔UI seam. Its zod schema (3.13) is green before any Ledger task reads a snapshot, so a malformed snapshot fails the build rather than rendering a lie.
- `mayWriteVerdicts()` (3.16) is the single write guard: verdicts move only on `kind: 'complete'` plus `exitMeaning ∈ {success, failure}`. Crashed, paused, timed-out, interrupted and preflight-rejected outcomes preserve prior state by construction.
- `parseStream` cannot be called without a declared `CommandFamily`, and `FamilyContract` has no public constructor — a parser call without a named family is a type error, not a review comment.
- Dependency budget is eight runtime packages against roughly 7 GB of free disk. Shiki, dagre, commander, concurrently, micromatch, Playwright and Docker stay out; the hand-rolled replacements are tasks 8.3, 10.9, 13.6 and 3.18.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0,  "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1,  "tasks": ["2.1", "2.2", "2.6", "2.8"] },
    { "id": 2,  "tasks": ["2.3", "2.4", "2.5", "2.7", "2.9", "2.14", "2.16"] },
    { "id": 3,  "tasks": ["2.10", "2.11", "2.12", "2.13", "2.15", "2.17"] },
    { "id": 4,  "tasks": ["3.1"] },
    { "id": 5,  "tasks": ["3.2", "3.3", "3.11"] },
    { "id": 6,  "tasks": ["3.4", "3.5", "3.7", "3.12"] },
    { "id": 7,  "tasks": ["3.6", "3.8", "3.13", "3.16"] },
    { "id": 8,  "tasks": ["3.9", "3.10", "3.14", "3.17"] },
    { "id": 9,  "tasks": ["3.15", "3.18"] },
    { "id": 10, "tasks": ["5.1", "5.2"] },
    { "id": 11, "tasks": ["5.3", "5.4"] },
    { "id": 12, "tasks": ["5.5", "5.6"] },
    { "id": 13, "tasks": ["6.1"] },
    { "id": 14, "tasks": ["6.2"] },
    { "id": 15, "tasks": ["6.3", "6.4"] },
    { "id": 16, "tasks": ["8.1", "8.2", "8.3", "8.12"] },
    { "id": 17, "tasks": ["8.4", "8.5", "8.10"] },
    { "id": 18, "tasks": ["8.6", "8.7", "8.9", "8.11", "8.13"] },
    { "id": 19, "tasks": ["8.8"] },
    { "id": 20, "tasks": ["10.1", "10.8"] },
    { "id": 21, "tasks": ["10.2", "10.3", "10.4", "10.9"] },
    { "id": 22, "tasks": ["10.5", "10.6", "10.7", "10.10"] },
    { "id": 23, "tasks": ["10.11"] },
    { "id": 24, "tasks": ["10.12", "11.1", "11.3"] },
    { "id": 25, "tasks": ["11.2", "11.4", "13.1", "13.2"] },
    { "id": 26, "tasks": ["13.3", "13.4", "13.6"] },
    { "id": 27, "tasks": ["13.5", "14.1"] },
    { "id": 28, "tasks": ["14.2", "14.3"] },
    { "id": 29, "tasks": ["14.4"] },
    { "id": 30, "tasks": ["14.5", "14.7"] },
    { "id": 31, "tasks": ["14.6", "16.1"] },
    { "id": 32, "tasks": ["16.2", "16.3", "16.4"] },
    { "id": 33, "tasks": ["16.5"] },
    { "id": 34, "tasks": ["16.6"] },
    { "id": 35, "tasks": ["18.1", "18.2", "18.3"] },
    { "id": 36, "tasks": ["18.4", "18.5", "18.6"] },
    { "id": 37, "tasks": ["18.7", "18.8", "18.9"] },
    { "id": 38, "tasks": ["18.10"] }
  ]
}
```
