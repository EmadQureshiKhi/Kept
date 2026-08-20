/**
 * The version string the snapshot's `generator.kept` field carries (design §9.1).
 *
 * A constant rather than a `package.json` import. `rootDir` is `src`, so
 * importing `../package.json` would place the emitted tree outside it, and
 * `resolveJsonModule` would then inline a copy of the manifest into `dist/` —
 * a second, silently stale, home for the version. One literal, reviewed in the
 * same diff as the manifest it mirrors, is the smaller cost.
 */
export const KEPT_VERSION = '0.0.0';
