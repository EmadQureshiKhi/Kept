/**
 * `/badge.svg`. Design §10.1, §10.11, R9.4, R9.5, R8.4, R8.5.
 *
 * The only route handler in the application, and it exports **`GET` and nothing
 * else**. No `POST`, no `PUT`, no `PATCH`, no `DELETE`, no server action, no
 * `middleware.ts` anywhere in the tree: the deployed Ledger is a read-only
 * artefact, and the read-only source scan asserts that by reading this file rather
 * than by trusting this comment.
 *
 * `dynamic = 'force-static'` is the other half of the same claim. The response is a
 * pure function of the committed snapshot, so it is generated at build time and
 * served as a file: there is no request-time work here to make dynamic, and the
 * export says so out loud (R8.6).
 *
 * Everything that could be a decision has been moved out. `lib/badge.ts` builds the
 * SVG, derives its geometry from the type size and names its headers;
 * `lib/snapshot.ts` is the one place the snapshot is read and validated. What is
 * left is the boundary itself, which is why Property 25 can assert the badge over a
 * thousand generated snapshots without a server.
 *
 * The figure is `metrics.provenCoverage`, straight from the snapshot and never
 * recomputed. The committed snapshot carries a figure rather than withholding one
 * (`degraded: false`), so the badge a reader meets first is a whole-number
 * percentage on the fill its band chooses. No figure is quoted here: it moves with
 * every verification run, and a comment naming today's number is a comment that is
 * wrong by tomorrow.
 *
 * The withheld arm is still the one that has to be right. `null` renders `n/a` on
 * the neutral fill with no division performed (R9.3), because a badge that showed
 * `0%` for a run that measured nothing would be the one dishonest pixel on the page.
 * Both arms are the same frame, the same plates and the same baseline, so the
 * fallback reads as a decision rather than as a failure.
 */

import { badgeHeaders, badgeSvg } from '../../lib/badge.js';
import { snapshot } from '../../lib/snapshot.js';

export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(badgeSvg(snapshot.metrics.provenCoverage), { headers: badgeHeaders() });
}
