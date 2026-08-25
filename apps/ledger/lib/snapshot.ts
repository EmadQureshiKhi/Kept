/**
 * The Ledger's only data source — design §9.3, §10.1, R8.6, R8.8.
 *
 * `data/ledger.snapshot.json` is committed, and this module is the single seam
 * where it becomes typed data. Everything the deployed site renders — the graph,
 * both coverage figures, the freshness chip, the run log, the review cards, the
 * pending amendment diff — comes from here, which is what makes the deployment
 * need no external tool, no browser, no credentials and no network (R8.6). No
 * subprocess is started anywhere under `apps/ledger`, at build time or at request
 * time; there is nothing here to start one with.
 *
 * Two failure modes, and both of them stop the build rather than render a lie
 * (R8.8):
 *
 * 1. **Absent.** The snapshot arrives through a static `import`, so a missing
 *    file is a module-resolution error in `tsc` and in the bundler before any of
 *    this code runs. That is deliberately not defended against at runtime — a
 *    `try`/`catch` around a dynamic read would let a build succeed with an empty
 *    ledger, which is the one outcome worse than a failed build.
 * 2. **Invalid.** `parseSnapshot` zod-parses and throws a `SnapshotParseError`
 *    whose message names the offending field path — including the five cross-field
 *    rules of §9.1, so a count that disagrees with `promises`, a coverage figure
 *    that should have been null, an unresolvable evidence reference, a dangling
 *    edge endpoint or a freshness type that contradicts its command family all
 *    fail here by path rather than surfacing as a wrong number on the page.
 *
 * The import attribute is not decoration: under `module: NodeNext` TypeScript
 * requires `with { type: 'json' }` for a JSON module (TS1543), and Node applies
 * the same rule to a real ESM JSON import. `JSON.stringify` then hands
 * `parseSnapshot` text rather than the bundler's object, so the *bytes* are what
 * gets validated and the schema is the only thing that decides the shape — the
 * structural type the bundler infers from the file's current contents never
 * stands in for it.
 *
 * A degraded snapshot is **valid**, and this module renders it. The committed
 * snapshot is not one today: it carries `degraded: false`, an empty
 * `degradedReasons`, a real `provenCoverage` of seven proven promises out of
 * thirteen, and the dual coverage axes beside it, because §5.3.0 moved those axes
 * to `cover gaps`, which reads them off the live graph and needs no sealed pack to
 * measure against. So the metric rail renders the proven tile with a figure in it,
 * and the `baseline data only` chip of §10.10 is the arm nobody sees first.
 *
 * That arm still has to be right, which is why it is a state of the data and not a
 * flag on a component. One refusal upstream brings it back, the schema requires
 * `provenCoverage` to be null the moment it does (R2.11), and the number is then
 * withheld rather than reported as zero.
 */

import type { LedgerSnapshot } from '@kept/core';
import { parseSnapshot } from '@kept/core';

import raw from '../data/ledger.snapshot.json' with { type: 'json' };

/** Repo-relative path of the committed snapshot, for diagnostics and messages. */
export const SNAPSHOT_PATH = 'apps/ledger/data/ledger.snapshot.json';

/**
 * Validates one snapshot document, re-throwing with the file named.
 *
 * The rethrow adds the path of the file and nothing else: `parseSnapshot`'s
 * message already leads with the offending field path, and R8.8 asks for the
 * field, so the wrapper's whole job is to say *which* document that field is in.
 * `cause` carries the original error, so `error.cause.paths` still holds the
 * machine-readable list.
 */
export function loadSnapshot(document: unknown): LedgerSnapshot {
  try {
    return parseSnapshot(JSON.stringify(document));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${SNAPSHOT_PATH}: ${reason}`, { cause });
  }
}

/**
 * The snapshot every route reads. Module-scope, so it is validated exactly once
 * per build and a violation fails that build (R8.8).
 */
export const snapshot: LedgerSnapshot = loadSnapshot(raw);
