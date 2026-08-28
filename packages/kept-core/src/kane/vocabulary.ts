/**
 * Kane vocabulary with no filesystem behind it — design §2.17, §9.1, R8.4.
 *
 * Three declarations live here and nothing else: the artefact-kind union, its
 * enumeration, and the suffix Kane gives a sealed pack. All three are plain data.
 * None of them reads a file, and that is the entire reason this module exists.
 *
 * ## Why they are not declared where they are used
 *
 * `model/snapshot.ts` builds the zod schema, and design §9.1 says the schema states
 * each vocabulary once by importing it rather than restating it — a second copy of
 * the artefact kinds is a second thing to keep in step, and the two would disagree
 * on the day somebody adds a kind. That rule is right and it stays.
 *
 * The problem was where the imports landed. `ARTIFACT_KINDS` was declared in
 * `kane/evidence.ts` and `SEALED_PACK_SUFFIX` in `kane/packTriage.ts`, and both of
 * those modules walk directories: `node:fs`, `node:path`, `readdirSync`, `statSync`,
 * `join` and `resolve` over paths computed at run time. So importing a frozen array
 * of seven strings pulled a directory walker into the graph with it.
 *
 * That matters at exactly one place, and it is the place this repository makes its
 * loudest claim. `apps/ledger/lib/snapshot.ts` imports `parseSnapshot`, which reaches
 * the schema, which reached `kane/evidence.ts` — so the **read-only deployed Ledger**
 * carried a filesystem walker in its bundle. It never called it: every evidence path
 * the Ledger renders is a `publicPath` string the snapshot already holds (R13.4), and
 * `scripts/check-readonly.mjs` proves the app itself opens nothing. But "it is in the
 * bundle and never called" is a weaker sentence than "it is not in the bundle", and
 * the difference costs one module.
 *
 * The build said so out loud. `next build` reported four
 * `Dynamic filesystem access causes tracing of the whole project` warnings, every one
 * of them pointing into `kane/evidence.js`, because a tracer cannot statically scope
 * `join(dir, entry.name)` and so widens what it includes. That widening was real and
 * measured: the trace carried 1181 files and 52.6 MB, including all 9.8 MB of
 * `apps/ledger/public` and — the part worth noticing — `apps/ledger/test`. Test files
 * were being deployed as server code.
 *
 * ## This module is half of the fix, and the halves are not interchangeable
 *
 * The other half is `"sideEffects": false` in `packages/kept-core/package.json`, which
 * is true of every module in this package (none of them runs a statement at load) and
 * was simply never declared. Both were needed, which was measured rather than assumed:
 *
 * | | without `sideEffects` | with `sideEffects: false` |
 * |---|---|---|
 * | schema imports from `evidence.js` | 4 warnings | 4 warnings |
 * | schema imports from this module | 4 warnings | **0 warnings** |
 *
 * The two edges are different in kind, which is why one flag could not close both.
 * `sideEffects: false` lets a bundler drop the barrel's *unused* re-exports —
 * `listArtifacts`, `resolveEvidenceDir` and the rest — and without it the barrel drags
 * every module it names regardless of what a consumer asked for. But no flag drops a
 * dependency that is genuinely *used*: while `model/snapshot.ts` read `ARTIFACT_KINDS`
 * out of `kane/evidence.js`, that module was live by ordinary reachability, and tree
 * shaking is not entitled to remove it. So the incidental edge needed the declaration
 * and the real edge needed this module.
 *
 * With both in place the trace is 985 files and 41.9 MB — `node_modules` and the build
 * output, nothing else. No `readdirSync` or `statSync` survives anywhere under
 * `.next/server`.
 *
 * ## The rule this module is holding
 *
 * **Nothing in here may import anything.** Not a sibling, not a type, and certainly
 * not `node:*`. The moment it does, it stops being the safe end of the dependency
 * and the edge it was created to break re-forms through it. It has no imports today
 * and the file is short enough that an added one is obvious in review.
 *
 * `kane/evidence.ts` and `kane/packTriage.ts` now import these three names from here,
 * so there is still exactly one declaration of each and the two cannot disagree about
 * what a pack is called. The public surface is unchanged: the barrel exports all three
 * under the same names, so no consumer — `kept-cli`, `apps/ledger`, or any test —
 * changes a line.
 */

/**
 * How an artefact inside a pack is classified. Same vocabulary as
 * `LedgerSnapshot.evidence[].artifacts[].kind` (design §9.1), so a listing
 * serialises into the snapshot without a translation table.
 */
export type ArtifactKind =
  | 'annotated'
  | 'screenshot'
  | 'har'
  | 'console'
  | 'log'
  | 'failure-yaml'
  | 'other';

/** The kinds, in snapshot order. Lets tests and generators enumerate. */
export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'annotated',
  'screenshot',
  'har',
  'console',
  'log',
  'failure-yaml',
  'other',
];

/** The suffix Kane gives a sealed pack. The execution id is the name before it. */
export const SEALED_PACK_SUFFIX = '.evidence';
