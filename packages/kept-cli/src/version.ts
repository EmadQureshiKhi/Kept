/**
 * The version string the snapshot's `generator.kept` field carries (design §9.1).
 *
 * A constant rather than a `package.json` import. `rootDir` is `src`, so
 * importing `../package.json` would place the emitted tree outside it, and
 * `resolveJsonModule` would then inline a copy of the manifest into `dist/`,
 * a second, silently stale, home for the version. One literal, reviewed in the
 * same diff as the manifest it mirrors, is the smaller cost.
 *
 * ## Why this moved to 0.1.0
 *
 * Task 25.1 took both manifests off `private: true` and gave them a version an
 * installer can depend on, so this constant follows them: it is what `kept
 * --version` prints, and R17.10 has the installed binary report the published
 * version from a directory outside this workspace. A binary that announced
 * `0.0.0` while the registry served `0.1.0` would be the first thing a user saw
 * and the first thing they distrusted.
 *
 * `apps/ledger/data/ledger.snapshot.json` recorded `generator.kept: 0.0.0` for a
 * while, and that was correct rather than stale, the field records which CLI wrote
 * that file, and the file predated the bump. A second constant existed here to say
 * so, and `committed-snapshot.test.ts` asserted the divergence from both ends with a
 * note to remove it once the snapshot was regenerated. Task 21.5 regenerated it: the
 * coverage axes moved to `cover gaps`, so the file was rewritten by a real run of
 * this CLI and the two converged. The constant is gone rather than left pointing at
 * a version nothing carries.
 */
export const KEPT_VERSION = '0.1.0';
