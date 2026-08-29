import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LedgerSnapshot } from 'kept-core';
import {
  SNAPSHOT_SCHEMA_VERSION,
  matchesAnyGlob,
  nodeStateFileSystem,
  normaliseClaim,
  parseSnapshot,
  splitLines,
} from 'kept-core';
import { describe, expect, it } from 'vitest';

import { derivedForbidden, fenceFindings, handoffFenceSurfaces, loadConfig } from '../src/config.js';
import { SNAPSHOT_FILE_RELATIVE_PATH } from '../src/snapshot.js';
import { KEPT_VERSION } from '../src/version.js';

/**
 * The committed snapshot, asserted as an artefact (task 5.6, design §9.1, §9.3,
 * §12.2, R1.3, R2.2, R2.11, R4.14).
 *
 * `apps/ledger/data/ledger.snapshot.json` is the only build output this
 * repository commits, and the whole judge story rests on it: the deployed Ledger
 * reads these bytes and needs no Kane, no Chrome, no credentials and no network.
 * Stage 9 builds the Ledger *from this file*, so if it is wrong, every page is
 * wrong and no unit test elsewhere notices — `snapshot.test.ts` proves the
 * assembler is correct over synthetic states, which is a different claim from "the
 * file in the tree is the honest projection of the real fixture".
 *
 * So this suite reads the committed file off disk and reads both cited documents,
 * `apps/fixture/README.md` and this repository's own root `README.md`, off disk
 * beside it, and requires them to agree line by line. Four things are checked, in
 * the order they can go wrong:
 *
 * 1. **The file is a valid snapshot.** `parseSnapshot` is the schema authority
 *    (§9.1) and runs all five cross-field rules, so a snapshot whose counts,
 *    coverage nullability, evidence references, edge endpoints or freshness
 *    triple disagree with itself fails at import time, naming the path.
 * 2. **Thirteen promises, each cited verbatim.** Every `citation.text` must be
 *    `readFileSync` of the cited document split one-based, not a paraphrase, not a
 *    stale copy, not a trimmed one. That is R1.3's whole content, and the admission
 *    gate overwrites the text from disk precisely so this can be asserted rather than
 *    hoped for. The fixture's claims block is eight lines, one claim per line, so
 *    those cited line numbers must be eight distinct consecutive lines. The other
 *    five are cited to **this repository's own root `README.md`** (§23.1, R19.1),
 *    at the five scattered lines that state something observable rather than prose.
 *
 *    Stage 26 is why the count moved from eight to thirteen, and the five new rows
 *    are the whole point of it: the document making the claims is now also a
 *    document being checked. Nothing in the snapshot distinguishes them from the
 *    fixture's eight except the citation path, which is Property 36's statement,
 *    and this suite asserts that field by field rather than trusting it.
 * 3. **The assurance state is the honest one, and it is clean.** §5.3.0 moved the
 *    coverage axes from `cover --json` to `cover gaps`, which reads them off the
 *    live graph and needs no sealed pack, so the refusal that used to discard the
 *    enrichment axis no longer happens: the file carries `degraded: false`, an empty
 *    `degradedReasons`, a published `provenCoverage` of `8/13`, and the dual axes
 *    beside it at `6/6` designed and `6/6` proven with `1/9` use cases complete.
 *    Neither half of R2.11 is asserted as a state here, because which half applies
 *    moves with Kane. What is asserted is the *rule*: a degraded file names a reason
 *    and withholds the figure, a clean one names no reason and publishes it, and the
 *    two never happen at once. The distinction the rule protects is still worth
 *    stating, since the file records eight `proven` verdicts and one `red` earned by
 *    a real `testrun_done`: a verdict is what KEPT observed, coverage is what Kane's
 *    graph says the observation covers, and the day that graph refuses again the
 *    verdicts stay and the percentage goes.
 *
 * 4. **Every verdict is traceable to the run that earned it.** Nine promises carry
 *    a verdict, and one run earned all of them: the whole-suite replay that followed
 *    the live authoring of `tests/kept_badge_endpoint_test.md`, which re-ran every
 *    recorded member in a single invocation. Each promise still names *its own*
 *    `runId` and instant rather than inheriting one instant covering the file, the
 *    freshness triple names the newest of them, and `memberStatus` is recorded per
 *    promise so `failed` stays distinguishable from `broken` (R4.9). T-7 is `red` on
 *    the never-true discount claim and routes to `docs-lie`; that failure is the
 *    designed deliverable of the corpus, not a defect in this file. The remaining
 *    four promises carry no verdict at all: they are `stale`, and the absence of a
 *    run behind them is asserted just as strictly as the presence of one is.
 *
 * ## What is deliberately not asserted
 *
 * Byte-identity across rebuilds. `generatedAt` and each diagnostic's `at` are
 * instants by design (§9.1), so two runs of `kept build && kept snapshot` differ
 * in exactly those three fields and in nothing else — which is what re-running the
 * build to produce this file confirmed. Everything a reader could act on is
 * reproducible; the timestamps are not, and pinning them would only pin the clock.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The fixture's cited document, repository-relative POSIX, as every citation is. */
const README = 'apps/fixture/README.md';

/** The eight claim lines of §12.2, one claim per line. */
const CLAIM_LINES = [13, 14, 15, 16, 17, 18, 19, 20] as const;

/**
 * This repository's own README, admitted as a promise source by task 26.1
 * (design §23.1, R19.1).
 *
 * One entry in `subject.docs` and three `*_test.md` documents carrying `@verifies`
 * tags is the whole mechanism. There is no second code path: the same admission gate
 * reads the same lines off disk, and `promiseId` keys on the path plus the claim here
 * exactly as it does for the fixture.
 */
const SELF_README = 'README.md';

/**
 * The five self-cited claims, each stating something **observable** rather than prose
 * (§23.1), identified by a fragment of the claim itself:
 *
 * - the demo path invokes Kane zero times and spends zero credits,
 * - `npm run demo` serves the Ledger on 3000 and the fixture on 3100,
 * - the suite passes with no network, no credentials and no Kane,
 * - the deployed artefact carries no non-GET handler and no server action,
 * - `/badge.svg` answers a GET with SVG carrying a whole-number percentage.
 *
 * **This list is a floor, never a ceiling (R19.5, task 26.3).** The assertions below
 * require every one of these five claims to still be admitted and require the
 * self-cited count not to fall, because the cheapest way to raise a coverage figure
 * is to stop admitting the claims nobody has proven, and that is the failure mode of
 * an untested README reproduced inside the tool built to detect it. Adding a sixth
 * self-cited claim is a one-line edit here; removing one is a test failure.
 *
 * ## Why these are fragments and not line numbers
 *
 * This was `[22, 68, 89, 301, 679]`, and the line numbers were the wrong key. A promise
 * is identified by its file and its claim text and never by its position, which is the
 * whole reason inserting a paragraph above a claims block moves every citation down a
 * line without re-keying a single promise. Pinning positions here contradicted that and
 * made the suite fail on any edit to the top of the README, which is a document that gets
 * edited: adding a badge or a sentence to the opening turned five citations red for a
 * reason that had nothing to do with coverage.
 *
 * A fragment is stable under every edit that does not change what the claim says, and it
 * still fails loudly for the thing the floor exists to catch, a claim being dropped. The
 * lines themselves are asserted to resolve verbatim against disk further down, which is
 * where position is genuinely the subject.
 */
const SELF_CITED_CLAIMS = [
  'Kane is invoked zero times, zero credits are spent',
  'npm run demo          # Ledger on :3000, fixture on :3100',
  'No network, no credentials, no Kane.',
  'No non-GET handler, no server action',
  '`/badge.svg` | GET only, `image/svg+xml`',
] as const;

/** Every promise in the file, however cited. */
const TOTAL_PROMISES = CLAIM_LINES.length + SELF_CITED_CLAIMS.length;

/**
 * The designed corpus by `test_id` (§3.4). The map is fixed by the fixture
 * register, so a renamed id here would desynchronise every committed NDJSON
 * fixture as well as this file.
 */
const EXPECTED_DESIGNED_TESTS: Readonly<Record<string, string>> = Object.freeze({
  'T-1': 'tests/shop_filter_test.md',
  'T-2': 'tests/home_cta_test.md',
  'T-3': 'tests/cart_subtotal_test.md',
  'T-4': 'tests/checkout_validation_test.md',
  'T-5': 'tests/orders_persist_test.md',
  'T-6': 'tests/settings_currency_test.md',
  'T-7': 'tests/cart_discount_test.md',
  'T-8': 'tests/product_currency_test.md',
});

/**
 * The three documents that carry the self-cited tags, and the assurance-graph id each
 * has: **none**.
 *
 * That null is load-bearing rather than an omission, and it used to be explained
 * wrongly here. The old note said the null meant "no recording exists, so
 * `testrun_plan` mints no identifier, so `--all` excludes it and all five claims are
 * therefore `stale`". Two of those three links were false. `designedTest.testId` holds
 * Kane's **assurance-graph** id, the `T-n` the enrichment provider reads off
 * `cover gaps` (§3.4), and the plan's `test_id` is a different name space entirely: a
 * recording UUID. The fixture's eight documents are registered use cases and so carry
 * `T-1`..`T-8`; these three were authored as bare corpus documents and are in nobody's
 * use-case graph, which is the whole reason the id is null.
 *
 * `tests/kept_badge_endpoint_test.md` proves the two are independent. It was authored
 * live, it has a recording under `tests/output-kept_badge_endpoint/`, `.kept/plan.json`
 * carries a `test_id` for it, `kept verify --all` selected it, and `README.md:679` is
 * `proven` as a result. Its `designedTest.testId` is still null, because authoring a
 * document does not enrol it as a use case. So the null asserted below is a statement
 * about the assurance graph and about nothing else.
 */
const EXPECTED_SELF_CITED_TESTS: Readonly<Record<string, string>> = Object.freeze({
  'Kane is invoked zero times, zero credits are spent': 'tests/kept_self_claims_test.md',
  'npm run demo          # Ledger on :3000, fixture on :3100':
    'tests/kept_demo_boot_test.md',
  'No network, no credentials, no Kane.': 'tests/kept_self_claims_test.md',
  'No non-GET handler, no server action': 'tests/kept_self_claims_test.md',
  '`/badge.svg` | GET only, `image/svg+xml`': 'tests/kept_badge_endpoint_test.md',
});

/**
 * The claim fragment a self-cited promise matches, or null when it matches none.
 *
 * Keyed on the claim rather than the citation line for the reason given at
 * {@link SELF_CITED_CLAIMS}: position moves whenever the README is edited above a claim,
 * and identity does not.
 */
function fragmentOf(promise: LedgerSnapshot['promises'][number]): string | null {
  return SELF_CITED_CLAIMS.find((fragment) => promise.citation.text.includes(fragment)) ?? null;
}

/**
 * Seven of the eight **fixture** promises passed their replay. The eighth is T-7, the
 * never-true discount claim of `apps/fixture/README.md:20`, which is **designed to
 * fail** on a correct application: the fixture has no discount logic and will never
 * get any, so the failure is the deliverable and the `red` verdict is the honest
 * one. Nothing here may be relaxed to make the count eight.
 *
 * This constant used to be called `PROVEN_COUNT` and used to be the whole story,
 * because every proven verdict in the file was a fixture verdict and `redCount` could
 * be written as `CLAIM_LINES.length - PROVEN_COUNT`. That arithmetic broke the moment
 * a self-cited claim earned a verdict, and it broke in the direction that matters: the
 * one red promise would have had to become zero for the old subtraction to hold. The
 * two counts are separate now so the red one stays attributable to the fixture.
 */
const FIXTURE_PROVEN_COUNT = 7;

/**
 * One of the five self-cited claims is `proven`: `README.md:679`, the `/badge.svg`
 * claim, verified by `tests/kept_badge_endpoint_test.md`.
 *
 * That document was authored live against the running Ledger, which minted a recording
 * and therefore a plan `test_id`, which is what let `kept verify --all` select it. It
 * is the first claim this repository has ever proven **about itself**, and it is the
 * reason `provenCoverage` rose from `7/13` to `8/13`.
 *
 * Raising it further is a matter of authoring the remaining documents, not of editing
 * this constant. Lowering it would mean a self-verification regressed.
 */
const SELF_PROVEN_COUNT = 1;

/** Every promise carrying a `proven` verdict, however cited. */
const PROVEN_COUNT = FIXTURE_PROVEN_COUNT + SELF_PROVEN_COUNT;

/**
 * The remaining four self-cited claims are `stale`: designed by a document, never run.
 *
 * This is the number that made `provenCoverage` fall from `0.875` to `7/13` when the
 * root README entered the graph, and it is supposed to have fallen. A ledger that
 * shows what it owes is the product; one tuned to look complete is the thing this
 * product exists to prevent (§22.1, §23.2, R19.5). It has since moved to `8/13`, and
 * the only thing that moved it was a claim actually being verified.
 */
const STALE_COUNT = SELF_CITED_CLAIMS.length - SELF_PROVEN_COUNT;

/** The README line T-7 asserts, and the only claim in the file that is a lie. */
const DISCOUNT_CLAIM_LINE = 20;

const readRepoFile = (file: string): string =>
  readFileSync(resolve(REPO_ROOT, file), { encoding: 'utf8' });

/**
 * The committed bytes, through the schema. Parsed once at module scope so a file
 * that does not satisfy §9.1 fails the suite at import with the offending path,
 * which is the same message `kept snapshot` would have printed.
 */
const SNAPSHOT: LedgerSnapshot = parseSnapshot(readRepoFile(SNAPSHOT_FILE_RELATIVE_PATH));

/** Each cited document, split exactly as the admission gate splits it. */
const DOCUMENT_LINES: ReadonlyMap<string, readonly string[]> = new Map([
  [README, splitLines(readRepoFile(README))],
  [SELF_README, splitLines(readRepoFile(SELF_README))],
]);

/** The fixture document, kept under its old name for the clauses that only touch it. */
const README_LINES = DOCUMENT_LINES.get(README) as readonly string[];

/** The promises cited to one document, in snapshot order. */
const promisesCitedTo = (file: string): readonly LedgerSnapshot['promises'][number][] =>
  SNAPSHOT.promises.filter((promise) => promise.citation.file === file);

describe('the committed snapshot — schema and provenance', () => {
  it('is a valid snapshot at the current schema version', () => {
    expect(SNAPSHOT.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(Number.isFinite(Date.parse(SNAPSHOT.generatedAt))).toBe(true);
  });

  /**
   * `generator.kept` records which CLI wrote this file, so it is provenance.
   *
   * It used to be asserted as `0.0.0` and asserted *not* to be {@link KEPT_VERSION}:
   * task 25.1 bumped the packages to `0.1.0` and the committed file predated that
   * bump, so the truthful assertion was the gap, with a note that whoever
   * regenerated the snapshot should delete the older constant and pin the current
   * one. Task 21.5 regenerated it, the axes moved to `cover gaps`, so the file was
   * rewritten by a real run of this CLI, and this is that instruction being
   * followed rather than worked around.
   */
  it('records the CLI that wrote it', () => {
    expect(SNAPSHOT.generator.kept).toBe(KEPT_VERSION);
  });

  it('declares both cited documents, the fixture README and its own', () => {
    // Two documents now, and the second one is this repository (§23.1, R19.1). The
    // count is asserted per file rather than in aggregate, because "thirteen claims"
    // could be reached by admitting thirteen fixture claims and none of our own,
    // which is the arrangement R19.5 forbids.
    const byFile = new Map(
      SNAPSHOT.documents.map((document) => [document.file, document.claimCount]),
    );
    expect([...byFile.keys()].sort()).toEqual([SELF_README, README]);
    expect(byFile.get(README)).toBe(CLAIM_LINES.length);
    expect(byFile.get(SELF_README)).toBe(SELF_CITED_CLAIMS.length);
  });
});

describe('the committed snapshot, thirteen promises cited verbatim', () => {
  it('carries exactly thirteen promises, eight of the fixture and five of its own', () => {
    expect(SNAPSHOT.promises).toHaveLength(TOTAL_PROMISES);
    expect(SNAPSHOT.metrics.totalPromises).toBe(TOTAL_PROMISES);
    expect(promisesCitedTo(README)).toHaveLength(CLAIM_LINES.length);
    expect(promisesCitedTo(SELF_README)).toHaveLength(SELF_CITED_CLAIMS.length);
  });

  it('cites one distinct line of the fixture claims block per fixture promise', () => {
    const lines = promisesCitedTo(README)
      .map((promise) => promise.citation.line)
      .sort((a, b) => a - b);
    expect(lines).toEqual([...CLAIM_LINES]);
  });

  it('cites every self-cited claim the repository admitted, and admits no fewer (R19.5)', () => {
    const admitted = promisesCitedTo(SELF_README);
    // Each of the five claims is still in the graph, matched on what it says rather than
    // where it sits, so editing the top of the README moves citations without failing
    // here. The `>=` beside it is the direction that matters, spelled out so a future
    // reader sees which way this assertion is meant to bend.
    for (const fragment of SELF_CITED_CLAIMS) {
      expect(
        admitted.some((promise) => promise.citation.text.includes(fragment)),
        `no promise cites the claim containing '${fragment}'. Dropping a claim is how a ` +
          `coverage figure is raised dishonestly, which is what R19.5 forecloses.`,
      ).toBe(true);
    }
    // Every self-cited promise matches one of the five, so nothing was admitted that this
    // list does not account for.
    for (const promise of admitted) {
      expect(
        fragmentOf(promise),
        `${SELF_README}:${promise.citation.line} is admitted and matches none of the five ` +
          `claims this list names. Add it here deliberately or stop admitting it.`,
      ).not.toBeNull();
    }
    const lines = admitted.map((promise) => promise.citation.line).sort((a, b) => a - b);
    expect(
      lines.length,
      `the repository admitted ${lines.length} claims of its own README and the floor is ` +
        `${SELF_CITED_CLAIMS.length}. Admitting fewer raises the coverage figure by leaving ` +
        `out the claims nobody has proven, which is exactly what R19.5 forbids: a ledger ` +
        `that shows what it owes is the product.`,
    ).toBeGreaterThanOrEqual(SELF_CITED_CLAIMS.length);
  });

  it('cites nothing but the two documents subject.docs names', () => {
    for (const promise of SNAPSHOT.promises) {
      expect([README, SELF_README]).toContain(promise.citation.file);
    }
  });

  it('quotes each cited line verbatim, and the claim is that line', () => {
    for (const promise of SNAPSHOT.promises) {
      const document = DOCUMENT_LINES.get(promise.citation.file) as readonly string[];
      const line = document[promise.citation.line - 1];
      expect(
        line,
        `${promise.citation.file} has no line ${promise.citation.line}, yet promise ` +
          `${promise.id} cites it.`,
      ).toBeDefined();
      expect(
        promise.citation.text,
        `Promise ${promise.id} quotes text that is not ${promise.citation.file}:` +
          `${promise.citation.line} verbatim. Disk is the authority on a citation (R1.3).`,
      ).toBe(line);
      // The claim is the cited line normalised and nothing else, so a reworded
      // document can never leave a stale claim behind a correct citation. The fixture's
      // claims are list items and the self-cited ones are not, so the rule is stated
      // through the normaliser both providers already use rather than by stripping a
      // marker this file happens to know about.
      expect(promise.claim).toBe(normaliseClaim(line as string));
    }
  });

  it('binds all eight fixture designed tests, one per promise', () => {
    const bound = new Map<string, string>();
    for (const promise of promisesCitedTo(README)) {
      const designed = promise.designedTest;
      expect(designed, `Promise ${promise.id} has no designed test.`).not.toBeNull();
      if (designed === null) continue;
      expect(designed.testId).not.toBeNull();
      if (designed.testId !== null) bound.set(designed.testId, designed.path);
    }
    expect(Object.fromEntries([...bound.entries()].sort())).toEqual(EXPECTED_DESIGNED_TESTS);
  });

  it('binds each self-cited claim to a corpus document in nobody\'s use-case graph', () => {
    for (const promise of promisesCitedTo(SELF_README)) {
      const designed = promise.designedTest;
      expect(designed, `Promise ${promise.id} has no designed test.`).not.toBeNull();
      if (designed === null) continue;
      const fragment = fragmentOf(promise);
      expect(
        fragment,
        `${SELF_README}:${promise.citation.line} matches none of the five claims`,
      ).not.toBeNull();
      expect(designed.path).toBe(EXPECTED_SELF_CITED_TESTS[fragment ?? '']);
      // `designedTest.testId` is the Kane assurance-graph id, the `T-n` the enrichment
      // provider reads off `cover gaps` (§3.4). None of these three documents is a
      // registered use case, so none has one.
      //
      // This assertion used to be titled "a corpus document that Kane has never run"
      // and its message used to claim the null proved no recording existed. That was
      // wrong: one of these documents now has a recording, a plan `test_id` and a
      // `proven` verdict, and its assurance-graph id is still null, because the two are
      // different name spaces. The old message would have failed this file for the best
      // reason available, a claim being verified.
      expect(
        designed.testId,
        `${designed.path} carries an assurance-graph id, which means it was enrolled as a ` +
          `use case. These three documents were admitted as bare corpus documents, and ` +
          `whether one has been run is recorded on the promise's verdict rather than here.`,
      ).toBeNull();
    }
  });

  it('joins every promise to its document and its designed test', () => {
    const kinds = SNAPSHOT.edges.map((edge) => edge.kind);
    expect(kinds.filter((kind) => kind === 'cites')).toHaveLength(TOTAL_PROMISES);
    expect(kinds.filter((kind) => kind === 'designed')).toHaveLength(TOTAL_PROMISES);

    // `cites` and `designed` are one per promise and always present. `evidence` is
    // one per promise whose pack was curated, which is a count that moves with what
    // the last verification sealed — so it is bounded and cross-checked against the
    // promises rather than pinned to a number this commit happens to have.
    const evidenceEdges = kinds.filter((kind) => kind === 'evidence');
    expect(evidenceEdges.length).toBeLessThanOrEqual(TOTAL_PROMISES);
    expect(SNAPSHOT.edges).toHaveLength(2 * TOTAL_PROMISES + evidenceEdges.length);
    expect(evidenceEdges).toHaveLength(
      SNAPSHOT.promises.filter((promise) => promise.evidencePackId !== null).length,
    );

    // Each promise is reached from the node of **its own** document, so a self-cited
    // promise hanging off the fixture's document node would fail here rather than
    // render as a fixture claim in the Ledger's first lane.
    const documentIds = new Map(
      SNAPSHOT.documents.map((document) => [document.file, document.id]),
    );
    for (const promise of SNAPSHOT.promises) {
      const documentId = documentIds.get(promise.citation.file);
      expect(documentId, `No document node for ${promise.citation.file}.`).toBeDefined();
      expect(
        SNAPSHOT.edges.some(
          (edge) => edge.kind === 'cites' && edge.from === documentId && edge.to === promise.id,
        ),
        `No cites edge reaches promise ${promise.id} from ${promise.citation.file}.`,
      ).toBe(true);
    }
  });
});

describe('the committed snapshot, the honest assurance state', () => {
  it('reports a reason when it degrades, and none when it does not', () => {
    // Whether the assurance axis was delivered moves with Kane, so the *invariant* is
    // asserted rather than the state. This file has been degraded twice for two
    // different reasons, `assurance-status:refused` with no `.context/` store, then
    // again once the newest sealed pack turned out to be a replay pack carrying no
    // `coverage/usecases.yaml`, and it is clean now that §5.3.0 moved the axes to
    // `cover gaps`, which reads them from the live graph and needs no pack at all.
    // What R2.11 requires either way is that a degraded file carries a reason a
    // reviewer can read, and that a clean one carries none. Both of those episodes
    // reported `assurance-status:refused`, and that string is deliberately not
    // pinned here: the vocabulary of §5.3 has other members, a future refusal is
    // entitled to name one of them, and a suite that demanded this particular reason
    // would fail on a file that was perfectly honest.
    if (SNAPSHOT.degraded) {
      expect(SNAPSHOT.degradedReasons.length).toBeGreaterThan(0);
      for (const reason of SNAPSHOT.degradedReasons) expect(reason.length).toBeGreaterThan(0);
      expect(
        SNAPSHOT.diagnostics.some(
          (diagnostic) => diagnostic.severity === 'warn' || diagnostic.severity === 'error',
        ),
        'No diagnostic explains the degradation, so /runs would show a degraded chip with no reason.',
      ).toBe(true);
    } else {
      expect(SNAPSHOT.degradedReasons).toEqual([]);
    }
  });

  it('reports the coverage percentage exactly when it is entitled to (R2.11)', () => {
    expect(SNAPSHOT.metrics.designedCount).toBe(TOTAL_PROMISES);
    expect(SNAPSHOT.metrics.designedCoverage).toBe(1);
    // `undesignedCount` is 0 and that is a fact about the grammar rather than about the
    // debt. A promise enters this graph only through a `@verifies` tag, and the tag that
    // admits a claim is the same tag that binds its designed test (§5.2), so
    // `designedTest` is never null here and merge rule 4 never fires. The debt the five
    // self-cited claims represent is carried as `stale` instead, counted below, and it
    // is what pulled `provenCoverage` down. R19.4's `undesigned` arm is reachable only
    // for a provider that supplies a claim with no designed test, which no provider in
    // this repository does.
    expect(SNAPSHOT.metrics.undesignedCount).toBe(0);
    expect(SNAPSHOT.metrics.provenCount).toBe(PROVEN_COUNT);

    if (SNAPSHOT.degraded) {
      expect(
        SNAPSHOT.metrics.provenCoverage,
        'provenCoverage must be null while degraded, and a proven verdict does not change ' +
          'that: the percentage is the assurance axis, and the assurance axis was discarded. ' +
          'Publishing a figure derived from the verdicts alone would state as coverage ' +
          'something Kane never confirmed (R2.11).',
      ).toBeNull();
      return;
    }
    // Clean: the figure is `provenCount / totalPromises` and nothing else, which the
    // schema's own coverage rule already checked on parse. Restated here because this
    // is the number a judge reads, and it is the one field worth two authorities.
    //
    // It reads `8/13` rather than the `7/8` it read before stage 26, and the fall is
    // the deliverable. Four claims this repository makes about itself are still in the
    // graph with nothing behind them, so the honest figure is lower. Raising it by
    // admitting fewer of them is what the floor above forecloses; the one way it is
    // allowed to rise is the way it did, by a claim being verified.
    expect(SNAPSHOT.metrics.provenCoverage).toBeCloseTo(PROVEN_COUNT / TOTAL_PROMISES, 12);
    // Still strictly below the `7/8` this file published before stage 26, which is the
    // comparison that was always meant here: admitting the repository's own claims cost
    // the figure more than verifying one of them has yet returned.
    expect(SNAPSHOT.metrics.provenCoverage).toBeLessThan(
      FIXTURE_PROVEN_COUNT / CLAIM_LINES.length,
    );
  });

  it('publishes the dual coverage axes exactly when the graph is clean (R9.13, R9.14)', () => {
    const axes = SNAPSHOT.coverageAxes ?? null;
    if (SNAPSHOT.degraded) {
      // Withheld with the figure. Never a zero, never an empty ribbon.
      expect(axes).toBeNull();
      return;
    }
    expect(axes, 'a clean snapshot that publishes no axes is withholding what it has').not.toBeNull();
    if (axes === null) return;

    // Both axes, read verbatim from `cover gaps`, over one live acceptance-criteria
    // count, and the use-case debt beside them, unrounded.
    expect(axes.designCompleteness.ratio.denominator).toBe(axes.proven.ratio.denominator);
    expect(axes.proven.source).toBe('graph_execution_facts');
    expect(axes.proven.denominatorBasis).toBe('current_live_acs');
    expect(axes.designCompleteness.usecasesComplete.text).toBe('1/9');
    expect(axes.designCompleteness.ucsNeedingScenarios).toBe(8);
    expect(axes.rows.length).toBeGreaterThan(0);
    // Ordered by risk band then identifier, as the projection left it (R9.12).
    const ranks = axes.rows.map((row) => row.riskRank);
    expect([...ranks].sort((left, right) => left - right)).toEqual(ranks);
    // Every ready command is a string. There is no control anywhere in this file.
    for (const row of axes.rows) {
      for (const item of row.pending) {
        if (item.readyCommand === null) continue;
        expect(typeof item.readyCommand).toBe('string');
      }
    }
  });

  it('attributes every verdict it does claim to a real terminal event of its own', () => {
    expect(SNAPSHOT.metrics.staleCount).toBe(STALE_COUNT);
    // Red is a fixture claim, so it is the fixture's own arithmetic. This used to read
    // `CLAIM_LINES.length - PROVEN_COUNT`, which was correct only while every proven
    // verdict in the file was a fixture verdict; once `README.md:679` was proven, that
    // expression said the file should carry no red promise at all.
    expect(SNAPSHOT.metrics.redCount).toBe(CLAIM_LINES.length - FIXTURE_PROVEN_COUNT);
    // Every stale promise is self-cited, so no fixture claim quietly lost its evidence
    // while the counts still added up. Asserted as a set of files rather than a count of
    // them, because the count now differs from `SELF_CITED_CLAIMS.length`: one of the
    // self-cited claims is proven, and that promise must not appear here.
    expect(
      SNAPSHOT.promises
        .filter((promise) => promise.verdict === 'stale')
        .map((promise) => promise.citation.file),
    ).toEqual(Array.from({ length: STALE_COUNT }, () => SELF_README));
    // And the proven self-cited claim is the badge one, named by what it says rather
    // than by the line it sits on.
    expect(
      promisesCitedTo(SELF_README)
        .filter((promise) => promise.verdict === 'proven')
        .map((promise) => fragmentOf(promise)),
    ).toEqual(['`/badge.svg` | GET only, `image/svg+xml`']);

    // Each promise is attributed to *its own* run rather than to one instant covering
    // the file, and the freshness triple names the newest of them. That held while two
    // runs wrote this file, and it holds now that one whole-suite replay wrote all of
    // it: the per-promise attribution is a property of the write guard (R4.15), not an
    // artefact of how many runs happened to contribute.
    const runIds = new Set<string>();
    const instants = new Set<string>();
    for (const promise of SNAPSHOT.promises) {
      const source = promise.verdictSource;
      if (promise.verdict === 'stale') {
        // The other half of the same rule. `stale` means designed and never proven, so
        // there is no run to be accountable for, and a source here would be a verdict
        // the write guard let through without a terminal event (§4.8). All five carry
        // no repair, no pack and no credits either: nothing has happened to them yet.
        expect(
          source,
          `Promise ${promise.id} is stale and names a run, which would mean a verdict ` +
            `source survived without a verdict.`,
        ).toBeNull();
        expect(promise.repair).toBeNull();
        expect(promise.evidencePackId).toBeNull();
        expect(promise.credits).toBeNull();
        expect(promise.providers).toEqual(['baseline']);
        continue;
      }
      expect(
        source,
        `Promise ${promise.id} carries verdict '${promise.verdict}' with no source, so the ` +
          `Ledger could show a verdict no run is accountable for.`,
      ).not.toBeNull();
      if (source === null) continue;
      runIds.add(source.runId);
      instants.add(source.at);
      expect(source.terminalEventType).toBe('testrun_done');
      // Never later than the freshness triple, which names the newest consumed
      // terminal event: a verdict from the future would mean a write escaped the
      // guard.
      expect(Date.parse(source.at)).toBeLessThanOrEqual(
        Date.parse(SNAPSHOT.freshness.terminalEventAt ?? ''),
      );
      // Every promise names a run the terminal-event log carries.
      expect(SNAPSHOT.runs.map((run) => run.id)).toContain(source.runId);
      // R4.9: the wire status survives, so `failed` never reads as `broken`.
      expect(source.memberStatus).toBe(promise.verdict === 'proven' ? 'passed' : 'failed');
      expect(promise.providers).toEqual(['baseline']);
      // A pack reference is present only when the pack was curated into the
      // repository, and then it names a pack this snapshot declares. Which promises
      // have one moves with what the last verification sealed, so the assertion is
      // the closure rather than the count: a reference is either resolvable or
      // absent, and never a dead link.
      if (promise.evidencePackId !== null) {
        expect(SNAPSHOT.evidence.map((entry) => entry.id)).toContain(promise.evidencePackId);
      }
    }
    expect(runIds.size, 'Every verdict names a run.').toBeGreaterThan(0);
    // The newest instant any promise carries is exactly the freshness triple's.
    expect([...instants].sort().pop()).toBe(SNAPSHOT.freshness.terminalEventAt);

    // The one red promise is the never-true discount claim, and it is the only one
    // carrying a repair. Which *branch* it carries is Kane's answer and not this
    // repository's: the same unchanged failure has been settled `docs-lie` and
    // `test-drift` on different runs, because Kane's investigation is intermittent
    // and has reported both `confirmed: true` and `confirmed: false` about it
    // (`docs/kane/loop/README.md`). Pinning one branch here would pin a coin flip.
    const red = SNAPSHOT.promises.filter((promise) => promise.verdict === 'red');
    expect(red).toHaveLength(1);
    expect(red[0]?.citation.line).toBe(DISCOUNT_CLAIM_LINE);
    expect(['code-break', 'test-drift', 'docs-lie']).toContain(red[0]?.repair?.branch);
    for (const promise of SNAPSHOT.promises) {
      if (promise.verdict === 'proven') expect(promise.repair).toBeNull();
    }

    expect(SNAPSHOT.freshness.terminalEventType).toBe('testrun_done');
    expect(SNAPSHOT.freshness.commandFamily).toBe('ExecutionTestrun');
    expect(Number.isFinite(Date.parse(SNAPSHOT.freshness.terminalEventAt ?? ''))).toBe(true);
  });

  it('claims no evidence and no review card it has not earned', () => {
    // Review cards are empty because `.kept/review-cards/` is empty: the directory is
    // gitignored regenerable state, and the nine cards the docs-triggered loop of task
    // 22.2 mirrored went with the documentation edit that produced them.
    //
    // The stated reason used to be "nothing has produced one", which was wrong twice
    // over. Nine had been produced, and while that was being written `runSnapshot` had
    // no projection from the store at all, so this assertion would have held just the
    // same on a repository holding a hundred cards. An empty array here is a fact about
    // the store, not evidence that the projection works; that the projection is wired
    // at all is asserted in `snapshot.test.ts`, over a seeded store.
    expect(SNAPSHOT.reviewCards).toEqual([]);

    // Evidence is no longer empty, and what replaces `toEqual([])` is the property
    // that mattered all along: every pack the snapshot declares is a pack the
    // repository actually contains, named by the node id the artefact links use, and
    // carrying Kane's own archive name beside it as provenance. The count moves with
    // what the last verification sealed and is deliberately not pinned.
    for (const entry of SNAPSHOT.evidence) {
      expect(entry.id.startsWith('ev_')).toBe(true);
      expect(entry.publicPath).toBe(`/evidence/${entry.id}/`);
      expect(entry.artifacts.length).toBeGreaterThan(0);
      for (const artifact of entry.artifacts) {
        expect(artifact.publicPath.startsWith(`/evidence/${entry.id}/`)).toBe(true);
      }
      // Kane's own name for the archive, which cannot itself be a node id — the
      // whole reason both fields exist (§9.3).
      if (entry.packId !== undefined && entry.packId !== null) {
        expect(entry.packId.startsWith('ev_')).toBe(false);
      }
    }
    // Credits are reported only where a figure was measured. A passing replay costs
    // nothing and reports nothing; the failing member's judgement has a real price,
    // read off its own `run_end` on the `[member]` stream (R4.12, R14.7).
    for (const promise of SNAPSHOT.promises) {
      if (promise.verdict === 'proven') expect(promise.credits).toBeNull();
      if (promise.credits !== null) expect(promise.credits).toBeGreaterThan(0);
    }
  });

  /**
   * The terminal-event log, projected off `.kept/handoff/` (15.6). Every field here
   * is either a figure Kane reported or an explicit null, and the nulls are the
   * interesting half: a family's terminal event may carry no result code and no
   * credit figure at all, and publishing a zero for either would be a claim about
   * what the run cost.
   *
   * **This used to assert that every run is `ExecutionTestrun` running `testrun run`,
   * and that was an accident of history rather than a rule.** The log is projected off
   * `.kept/handoff/`, and every command that writes a handoff appears in it, so the
   * assertion held only while the sole persisted handoffs happened to be verifications.
   * Task 22.2 ran `cover gaps` and `maintain reconcile` live, their handoffs were
   * persisted, and four `Assurance` runs joined the log. That is correct: they are real
   * Kane invocations with real terminal events, and hiding them would make `/runs` a
   * partial log claiming to be the whole one.
   *
   * So what is asserted now is the **pairing**, which is the thing that would actually
   * be wrong if it broke: each run's command and terminal event type must match the
   * family it declares. A run labelled `Assurance` that ran `testrun run`, or an
   * `ExecutionTestrun` whose terminal event was `done`, would mean the projection had
   * mixed two contracts up, and §4.2's whole point is that reading one family's
   * completion signal for another's waits forever for a signal that never comes.
   */
  it('publishes the runs it recorded, with the figures Kane did not report left null', () => {
    expect(SNAPSHOT.runs.length).toBeGreaterThan(0);
    /** Command prefix and terminal event, per family. Kept as a table so a new family
        has to be added here deliberately rather than slipping through a loose check. */
    const CONTRACTS: Readonly<Record<string, { prefix: readonly string[]; terminal: string }>> = {
      ExecutionTestrun: { prefix: ['testrun run'], terminal: 'testrun_done' },
      Assurance: { prefix: ['cover', 'maintain'], terminal: 'done' },
    };
    const seen = new Set<string>();
    for (const run of SNAPSHOT.runs) {
      const contract = CONTRACTS[run.family];
      expect(
        contract,
        `run '${run.id}' declares family '${run.family}', which this test has no contract ` +
          `for. Add it to CONTRACTS with the command prefix and terminal event it uses.`,
      ).toBeDefined();
      if (contract === undefined) continue;
      seen.add(run.family);
      expect(
        contract.prefix.some((prefix) => run.command.startsWith(prefix)),
        `run '${run.id}' is family '${run.family}' but ran '${run.command}'`,
      ).toBe(true);
      expect(run.terminalEventType).toBe(contract.terminal);
      // `--agent` is never on the Execution family, and `--from-context` on neither.
      if (run.family === 'ExecutionTestrun') expect(run.command).not.toContain('--agent');
      expect(run.command).not.toContain('--from-context');
      // A pack reference is published only when the pack is committed (§9.1 rule 3).
      if (run.evidencePackId !== null) {
        expect(SNAPSHOT.evidence.map((pack) => pack.id)).toContain(run.evidencePackId);
      }
      // `startedAt` is never derived from `endedAt` minus a duration.
      expect(run.startedAt).toBeNull();
      for (const member of run.members) {
        expect(['passed', 'failed', 'broken', 'interrupted']).toContain(member.status);
      }
    }
    // Both families are actually present, so neither arm of the table is dead code.
    expect([...seen].sort()).toEqual(['Assurance', 'ExecutionTestrun']);
  });

  /**
   * Every verdict's provenance is openable, which is what the run cap nearly broke.
   *
   * The log is capped at {@link MAX_SNAPSHOT_RUNS}, and the cap used to be a plain
   * newest-first slice. At task 22.2 the log grew past it for the first time and
   * dropped `108dbb62`, the whole-suite replay that earned six of the seven proven
   * verdicts, while all six promises went on naming it. `/runs` no longer listed the
   * run and the row a reader clicked through to did not exist.
   *
   * The cap is a cap on history rather than on provenance now: a cited run is retained
   * regardless of age. This asserts the property rather than the implementation, so it
   * would fail again if the retention were removed.
   */
  it('carries every run a promise names, however old, so no verdict is unopenable', () => {
    const cited = new Set(
      SNAPSHOT.promises
        .map((promise) => promise.verdictSource?.runId)
        .filter((id): id is string => typeof id === 'string'),
    );
    // Non-vacuous: the committed file does attribute verdicts to runs.
    expect(cited.size).toBeGreaterThan(0);
    const carried = new Set(SNAPSHOT.runs.map((run) => run.id));
    expect(
      [...cited].filter((id) => !carried.has(id)),
      'a promise names a run the committed file does not carry, so its verdict cannot be opened',
    ).toEqual([]);
  });

  /**
   * The docs-lie amendment (15.5). It is `pending` in the committed file and the
   * cited line still makes the claim it proposes to replace — those two facts
   * together are R7.4: nothing was written until a human accepted, and no human
   * has.
   */
  it('publishes the staged docs-lie amendment, pending and unapplied', () => {
    expect(SNAPSHOT.amendments).toHaveLength(1);
    const amendment = SNAPSHOT.amendments[0];
    expect(amendment?.status).toBe('pending');
    expect(amendment?.appliedAt).toBeNull();
    expect(amendment?.citation.file).toBe(README);
    expect(amendment?.citation.line).toBe(DISCOUNT_CLAIM_LINE);
    expect(amendment?.expectedSha256).toMatch(/^[0-9a-f]{64}$/);
    // The amendment names the red promise, and the red promise is the docs-lie.
    const red = SNAPSHOT.promises.find((promise) => promise.verdict === 'red');
    expect(amendment?.promiseId).toBe(red?.id);
    // It was proposed off the run that settled that promise as `docs-lie`, and the
    // rationale names it. The promise's *current* branch may differ, because Kane
    // has since answered differently about the same failure — the amendment is a
    // historical record of a decision, not a live mirror of the router.
    expect(amendment?.rationale).toContain('docs-lie');
    // The claim it replaces is still the claim the file makes.
    expect(amendment?.currentText).toBe(red?.citation.text);
    expect(amendment?.proposedText).not.toBe(amendment?.currentText);
  });
});

/**
 * The fence around the document this snapshot now cites (task 26.1, §20.1, §20.3).
 *
 * It belongs in this file because it is the other half of the same commit. Admitting
 * `README.md` as a promise source only makes the graph honest if the loop cannot
 * *edit* it: a `code-break` repair that reached the root README could turn a red
 * promise green by rewriting the sentence, which is the one repair this system exists
 * to forbid. The fixture README has had that protection since §20.1, and it comes
 * from `subject.docs` rather than from a literal, so adding one entry is what extends
 * it. This asserts the extension actually happened rather than assuming it.
 *
 * The configuration is loaded off disk through `loadConfig`, the same call the CLI
 * makes, because what the fence is derived from is the committed bytes and not a
 * fixture's copy of them.
 */
describe('the fence derived from the committed configuration protects the root README', () => {
  const loaded = loadConfig({ repoRoot: REPO_ROOT, fileSystem: nodeStateFileSystem() });

  it('reads the committed configuration, so nothing below is about a default', () => {
    // §20.4 fails closed with `subject.docs: ['README.md']`, which would make the
    // clauses below pass while describing a repository this is not. The flag says the
    // file was found, parsed, and every field was usable.
    expect(loaded.loaded).toBe(true);
    expect(loaded.config.subject.docs).toContain(SELF_README);
    expect(loaded.config.subject.docs).toContain(README);
    expect(loaded.config.corpus.root).toBe('tests');
  });

  it('names the root README on code-break\'s forbidden side', () => {
    const forbidden = derivedForbidden(loaded.config, 'code-break');
    expect(
      forbidden,
      `code-break may write without ${SELF_README} being forbidden, so a repair could ` +
        `rewrite one of the five claims instead of fixing the product.`,
    ).toContain(SELF_README);
    // The same protection the fixture's claim surface has, and the corpus and the
    // engine beside it, all derived from the one configuration.
    expect(forbidden).toContain(README);
    expect(forbidden).toContain('tests');
    expect(handoffFenceSurfaces(loaded.config).forbid).toContain(SELF_README);
  });

  it('grants code-break nothing that can reach the root README', () => {
    const allow = loaded.config.fences['code-break'].allow;
    expect(allow.length).toBeGreaterThan(0);
    expect(matchesAnyGlob(allow, SELF_README)).toBe(false);
    expect(handoffFenceSurfaces(loaded.config).allow).toEqual([...allow]);
    for (const glob of allow) expect(glob.startsWith('apps/fixture/')).toBe(true);
  });

  it('leaves the §20.3 intersection guard quiet, on every branch', () => {
    // The guard reports for all three branches and enforces on one. Adding a
    // documentation glob is exactly the edit that could have made it fire, so the
    // emptiness is asserted rather than assumed: `apps/fixture/{app,components,lib}/**`
    // cannot match `README.md`, and if a future allow glob could, this fails at load
    // time and the allow set is emptied rather than honoured.
    expect(fenceFindings(loaded.config)).toEqual([]);
  });
});
