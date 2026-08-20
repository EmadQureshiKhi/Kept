# The verdict spike — R6.12, answered against a live Kane

**Outcome: `.kept/config.json` keeps `verdictRouter: "resultCode740"`, now on evidence
rather than on an assumption.** The value did not change; what changed is that it is no
longer a guess. The reasoning is below, along with three observations that contradict
`docs/kane/command-surface.md` and one that contradicts design §6.2.

Everything here was read off a real `kane-cli` 0.8.4 run on this machine, authenticated
via OAuth as `emadqureshi965`, environment `prod`. Every stream quoted is committed
verbatim next to this file under `docs/kane/spike/`, and
`packages/kept-core/test/verdict-spike-capture.test.ts` asserts the routed branch against
those committed bytes, so the claims below cannot rot without a test going red.

## What was run

The committed corpus could not be handed to Kane at all — see
[the corpus-format collision](#the-corpus-format-collision-why-the-probe-is-not-testscart_subtotal_test_md)
below — so T-3 was transcribed into a Kane-valid probe at
`docs/kane/spike/cart_subtotal_spike_test.md`: same six steps, same waits, same
assertions, same fixture on port 3100.

```bash
# apps/fixture served on 3100 (next start, production build)

# 1. Author. Six steps, all authored, nothing cached yet.
kane-cli testmd run docs/kane/spike/cart_subtotal_spike_test.md \
  --agent --bug-detection continue --timeout 240
#   → exit 0, overall_status passed, 162s
#   → docs/kane/spike/t3-author.ndjson          (179 lines)

# 2. Break apps/fixture/lib/cart.ts line 106 so `subtotal` ignores quantity,
#    rebuild, then replay from cache. No --author, no --retry.
kane-cli testmd run docs/kane/spike/cart_subtotal_spike_test.md \
  --agent --timeout 240
#   → exit 1, overall_status failed, 43s
#   → docs/kane/spike/t3-replay-failed.ndjson   (115 lines)

# 3. Revert the break, rebuild, replay again — the free-replay claim (R13.6).
kane-cli testmd run docs/kane/spike/cart_subtotal_spike_test.md \
  --agent --timeout 240
#   → exit 0, overall_status passed, 10s, replay_decisions 6, author_decisions 0
#   → docs/kane/spike/t3-replay-passed.ndjson   (114 lines)
```

## The observed terminal event

`testmd run` does **not** terminate with `run_end`. It emits one `run_end` **per step** —
six of them, one closing each authored or replayed step — and then terminates with
`test_md_done`:

```
run_start → step_start/step_event/step_end… → run_end → test_md_step_end   ×6
  → test_md_bug_verdict?  → test_md_evidence_ingest  → test_md_summary
  → test_md_done                                                   ← terminal
```

`test_md_done` carries `{type, overall_status, duration_s, session_id, share_url}` and
nothing else — no status field spelled `status`, no result code, no credits.

This matters less than it looks. KEPT parses this family with `terminalType: 'run_end'`
and takes the **last** matching event, and on the failing replay the last `run_end` is the
failing step's — the one carrying the verdict object. So the existing parser lands on
exactly the right event by construction of the last-wins rule, and `test_md_done`,
`test_md_summary` and `test_md_bug_verdict` are retained as unknown types and continue.
The stream classifies as `complete`, not `crashed`.

## The answer to R6.12, in two parts

### `result_code` on a failing cached replay: absent, not seven-forty

The failing step's `run_end` carries **no result-code field at all**. Not the
confirmed-bug code, not a code in the assertion-class band, not any code:

```json
{"type":"run_end","run_id":"run-5","status":"failed",
 "reason":"assertion_failed: @ step 3","duration":27.24,
 "final_url":"http://localhost:3100/cart","actions_executed":3,
 "screenshot_path":"…/screenshots/step_003.png","run_dir":"…/scratch/5/replay-test",
 "total_runs":1,"context":{…},"variables_out":{…},"store_out":{},"verdict":{…}}
```

Its whole key set is `type, run_id, status, summary, reason, duration, final_url,
actions_executed, screenshot_path, run_dir, total_runs, context, variables_out,
store_out, verdict` — a **different and smaller** shape than an authoring `run_end`, which
does carry the code, the reason code, `per_flow_metadata`, `session_dir` and
`credits_consumed`. The five *passing* steps of the same replay each report the success
code as the number one hundred; only the failing one omits it.

Consequence for design §6.2: **rules three, four and five of `resultCode740` are
unreachable on this path.** There is nothing numeric to route on. The numeric rung is not
wrong, it is simply never consulted for a failing replay of a `testmd` test.

### The inline `verdict` object: present, and `confirmed` reads `false`

```yaml
confirmed: false                 # ← the field rule 1 of §6.2 keys off
status: failed
family: application_issue        # ← where the real attribution lives
category: ui_data_defect
severity: major
confidence: 0.97
bug_title: Cart summary totals ignore item quantity
one_liner: The cart page shows "$18.00" for Subtotal and Total even though the cart
           contents on the page add up to "$36.00".
root_cause: The cart summary is using the wrong amount and appears to count only one
            item instead of the full quantity in the cart.
agent_fault_assessment: The agent did not cause this outcome. … this is a product-side
            totals display problem rather than a replay or selector issue.
culprit_step: step 5-3
credits_consumed: 4.8424499999999995
downgrade_reason: "citation verification failed: objective_contradiction: not
            mechanically verifiable; …"
```

The object is duplicated in a dedicated `test_md_bug_verdict` event carrying
`{step_index, confirmed, bug_title, family, category, category_proposal, severity,
confidence, one_liner}` — the same fields, minus the prose and the credits.

**`confirmed` is not the product-versus-test attribution.** Read the `downgrade_reason`
and the sealed note together: the investigation reached `application_issue /
ui_data_defect` at 0.97 confidence, explicitly cleared the test in
`agent_fault_assessment`, and then downgraded `confirmed` to false because its citations
were *not mechanically verifiable*. The sealed triage note says the same thing in its own
words — `verification.status: not_verified`. So `confirmed` is a **mechanical-verification
flag**, and the attribution lives in `family`.

This is the one place reality contradicts design §6.2 rather than merely bypassing it.
Rule 1 reads "`confirmed === false` → `test-drift`, Kane investigated and did not confirm
a product bug". On this capture that reading is wrong: we broke the product, Kane said so
in every field except one, and rule 1 routes `test-drift`. Fixing it means keying rule 1
on `family` before `confirmed` — a change **inside `packages/kept-core/src/verdict/`**,
which this spike is explicitly not allowed to make. It is recorded here as a follow-up
with a committed regression input already in place.

## Why `resultCode740` is still the right default

Both strategies were run against the real captured context. Neither reaches `code-break`,
so the choice is between two wrong labels, and it is not close:

| | `resultCode740` | `failureYamlTriage` |
|---|---|---|
| Branch | `test-drift` (rule 1) | `docs-lie` (default row) |
| Signal it read | the inline object, which is present | a triage note it cannot reach |
| `severity` / `category` / `confidence` carried | `major` / `ui_data_defect` / `0.97` | all null |
| Kane's one-liner in the rationale | yes, quoted verbatim | no |

`failureYamlTriage` cannot reach the note for two independent reasons, both new
observations:

1. **A sealed pack is a single zip file, not a directory.** The stderr hint names
   `…/sessions/<id>/evidence/<uuid>.evidence`, and that is a `Zip archive`
   (`docs/kane/spike/pack-listing.txt` is its table of contents). `kane/evidence.ts`
   lists a pack *directory*, so it resolves no pack here at all.
2. **The categorised note is nested, and the note at the pack root has no category.**
   The root `failure.yaml` (`docs/kane/spike/pack-failure.yaml`) is an index —
   `totals`, then a `failures[]` array with `status: broken`, a `title` and
   `triage_status: triaged`. It carries none of `triage.category`, `category`,
   `classification` or `reason`, so the loader reads no signal. The categorised note is
   one per failure at `tests/<test>/steps/<n>/failure.yaml`
   (`docs/kane/spike/pack-step-failure.yaml`), and it spells the category
   `triage.rca.category: application_issue/ui_data_defect` — one level deeper than the
   `triage.category` alias the loader accepts.

So `resultCode740` routes off a signal that is actually in the stream, on the artefact
KEPT actually receives, and puts Kane's real triage — severity, category, confidence and
the one-liner — into the annotation a reviewer reads. `failureYamlTriage` would produce a
strictly less informative answer and an equally wrong branch. R6.13 is unaffected:
`failureYamlTriage` ships built and tested either way, and it remains the rung
`resultCode740` delegates to whenever no inline object arrives.

**One observation is one data point.** `confirmed: true` is plainly reachable — the
downgrade is conditional, and the reason it fired is recorded. A second capture where the
citations *are* mechanically verifiable would land on rule 2 and route `code-break`
correctly. Nothing above asserts that `confirmed` is always false; it asserts what this
run did.

## Credits — replay is free, investigation is not

| Phase | Balance before → after | Delta | What the stream reported |
|---|---|---|---|
| Author (6 steps) | 11188.7986 → 11134.9169 | **53.88** | six per-step `credits_consumed`, summing to 49.205855 |
| Failing replay | 11134.9169 → 11130.0745 | **4.84** | no top-level credits; `4.8424499999999995` **inside the verdict object** |
| Passing replay | 11130.0745 → 11130.0745 | **0.00** | no credits field anywhere |

Two corrections to the credit economics in `docs/kane/command-surface.md`, which says
flatly that replay is free:

- Replay itself **is** free — the passing replay moved the balance by nothing, and its
  summary reports `replay_decisions: 6, author_decisions: 0`.
- A **failing** replay costs, because the automatic post-failure investigation costs. The
  charge is reported on `verdict.credits_consumed`, not at the top level of any event, and
  it matches the balance delta exactly. `credits()` reads the `credits_consumed` spelling,
  so it finds this figure — but only if handed the verdict object rather than the event.

## Other corrections to the verified command surface

- **`run_start`, `step_start` and `step_end` exist.** `command-surface.md` states they do
  not. The authoring stream carries seven `run_start`, nineteen `step_start` and eighteen
  `step_end`, plus ninety-one `step_event` and fifteen `describe_trigger`. What is true is
  the *conclusion* drawn from their absence: the vocabulary is open and unknown types must
  be retained, which is what the parser does.
- **No untyped `{step, status, remark}` progress events appear.** Not one, in any of the
  three streams. Progress on this path is the typed `step_event`. The `step`-key-first
  classification rule stays correct — it is just not exercised by `testmd run`.
- **`run_dir` is still emitted**, on both authoring and replay `run_end` events, pointing
  at `…/sessions/<id>/scratch/<n>/replay-test` on replay. Legacy and never to be read from
  disk, exactly as design §4.1 has it; the point is that its *presence* is not evidence it
  is usable.
- **A failed assertion on replay is recorded as `broken`, not `failed`.** The stream says
  `failed` (`test_md_step_end.status`, `test_md_summary.overall_status`,
  `test_md_done.overall_status`), while the sealed pack's `run.yaml` counts it under
  `broken: 1` with `failed: 0`, and the recording's `meta.json` files the execution as
  `status: broken`. Both map to a `red` verdict under design §6.5, so nothing routes
  differently — but a consumer comparing a stream status against a pack status will find
  them disagreeing, and it is the pack that says `broken`.
- **`testmd run` seals its pack under `session_dir/evidence/`**, matching the
  ExecutionRun family's `session-dir` derivation, and the path arrives on **stderr only**.
  Both as designed. The replay's stderr also carried an advisory line before the hint:
  `evidence: 1 status_disagrees advisory(ies) — self-explained by triaged failure
  record(s)`.

## The corpus-format collision (why the probe is not `tests/cart_subtotal_test.md`)

Task 6.1 was written to author the corpus file itself. It cannot be authored, and this is
the blocker rather than a preference:

```
kane-cli testmd run tests/cart_subtotal_test.md --agent …
→ exit 2, before any browser launch, zero credits
error: [tests/cart_subtotal_test.md:1] unknown config key: test_id
```

1. **Root frontmatter keys are a closed set** in Kane's own parser: `mode, max_steps,
   timeout, global_context, local_context, variables, session_context, code_export,
   code_language, url, target, chrome_profile, cdp_endpoint, ws_endpoint, headless, app,
   no_reset, os_version, on_lock_conflict, tags, assurance`. Both `test_id` and `covers`
   are rejected. Kane's own home for a logical identifier is `assurance: {id, base}`,
   where `base` must be a `sha256:<hex>` string; there is no Kane key for `covers` at all.
2. **Steps come only from `## ` headings.** All eight corpus files write their steps as a
   numbered prose list under an `# H1`, and Kane discards everything before the first
   `## `, so those documents parse to **zero steps** even once the frontmatter is legal.
3. There is no spelling that satisfies both parsers without a code change. KEPT's
   hand-rolled reader and Kane's YAML parser read the same first fence and both ignore
   `#` comments; the only overlap is a YAML block scalar under `local_context` or
   `global_context`, which would inject KEPT metadata into the agent's own context.

Two committed tests assert the corpus file's literal contents —
`radius-radius.test.ts` (the `covers` globs, and that the raw file contains `test_id: T-3`)
and `fixture-claims.prop.test.ts` (`designedTest.testId` reads `T-3`) — so making T-3
Kane-valid is a metadata-contract change across the reader, the radius and those two
suites. That is a follow-up stage, not this one. Until it lands, **no corpus test can be
run by Kane**, which blocks the live loop from stage 8 onward. The probe kept the spike
unblocked; it does not fix the corpus.

The probe carries no `test_id` and no `covers` deliberately: it mints no promise, it is
not one of the eight claims, and nothing in KEPT reads it.

## Follow-ups this capture creates

Each has a committed stream to test against, so none of them needs Kane to be re-run.

1. **Key rule 1 of §6.2 on `verdict.family` before `verdict.confirmed`**, so an
   `application_issue` whose citations were not mechanically verifiable routes
   `code-break`. Inside `src/verdict/`; input is `docs/kane/spike/t3-replay-failed.ndjson`.
2. **Teach the evidence resolver that a sealed pack is a `.evidence` zip**, and the
   `failure.yaml` loader that the categorised note is nested per failure with the category
   at `triage.rca.category`. Input is `docs/kane/spike/pack-*.yaml` and `pack-listing.txt`.
3. **Give the Kane contract table `testmd run`'s real terminal event, `test_md_done`**, and
   the six per-step `run_end` events it emits before it. The last-wins rule makes today's
   parser correct by luck rather than by contract, and luck is not a fence.
4. **Reconcile the corpus with Kane's `_test.md` format**, per the collision above.
5. **Read the failing replay's credits off `verdict.credits_consumed`**, since a failing
   replay reports its investigation charge nowhere else.
