/**
 * Public surface of `@kept/core` (design §2.1). This barrel is the only import
 * path consumers use — `@kept/cli`, `apps/ledger` and the tests all read from
 * here, never from a deep `dist/**` path.
 *
 * Modules are re-exported as their tasks land: `diagnostics` (1.3), the Kane
 * three-contract layer (stage 2), the promise model and snapshot contract
 * (stage 3), the verdict router (stage 11).
 */

/** Package identity, used by `kept doctor` and by the launcher's build check. */
export const KEPT_CORE_PACKAGE = '@kept/core';
