/**
 * The docs-triggered loop, recorded as one live cycle (task 22.2, design §11.4, §13.2.3,
 * R5.5, R5.7, R5.8, R5.9, R5.10, R5.11).
 *
 * ## What was run, and what it cost
 *
 * A ninth claim was added to `apps/fixture/README.md` describing behaviour the fixture
 * provably does not implement: that the Shop screen keeps the selected roast filter
 * across a full page reload. The filter is `useState` over a static array and the
 * module's own header says so, so the claim was false the moment it was written, which
 * is the point. A designed test was authored for it against a real Chrome, Kane was
 * asked to run it, and the claim was then reverted. The captures under
 * `docs/kane/loop/t9-*` are the record, this suite asserts them, and the lie is not in
 * the tree: `apps/fixture/README.md` is back to its committed content and its pinned
 * sha256 still holds, which `fixture-claims.prop.test.ts` and `committed-snapshot.test.ts`
 * both enforce independently of this file.
 *
 * The authoring run cost **41.354 credits** across four `run_end` events. Every figure
 * quoted below is read out of the committed capture rather than transcribed.
 *
 * ## What the cycle proved, which is not what the task predicted
 *
 * Task 22.2 predicted the new member would fail, the router would answer `docs-lie`, and
 * §8.1.1 would withhold the write path because the promise was never proven. None of the
 * three happened. The member was excluded from the blast radius instead, with a `warn`
 * diagnostic naming it, because Kane's plan carried no `test_id` for it.
 *
 * **The first reading of that was wrong, and correcting it is worth more than the
 * original conclusion was.** This header used to argue that the exclusion was permanent:
 * that Kane commits a recording only on a passing run, so a test for a false claim can
 * never earn an identifier, so such a claim is permanently `stale` and can never be
 * `red`. It is a tidy argument and the tree contradicts it.
 * `docs/kane/loop/t9-recording-meta-after-failed-author.json` is this run's own recording
 * metadata, and the run that **failed** wrote
 * `test_id: a2bda3fb-07fd-4c0f-a9e7-85e66e878625` with `run_kind: author` and
 * `status: broken`. T-7 says the same thing from four days earlier: its authoring run
 * reported `commit: {committed: false, reason: run_failed}`, and `cart_discount_test.md`
 * carries an identifier in this very plan capture and is replayed by every suite run
 * here. A failed authoring run mints an identifier.
 *
 * So the real reason is the **timeline**, and it is duller and more useful. The plan was
 * cached at `11:55:28Z`, both verifications ran inside the next ninety seconds, and the
 * authoring run only finished at `12:01`. The member was excluded because the plan
 * predated its recording, which is §7.2's ten-minute cache doing exactly what §7.2 says.
 * No verification was run after the authoring run at all, so the last three steps of
 * §11.4 are **untested here rather than unreachable**. What this cycle does establish is
 * an ordering §11.4 never stated: author, refresh the plan, then verify.
 *
 * Whether the member would then have gone red was recorded **open**, in A20 and in design
 * §7.2.1, because settling it cost one `kept verify --changed` against a refreshed plan.
 * The first block of assertions below is deliberately only about what the first cycle's
 * bytes support: that the exclusion happened, that it was diagnosed by name, and that
 * refusing to guess an identifier from a filename is correct.
 *
 * ## The second cycle: that run was made, and it settles two of the three predictions
 *
 * The same claim was re-added, the same test document re-authored live, the plan
 * refreshed, and `kept verify --changed apps/fixture/app/shop/page.tsx` run against it.
 * The captures are `docs/kane/loop/t9b-*` and the last describe block asserts them.
 *
 *   1. **The member was selected.** Its recording identifier
 *      `1080f892-b002-43f4-b123-16dc4ea3837b` is in the radius and
 *      `tests/shop_filter_persist_test.md` is in the command Kane was handed. So the
 *      ordering this file inferred, author then refresh the plan then verify, is
 *      demonstrated rather than deduced, and A20 is closed.
 *   2. **The member failed, and the promise went `red`.** Not `stale`. It carries a real
 *      verdict source with `resultCode: 330`, `reasonCode: stuck.ap_stuck`, and
 *      10.80946 credits. A claim admitted today *can* go red, which is the stronger
 *      conclusion this header already refused to rule out.
 *   3. **The router answered `test-drift`, not `docs-lie`, for the third time running.**
 *      Kane reported `confirmed: false`, so R6.4's inline verdict object outranks the
 *      numeric code and the failure is attributed to the test rather than the product.
 *      The prediction in task 22.2's fourth bullet is now measured wrong rather than
 *      assumed wrong, on a second independent claim.
 *   4. **`kept amend propose` therefore staged nothing, and said so.** §8.1.1's rule is
 *      that an amendment is only proposed for the branch the router already settled, so
 *      an empty proposal off a `test-drift` run is the interlock working. That refusal
 *      was invisible in the human summary until this cycle exposed it; the fix and its
 *      test are in `amend.test.ts`.
 *
 * The authoring run cost **36.8983 credits** over four `run_end` events, and the failing
 * member's judgement a further **10.80946**. The `docs-lie` branch remains demonstrated
 * on T-7, whose amendment renders on `/amendments`.
 *
 * ## What does survive, and it explains `staleCount`
 *
 * The five self-cited promises from stage 26 have three designed tests between them, and
 * all three carried no `test_id` in the first plan capture. Unlike the case above, none of
 * the three had ever been through an authoring run **at all**, so no recording existed for
 * the plan to read. They were not waiting on somebody remembering to run them; they were
 * waiting on the run that would mint the identifier. "Designed but not yet proven" was
 * true and incomplete, and `docs/kane/loop/t9-testrun-plan-test-ids.json` is where anyone
 * can check the fuller reason instead of taking it on trust.
 *
 * **One of the three has since been authored**, `tests/kept_badge_endpoint_test.md`, which
 * is why `README.md:679` is `proven` and `staleCount` reads 4 rather than 5. That capture
 * is kept as it was written, showing all three identifiers null, because it is a
 * transcript of what Kane reported on the day it ran.
 *
 * ## The finding that matters most for the argument of the whole project
 *
 * KEPT's central claim about Kane is that Kane treats the designed test as the
 * specification, so it cannot report "the claim is false": a genuine regression and a
 * claim invented to be false both come back as the application being at fault, and KEPT
 * settles it on the promise's own prior verdict instead, because you cannot break what
 * was never proven to work.
 *
 * This run produced a **third** answer to the same situation. Kane blamed **itself**.
 * Both `test_md_bug_verdict` events came back `confirmed: false` with
 * `family: automation_bug` at 0.82 and 0.84 confidence, titled "Agent stalls instead of
 * completing dark roast state assertion" and "Dark roast persistence check reached All
 * roasts state". The second one's own summary describes the fixture's true and correct
 * behaviour, that after a reload the page is on All roasts, and files it as the agent's
 * mistake.
 *
 * That strengthens the argument rather than complicating it. Across the corpus, one
 * unchanged kind of failure, a claim that was never true, has now drawn
 * `application_issue` at 0.95 confidence on T-7 and `automation_bug` at 0.84 on this
 * one. The category moves; what never appears is a category meaning the claim is false,
 * because from where Kane stands the claim cannot be false. The evidence KEPT settles it
 * on is evidence Kane does not have.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function read(relative: string): string {
  return readFileSync(`${REPO_ROOT}${relative}`, 'utf8');
}

/** Every JSON object on its own line, in order. Non-JSON preamble is skipped (R3.23). */
function events(relative: string): readonly Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of read(relative).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      /* A truncated tail is a fact about the capture, not a reason to fail here. */
    }
  }
  return out;
}

function ofType(stream: readonly Record<string, unknown>[], type: string) {
  return stream.filter((event) => event['type'] === type);
}

/** A `kept … --json` capture written through the harness, which prefixes its own lines. */
function keptJson(relative: string): Record<string, unknown> {
  const text = read(relative);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  expect(start, `${relative} carries no JSON object`).toBeGreaterThan(-1);
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

const AUTHOR_CAPTURE = 'docs/kane/loop/t9-shop_filter_persist-author.ndjson';
const DOCS_CHANGE = 'docs/kane/loop/t9-verify-docs-change-empty-radius.stdout.json';
const SOURCE_CHANGE = 'docs/kane/loop/t9-verify-source-change-skipped.stdout.json';
const PLAN = 'docs/kane/loop/t9-testrun-plan-test-ids.json';

const AUTHOR = events(AUTHOR_CAPTURE);

/**
 * The second cycle (task 22.2, A20), and a note about which of its captures survive.
 *
 * **Five of this cycle's captures were destroyed and are not coming back.** iCloud Drive
 * hollowed out 194 files in this repository, keeping their metadata and dropping their
 * contents, and among them were `t9b-verify-changed.stdout.txt`,
 * `t9b-verify-changed.member.ndjson`, `t9b-recording-meta.json`,
 * `t9b-promise-line21-red.json` and `t9b-amend-propose.stdout.json`. The committed history
 * could not help, because they had never been committed. They are recorded here as lost
 * rather than reconstructed from a console transcript, because a capture retyped from
 * memory is not a capture, and a suite that cannot tell the difference is worse than one
 * clause short.
 *
 * What survived is `t9b-handoff.json`, and it turns out to carry every fact those files
 * carried, in a better form: the handoff is the structured record KEPT wrote for the run,
 * so the blast radius, the command Kane was handed, the per-promise verdict, the previous
 * verdict, the routed repair, Kane's own verdict object and the fenced next action are all
 * fields rather than lines of printed text. The assertions below were moved onto it. Two
 * figures did go with the lost files, the failing member's `resultCode`/`reasonCode` pair
 * and its credit charge, because those live on the promise record in `.kept/state.json`
 * rather than in the handoff; where they used to be asserted there is now a note saying so.
 */
const AUTHOR_2_CAPTURE = 'docs/kane/loop/t9b-shop_filter_persist-author.ndjson';
const PLAN_2 = 'docs/kane/loop/t9b-testrun-plan-test-ids.json';
/** The structured record of the verification run, and the backbone of this block. */
const HANDOFF_2 = 'docs/kane/loop/t9b-handoff.json';
/** What `kept amend propose` printed, which is itself the defect this cycle found. */
const AMEND_2_HUMAN = 'docs/kane/loop/t9b-amend-propose.stdout.txt';

const AUTHOR_2 = events(AUTHOR_2_CAPTURE);

/** The recording identifier the second cycle's authoring run minted. */
const TEST_ID_2 = '1080f892-b002-43f4-b123-16dc4ea3837b';
/** The verification run that selected it. */
const RUN_ID_2 = 'be3de265-0fbd-498b-ad8f-54eb3afb62d8';
/** The promise the ninth claim became, and the only one this cycle moved. */
const PROMISE_2 = 'p_77fa3fec8d54';

/** The handoff, parsed once: this block's primary source. */
function handoff2(): Record<string, unknown> {
  return keptJson(HANDOFF_2);
}

/** The handoff result for the ninth claim, at line 21 of the fixture README. */
function line21Result(): Record<string, unknown> {
  const results = handoff2()['results'] as readonly Record<string, unknown>[];
  const found = results.find((entry) => {
    const citation = entry['citation'] as Record<string, unknown> | undefined;
    return citation?.['line'] === 21;
  });
  expect(found, 'the handoff carries no result for the ninth claim').toBeDefined();
  return found as Record<string, unknown>;
}

/* ─────────────── the capture is a real one, and long enough to mean something ─────── */

describe('the authoring run is recorded, not described', () => {
  it('is a real capture of a real run', () => {
    expect(AUTHOR.length).toBeGreaterThan(60);
    expect(read('docs/kane/loop/t9-shop_filter_persist-author.exit.txt')).toContain('exit=');
    /* Five `run_end` events over four steps: the three that reach the screen, select the
       filter and reload each passed once, and the assertion step ran twice and failed
       twice. Both attempts are charged and both are in the total below, which is the
       reason this count is asserted rather than assumed from `steps.total`. */
    const runs = ofType(AUTHOR, 'run_end');
    expect(runs).toHaveLength(5);
    expect(runs.filter((run) => run['status'] === 'passed')).toHaveLength(3);
    expect(runs.filter((run) => run['status'] === 'failed')).toHaveLength(2);
  });

  it('bifurcated into two test cases, which is why it cost what it did', () => {
    /* Four `bifurcation` events and **two** terminal `test_md_done` events carrying two
       different `testcase_id` values. Kane split the document and ran it twice, and both
       halves reached the same place: three steps passed, the assertion failed, nothing
       committed. That is the largest single reason this document cost more than any of
       the eight in the corpus. It is asserted rather than glossed because a reader
       reconciling the credit figure against a four-step test would otherwise conclude the
       arithmetic was wrong.

       It also means a consumer of this stream must not assume one terminal event per
       invocation, which is precisely why §4.2 reads the *first* accepted terminal rather
       than the last, and why the parser retains the second instead of treating it as a
       protocol error. */
    expect(ofType(AUTHOR, 'bifurcation')).toHaveLength(4);
    const dones = ofType(AUTHOR, 'test_md_done');
    expect(dones).toHaveLength(2);
    for (const done of dones) expect(done['overall_status']).toBe('failed');

    const summaries = ofType(AUTHOR, 'test_md_summary');
    expect(summaries).toHaveLength(2);
    const ids = new Set(
      summaries.map((summary) => (summary['commit'] as Record<string, unknown>)['testcase_id']),
    );
    expect(ids.size, 'the two halves reported one test case, so this was not a bifurcation').toBe(
      2,
    );
  });

  it('authored every step rather than replaying any, which is what it cost', () => {
    // Both halves agree, so this reads the shape rather than one arbitrary half.
    for (const summary of ofType(AUTHOR, 'test_md_summary')) {
      expect(summary['steps']).toEqual({
        total: 4,
        passed: 3,
        failed: 1,
        skipped: 0,
        replay_decisions: 0,
        author_decisions: 4,
      });
    }
  });

  it('reports the credits it consumed, summed off the terminal events', () => {
    const total = ofType(AUTHOR, 'run_end').reduce(
      (sum, event) => sum + (typeof event['credits_consumed'] === 'number' ? event['credits_consumed'] : 0),
      0,
    );
    /* 41.354 credits over five charges, which is the dearest single document in this
       repository: the eight corpus documents run from 6.713 to 38.711, itemised per step
       in `docs/kane/credits.md`. It is dear because Kane split the document in two and
       the assertion step was attempted twice, and neither attempt could succeed, the
       claim being false, so the run paid twice for the same impossibility. It is also a
       stream figure and therefore a floor: no `kane-cli balance` reading was taken either
       side of it, and `credits.md` measures a stream at about 92 percent of the true
       cost. */
    expect(Number(total.toFixed(3))).toBe(41.354);
  });

  it('failed on the step that asserts the claim, not on reaching the screen', () => {
    // Steps 1 to 3 reach the shop, select the dark roast filter and reload. Step 4 is
    // the claim. A run that fell over earlier would prove nothing about the claim.
    const summary = ofType(AUTHOR, 'test_md_summary')[0];
    expect(summary?.['overall_status']).toBe('failed');
    for (const verdict of ofType(AUTHOR, 'test_md_bug_verdict')) {
      expect(verdict['step_index'], 'a verdict landed on a step other than the assertion').toBe(4);
    }
  });
});

/* ───────────── Kane's third answer to a claim that was never true ─────────────────── */

describe('Kane cannot report that the claim is false, and here it blamed itself', () => {
  const verdicts = ofType(AUTHOR, 'test_md_bug_verdict');

  it('produced two verdicts, and neither confirms a product fault', () => {
    expect(verdicts).toHaveLength(2);
    for (const verdict of verdicts) {
      expect(verdict['confirmed'], 'Kane confirmed a product fault on a false claim').toBe(false);
      expect(verdict['family']).toBe('automation_bug');
    }
  });

  it('named the agent rather than the product or the claim', () => {
    expect(verdicts.map((verdict) => verdict['category']).sort()).toEqual([
      'agent_misstep',
      'state_transition_bug',
    ]);
    for (const verdict of verdicts) {
      expect(typeof verdict['confidence']).toBe('number');
      expect(verdict['confidence'] as number).toBeGreaterThan(0.8);
    }
  });

  it('described the fixture’s true behaviour while filing it as its own mistake', () => {
    /* The sentence this whole suite is worth reading for. The Shop screen genuinely
       resets to All roasts after a reload, which is exactly what the claim denied, and
       Kane reported observing it as the reason the agent got stuck. */
    const summaries = verdicts.map((verdict) => String(verdict['one_liner'] ?? ''));
    expect(summaries.some((line) => /All roasts/.test(line))).toBe(true);
    expect(summaries.some((line) => /not because .* proven defect|agent/i.test(line))).toBe(true);
  });

  it('answers differently from T-7, on the same underlying situation', () => {
    // T-7's authoring run called the never-true discount claim a confirmed product fault
    // at 0.95. This one called a never-true persistence claim the agent's fault at 0.84.
    // The category moves run to run; no category ever means "the claim is false".
    const t7 = ofType(events('docs/kane/corpus/t7-cart_discount-author.ndjson'), 'test_md_bug_verdict');
    expect(t7).toHaveLength(1);
    expect(t7[0]?.['confirmed']).toBe(true);
    expect(t7[0]?.['family']).toBe('application_issue');
    expect(t7[0]?.['family']).not.toBe(verdicts[0]?.['family']);
  });
});

/* ─────────── why a newly authored false claim can never become red ───────────────── */

describe('the member was excluded because the plan predated its recording', () => {
  it('minted an identifier even though the run failed, which is the correction', () => {
    /* The assertion that killed the tidier conclusion. See the header: the argument that
       a false claim can never be verified rested on a failed run leaving no recording,
       and it does leave one. Pinned here so the corrected reading cannot quietly revert
       to the wrong one. */
    const meta = JSON.parse(read('docs/kane/loop/t9-recording-meta-after-failed-author.json')) as {
      readonly test_id: string;
      readonly executions: readonly { readonly run_kind: string; readonly status: string }[];
    };
    expect(meta.test_id).toBe('a2bda3fb-07fd-4c0f-a9e7-85e66e878625');
    expect(meta.executions).toHaveLength(1);
    expect(meta.executions[0]?.run_kind).toBe('author');
    expect(meta.executions[0]?.status).toBe('broken');
  });

  it('holds a plan captured before that recording existed', () => {
    // The plan is the reason the member was skipped, and it is older than the identifier
    // above. That ordering is the whole explanation, and it is checkable.
    const plan = JSON.parse(read(PLAN)) as { readonly capturedAt: string };
    expect(new Date(plan.capturedAt).getTime()).toBeLessThan(
      new Date('2026-08-25T12:00:55.659Z').getTime(),
    );
  });

  it('was not committed, and says why, on both halves of the bifurcation', () => {
    const summaries = ofType(AUTHOR, 'test_md_summary');
    expect(summaries).toHaveLength(2);
    for (const summary of summaries) {
      const commit = summary['commit'] as Record<string, unknown>;
      expect(commit['committed']).toBe(false);
      expect(commit['reason']).toBe('run_failed');
    }
  });

  it('leaves the document in Kane’s plan carrying no test id', () => {
    const plan = JSON.parse(read(PLAN)) as {
      readonly members: readonly { readonly path: string; readonly testId: string | null }[];
    };
    const byName = new Map(
      plan.members.map((member) => [member.path.split('/').slice(-1)[0] ?? '', member.testId]),
    );
    expect(byName.get('shop_filter_persist_test.md'), 'the new document earned an id').toBeNull();
    // The recorded eight all carry one, so the absence above is a property of this
    // document rather than of the capture.
    expect(byName.get('shop_filter_test.md')).toBeTruthy();
    expect(byName.get('cart_discount_test.md')).toBeTruthy();
  });

  it('is not the reason the five self-cited promises are stale, though they look alike', () => {
    /* The two cases share a symptom and not a cause. This document had a recording and a
       stale plan. These three have **no recording at all**, because none has ever been
       through an authoring run, so there is nothing for any plan refresh to pick up and
       `verify --changed` cannot select them however the radius is computed. That is the
       whole explanation for `staleCount: 5`, and it is checkable here rather than only
       assertable in prose. */
    const plan = JSON.parse(read(PLAN)) as {
      readonly members: readonly { readonly path: string; readonly testId: string | null }[];
    };
    const unidentified = plan.members
      .filter((member) => member.testId === null || member.testId === undefined)
      .map((member) => member.path.split('/').slice(-1)[0] ?? '')
      .filter((name) => name.startsWith('kept_'))
      .sort();
    expect(unidentified).toEqual([
      'kept_badge_endpoint_test.md',
      'kept_demo_boot_test.md',
      'kept_self_claims_test.md',
    ]);
  });
});

/* ───────────────── what the two verification runs actually reported ──────────────── */

describe('the verification runs report the radius honestly', () => {
  it('puts nothing in the radius for a documentation change', () => {
    /* The blast radius is computed from changed **source** against each test's `@covers`
       fence, so editing a README selects no member at all. That is correct and it is the
       reason `reconcile --changed` exists as a separate command: a documentation edit is
       answered by staging held changes, not by re-running browser tests. */
    const result = keptJson(DOCS_CHANGE);
    expect(result['scope']).toBe('changed');
    expect((result['members'] as readonly unknown[]).length).toBe(0);
    const diagnostics = result['diagnostics'] as readonly Record<string, unknown>[];
    const completed = diagnostics.find((entry) => entry['code'] === 'verify-completed');
    expect(String(completed?.['message'])).toContain('0 member(s) in the radius');
  });

  it('selects the recorded members for a source change, and says what it skipped', () => {
    const result = keptJson(SOURCE_CHANGE);
    const members = result['members'] as readonly Record<string, unknown>[];
    expect(members.map((member) => member['path']).sort()).toEqual([
      'tests/home_cta_test.md',
      'tests/shop_filter_test.md',
    ]);
    for (const member of members) expect(member['status']).toBe('passed');

    const radius = result['radius'] as Record<string, unknown>;
    expect(radius['skippedNoTestId']).toEqual(['tests/shop_filter_persist_test.md']);
    expect(radius['unmatchedPaths']).toEqual([]);
  });

  it('names the exclusion in a diagnostic rather than dropping it silently', () => {
    const diagnostics = keptJson(SOURCE_CHANGE)['diagnostics'] as readonly Record<
      string,
      unknown
    >[];
    const skipped = diagnostics.find((entry) => entry['code'] === 'radius-member-no-test-id');
    expect(skipped, 'the skipped member was not diagnosed').toBeDefined();
    expect(skipped?.['severity']).toBe('warn');
    const message = String(skipped?.['message']);
    expect(message).toContain('tests/shop_filter_persist_test.md');
    expect(message).toContain('never guessed from a path or a filename');
  });

  it('proposed no repair, because the run proved nothing repairable', () => {
    /* §8.1.1. Both selected members passed, so there is nothing to repair, and the
       withheld fence forbids every glob a granted one would have allowed. The two
       promises that could have been repaired were never proven, and this is the shape
       that refusal takes on the wire. */
    const next = keptJson(SOURCE_CHANGE)['nextAction'] as Record<string, unknown>;
    expect(next['branch']).toBeNull();
    expect(next['autonomy']).toBe('none');
    expect(next['allowedPaths']).toEqual([]);
    expect(next['command']).toBeNull();
    const forbidden = next['forbiddenPaths'] as readonly string[];
    for (const glob of ['tests', 'tests/**', 'README.md', 'apps/fixture/README.md']) {
      expect(forbidden, `${glob} is not forbidden by a withheld fence`).toContain(glob);
    }
  });
});

/* ────────────────────────── the lie does not survive (R5.11) ─────────────────────── */

describe('nothing the cycle wrote is still in the tree', () => {
  it('leaves the fixture README at its committed content', () => {
    const text = read('apps/fixture/README.md');
    expect(text).not.toContain('keeps the selected roast filter');
    // Eight claims again, one per line, exactly as the document says of itself.
    const claims = text
      .split('\n')
      .filter((line) => line.startsWith('- The ') && line.trimEnd().endsWith('.'));
    expect(claims).toHaveLength(8);
  });

  it('leaves no designed test citing the reverted line', () => {
    const corpus = read('docs/kane/loop/t9-testrun-plan-test-ids.json');
    // The capture names it, deliberately: it is the record. The corpus must not.
    expect(corpus).toContain('shop_filter_persist_test.md');
    let present = true;
    try {
      read('tests/shop_filter_persist_test.md');
    } catch {
      present = false;
    }
    expect(present, 'the designed test for the reverted claim is still in the corpus').toBe(false);
  });
});

/* ───────── the second cycle: the run the first one left open (A20 closed) ───────── */

/**
 * Everything here is read out of `docs/kane/loop/t9b-*`, and every one of these
 * assertions was unwritable before that cycle ran.
 *
 * The first cycle could not settle the last three steps of §11.4 because its plan was
 * cached before the authoring run finished, so the new member was excluded and the
 * verification never touched it. This block asserts the same manoeuvre with the plan
 * refreshed in between: the member is selected, it fails, the promise goes `red`, and
 * the amendment is withheld because the router settled a different branch.
 *
 * Two of task 22.2's four predictions come out right and one comes out wrong, and the
 * wrong one is asserted as wrong rather than quietly dropped: the router answered
 * `test-drift`, for the same measured reason it has answered it before, that Kane
 * reported `confirmed: false` about a claim that was never true.
 */
describe('the second cycle selected the member, and it went red', () => {
  it('is a real capture, and the authoring run failed on the step that is the claim', () => {
    expect(AUTHOR_2.length).toBeGreaterThan(60);
    const runs = ofType(AUTHOR_2, 'run_end');
    /* Four steps, four `run_end` events, no retry: reach the shop, press Dark roast,
       reload, then assert the filter survived. The first three passed and the fourth
       did not, which is the fixture behaving correctly against a false claim. */
    expect(runs).toHaveLength(4);
    expect(runs.filter((run) => run['status'] === 'passed')).toHaveLength(3);
    expect(runs.filter((run) => run['status'] === 'failed')).toHaveLength(1);

    const summary = ofType(AUTHOR_2, 'test_md_summary')[0];
    expect(summary?.['overall_status']).toBe('failed');
    const steps = summary?.['steps'] as Record<string, unknown> | undefined;
    expect(steps?.['total']).toBe(4);
    expect(steps?.['failed']).toBe(1);
    /* Every step was authored rather than replayed, which is why it cost anything. */
    expect(steps?.['author_decisions']).toBe(4);
  });

  it('cost 36.8983 credits, summed from the capture rather than transcribed', () => {
    const total = ofType(AUTHOR_2, 'run_end').reduce((sum, run) => {
      const charged = run['credits_consumed'];
      return sum + (typeof charged === 'number' ? charged : 0);
    }, 0);
    expect(total).toBeCloseTo(36.8983, 3);
  });

  it('minted an identifier even though the run failed and nothing was committed', () => {
    /* The point the first cycle's header had to correct, restated on fresh evidence.
       Kane declined to commit the recording and still wrote one carrying an identifier,
       so a claim that was never true is not permanently unverifiable: the authoring run
       pays for the identifier whether it passes or not.
     *
     * This used to read the recording's own `meta.json`, copied to
     * `t9b-recording-meta.json`, which the iCloud incident destroyed. The same fact is
     * established by two surviving captures together, and arguably better, because they
     * come from opposite ends of the cycle: Kane's authoring summary says it committed
     * nothing, and the verification handoff records an identifier for that very document.
     * A recording is the only thing that can put an id there. */
    const summary = ofType(AUTHOR_2, 'test_md_summary')[0];
    const commit = summary?.['commit'] as Record<string, unknown> | undefined;
    expect(summary?.['overall_status']).toBe('failed');
    expect(commit?.['committed']).toBe(false);
    expect(commit?.['reason']).toBe('run_failed');

    /* And yet the document has an identifier, on both the plan and the run. */
    const plan = keptJson(PLAN_2)['members'] as readonly Record<string, unknown>[];
    const member = plan.find((e) => e['path'] === 'tests/shop_filter_persist_test.md');
    expect(member?.['testId']).toBe(TEST_ID_2);
    expect(line21Result()['testId']).toBe(TEST_ID_2);
    expect(line21Result()['designedTest']).toBe('tests/shop_filter_persist_test.md');
  });

  it('put the identifier in the refreshed plan, which is what the first cycle lacked', () => {
    const plan = keptJson(PLAN_2);
    const members = plan['members'] as readonly Record<string, unknown>[];
    const member = members.find(
      (entry) => entry['path'] === 'tests/shop_filter_persist_test.md',
    );
    expect(member, 'the refreshed plan does not carry the authored document at all').toBeDefined();
    expect(
      member?.['testId'],
      'the plan reports no identifier for the document, which is the state the first ' +
        'cycle was stuck in and the whole reason this one refreshed the plan',
    ).toBe(TEST_ID_2);
  });

  it('selected the member into the blast radius and handed it to Kane', () => {
    /* The claim the whole second cycle exists to establish, and the one the first cycle
       could not: with the plan refreshed, the new member is actually selected.
     *
       Read off the handoff rather than off the printed summary the incident destroyed,
       which is a stricter reading of the same thing: `blastRadius.testIds` is the set
       KEPT computed, and `command.argv` is what it handed Kane. Both are asserted,
       because the radius is a set of identifiers and the command is a list of paths, and
       a cycle that got one without the other would not have run the member. */
    const handoff = handoff2();
    expect(handoff['runId']).toBe(RUN_ID_2);

    const radius = handoff['blastRadius'] as Record<string, unknown>;
    expect(radius['testIds']).toContain(TEST_ID_2);
    expect(radius['promiseIds']).toContain(PROMISE_2);
    /* Nothing was skipped for want of an identifier, which is precisely what happened on
       the first cycle and is the difference the plan refresh made. */
    expect(radius['skippedNoTestId']).toStrictEqual([]);
    expect(radius['unmatchedPaths']).toStrictEqual([]);

    const command = handoff['command'] as Record<string, unknown>;
    expect(command['family']).toBe('ExecutionTestrun');
    expect(command['invoked']).toBe(true);
    const argv = command['argv'] as readonly string[];
    expect(argv.slice(0, 2)).toStrictEqual(['testrun', 'run']);
    expect(argv).toContain('tests/shop_filter_persist_test.md');
    /* Never `--agent` on a verification, and never `--from-context`. */
    expect(argv).not.toContain('--agent');
    expect(argv).not.toContain('--from-context');

    const outcome = handoff['outcome'] as Record<string, unknown>;
    expect(outcome['terminalSeen']).toBe(true);
    expect(outcome['terminalEventType']).toBe('testrun_done');
    expect(outcome['exitMeaning']).toBe('failure');
    /* A terminal event was seen, so verdicts were permitted to be written (§4.8). */
    expect(outcome['verdictsPermitted']).toBe(true);
    expect((handoff['results'] as readonly unknown[]).length).toBe(3);
  });

  it('moved the promise from stale to red, and only that promise', () => {
    /* The second prediction of task 22.2, and it held. A claim admitted today can go
       red: this one did, and the handoff records both ends of the transition, so the
       move is asserted rather than the destination alone. `stale` to `red` is the
       interesting edge, because the first cycle could only leave it at `stale`. */
    const result = line21Result();
    expect(result['promiseId']).toBe(PROMISE_2);
    expect(result['previousVerdict']).toBe('stale');
    expect(result['verdict']).toBe('red');
    expect(result['memberStatus']).toBe('failed');

    const citation = result['citation'] as Record<string, unknown>;
    expect(citation['file']).toBe('apps/fixture/README.md');
    expect(citation['line']).toBe(21);
    expect(String(citation['text'])).toContain('keeps the selected roast filter');

    /* The other two members of the same run passed and stayed proven, so the run moved
       exactly the promise whose claim was false and nothing else (R4.15). */
    const results = handoff2()['results'] as readonly Record<string, unknown>[];
    const moved = results.filter((entry) => entry['verdict'] !== entry['previousVerdict']);
    expect(moved.map((entry) => entry['promiseId'])).toStrictEqual([PROMISE_2]);
    for (const entry of results) {
      if (entry['promiseId'] === PROMISE_2) continue;
      expect(entry['verdict']).toBe('proven');
      expect(entry['memberStatus']).toBe('passed');
    }

    /* **Two figures are no longer asserted here, and this is the note that says why.**
       The failing member's `resultCode: 330` / `reasonCode: stuck.ap_stuck` and its
       10.80946 credit charge lived on the promise record in `.kept/state.json`, captured
       to `t9b-promise-line21-red.json`, which the iCloud incident destroyed. They are not
       in the handoff, whose `outcome` reports the process-level codes as null for this
       family, so there is nothing surviving to read them from. Restated from a transcript
       they would be numbers this suite asserts against itself, which is not evidence. */
    const outcome = handoff2()['outcome'] as Record<string, unknown>;
    expect(outcome['resultCode']).toBeNull();
    expect(outcome['reasonCode']).toBeNull();
  });

  it('routed it to test-drift, which is the third prediction and it is wrong', () => {
    /* Task 22.2 predicted `docs-lie` here. It is not what happened, and it is not what
       happened on T-7 either on the runs where Kane answered `confirmed: false`. The
       reason is R6.4: an inline verdict object outranks the numeric result code, and
       Kane's object says it did not confirm a product bug, so the failure is attributed
       to the test. Pinning `docs-lie` would pin a coin flip; pinning `test-drift` here
       pins what this run actually produced, and the rationale is asserted so a future
       reader can see the rule that produced it. */
    const result = line21Result();
    const repair = result['repair'] as Record<string, unknown>;
    expect(repair['branch']).toBe('test-drift');
    expect(repair['strategy']).toBe('resultCode740');
    expect(String(repair['rationale'])).toContain('confirmed as false');
    expect(String(repair['rationale'])).toContain('outranks the numeric code');
    /* Kane's own category, carried through verbatim rather than re-derived. */
    expect(repair['category']).toBe('state_transition_bug');

    /* Kane's verdict object, which is the thing R6.4 says outranks the numeric code, kept
       beside the branch it produced so the rule and its input are asserted together. */
    const verdict = result['verdictObject'] as Record<string, unknown>;
    expect(verdict['confirmed']).toBe(false);
    expect(verdict['family']).toBe('automation_bug');

    /* And the fence the branch carries: `test-drift` holds the change as a review card
       for a human and grants no write path at all. `allowedPaths` empty is the assertion
       task 22.2 asked for, and it lands on this branch rather than on `docs-lie`. */
    const next = handoff2()['nextAction'] as Record<string, unknown>;
    expect(next['branch']).toBe('test-drift');
    expect(next['autonomy']).toBe('hold');
    expect(next['artefact']).toBe('review-card');
    expect(next['allowedPaths']).toStrictEqual([]);
    /* The claim's own source is on the forbidden side, so no repair could rewrite it. */
    expect(next['forbiddenPaths']).toContain('apps/fixture/README.md');
  });

  it('never let Kane report the claim false: it blamed the test again', () => {
    /* The finding the first cycle turned up, reproduced on an independent run. One
       unchanged kind of failure, a claim invented to be false, and Kane's answer moves
       between `application_issue` and `automation_bug` while never once being "the
       claim is false". That is the argument §8.1.1 rests on, and it is now measured
       twice rather than once. */
    const verdicts = ofType(AUTHOR_2, 'test_md_bug_verdict');
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.['confirmed']).toBe(false);
    expect(verdicts[0]?.['family']).toBe('automation_bug');
    for (const verdict of verdicts) {
      expect(
        String(verdict['category'] ?? ''),
        'a category meaning the claim itself is false would undercut §8.1.1',
      ).not.toContain('docs');
    }
  });

  it('staged no amendment, because the run settled no docs-lie to amend', () => {
    /* §8.1.1: an amendment is only ever proposed for the branch the router settled. The
       run settled `test-drift` on its one failure, so `propose` had nothing to work from
       and wrote nothing.
     *
       The `--json` payload that made this explicit was destroyed by the iCloud incident,
       so the precondition is asserted against the handoff instead, which is the input
       `propose` reads: not one result on this run carries a `docs-lie` repair, and
       `docsLieResults` filters on exactly that field. A run with no docs-lie result cannot
       produce an amendment, whatever `propose` prints. */
    const results = handoff2()['results'] as readonly Record<string, unknown>[];
    const docsLie = results.filter((entry) => {
      const repair = entry['repair'] as Record<string, unknown> | null | undefined;
      return repair?.['branch'] === 'docs-lie';
    });
    expect(
      docsLie,
      'a docs-lie result would have given `propose` something to stage, and the point of ' +
        'this cycle is that it had nothing',
    ).toStrictEqual([]);
    /* The run did settle something, so this is not vacuous. */
    expect(results.some((entry) => entry['verdict'] === 'red')).toBe(true);
    expect((handoff2()['nextAction'] as Record<string, unknown>)['branch']).toBe('test-drift');

    /* And the exit code was 0, because a run that settled a different branch is a state of
       the world rather than a failure of KEPT (§14.2). */
    expect(read('docs/kane/loop/t9b-amend-propose.exit.txt').trim()).toBe('0');
  });

  it('printed nothing about the refusal, which is the defect this cycle found', () => {
    /* This capture is the bug report. `kept amend propose` refused correctly and told the
       reader only its own name, the repository path and the run id: three lines, exit 0,
       and no way to tell a refusal from a success. The explanation existed as an
       `amend-no-docs-lie` diagnostic at `info`, and the human form drops `info` on purpose
       so its output is not flooded.
     *
       Kept as evidence rather than regenerated, because a capture of the fixed command
       would no longer show the fault. The fix and its own tests live in `amend.test.ts`,
       which asserts the branch is now named in the summary; this asserts that it was not,
       so the pair reads as a before and an after. */
    const printed = read(AMEND_2_HUMAN);
    expect(printed).toContain('kept amend propose');
    expect(printed).toContain(RUN_ID_2);
    expect(
      printed,
      'the capture already names the branch, so it is no longer a record of the defect ' +
        'and this test is asserting nothing',
    ).not.toContain('test-drift');
    expect(printed).not.toContain('docs-lie');
    /* Three lines and no more, which is the whole complaint. */
    expect(printed.trim().split('\n')).toHaveLength(3);
  });

  it('left nothing of the second cycle in the tree either (R5.11)', () => {
    /* Same revert discipline as the first cycle, asserted separately because it was a
       separate set of writes: the claim, the corpus document and the recording. The
       fixture README's pinned sha256 is enforced elsewhere; what is checked here is that
       none of the three is still present.
     *
     * **The sealed evidence pack is deliberately not asserted here**, and the reason is
     * environmental rather than a shrug. `kept verify` curated one into
     * `apps/ledger/public/evidence/` and the revert deleted it, and this repository sits
     * on an iCloud-synced path where a sync daemon restored the deleted directory a few
     * minutes later. Asserting a working-tree absence that a background process can undo
     * would make this suite fail for a reason that has nothing to do with KEPT.
     *
     * What matters about that pack is not that no byte of it is on this disk but that it
     * was never committed, and that is enforced where it belongs and cannot be undone by
     * a sync: `evidence-integrity.test.ts` requires every pack committed under
     * `apps/ledger/public/evidence/` to be referenced by a promise, a run, a review card
     * or an amendment, so an orphan of this shape fails there against git's own index. */
    const readme = read('apps/fixture/README.md');
    expect(readme).not.toContain('keeps the selected roast filter');
    for (const path of [
      'tests/shop_filter_persist_test.md',
      'tests/output-shop_filter_persist/.internal/meta.json',
    ]) {
      let present = true;
      try {
        read(path);
      } catch {
        present = false;
      }
      expect(present, `${path} survived the revert`).toBe(false);
    }
    /* And the committed snapshot publishes no pack, no run entry and no verdict from this
       cycle, which is the referential half of the same statement.
     *
     * Asserted field by field rather than by scanning the file for the run id, which is
     * what this used to do and was wrong. The snapshot legitimately contains that id, in
     * `coverageAxes.proven.latestRunExecutionId`: `cover gaps` reported it as the newest
     * execution in Kane's assurance graph, and §5.3.0's rule is that the ribbon publishes
     * Kane's report verbatim. Quoting a source is not the same as carrying an artefact,
     * and a substring search could not tell the two apart. */
    const snapshot = JSON.parse(read('apps/ledger/data/ledger.snapshot.json')) as {
      readonly evidence: readonly { readonly id: string }[];
      readonly runs: readonly { readonly id: string }[];
      readonly promises: readonly {
        readonly id: string;
        readonly verdictSource: { readonly runId: string } | null;
      }[];
    };
    expect(snapshot.evidence.map((pack) => pack.id)).not.toContain(`ev_${RUN_ID_2}.evidence`);
    expect(snapshot.runs.map((run) => run.id)).not.toContain(RUN_ID_2);
    expect(
      snapshot.promises.map((promise) => promise.verdictSource?.runId ?? null),
    ).not.toContain(RUN_ID_2);
    expect(snapshot.promises.map((promise) => promise.id)).not.toContain(PROMISE_2);
    /* Thirteen promises again: the ninth fixture claim is not among them. */
    expect(snapshot.promises).toHaveLength(13);
  });
});
