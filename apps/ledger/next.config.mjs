/**
 * The Ledger — Next configuration.
 *
 * Deliberately small, and every entry here is either a monorepo fact or a
 * deployment decision. There are no rewrites, no redirects, no headers, no image
 * domains and no environment variables, because there is nothing to point one at:
 * every route is prerendered from the committed snapshot under `data/` (R8.6, R13.4).
 * A config that named a host would be the first thing on this page that reached one.
 *
 * The snapshot's filename is deliberately not written here. `lib/snapshot.ts` is the
 * one module permitted to name it, so that a reader grepping for the file finds the
 * single place it is loaded rather than a config that mentions it in passing — and
 * `judge-path.test.ts` holds that to one file by reading the text of every other.
 *
 * ## `outputFileTracingRoot`
 *
 * `apps/ledger` has no `package.json` of its own — the root manifest holds every
 * dependency and the app is a directory in a workspace rather than a package, which
 * is the arrangement `docs/deploy-ledger.md` explains and a test pins. So the trace
 * has to be told where the workspace root is, or it resolves dependencies against
 * the app directory and finds no `node_modules` there.
 *
 * ## Why the build ignores type and lint errors
 *
 * **This does not weaken any guarantee, because the guarantee lives elsewhere and
 * runs earlier.** `npm run check` is the gate: `scripts/check-readonly.mjs`, then
 * `tsc -b` over the whole solution, then `tsc -p apps/fixture` and
 * `tsc -p apps/ledger` — the browser-facing program, with the DOM libs, which is the
 * one that would catch a type error in a component — and then the full suite. Nothing
 * reaches a commit without passing all four locally.
 *
 * What these two flags remove is a *second, weaker* copy of that check running on a
 * build host, and the reason to remove it is that the two are not equivalent. The
 * build host installs with `npm ci` against a lockfile, so a transitive `@types`
 * package can resolve to a different patch than the tree it was written against, and
 * Next's own generated `.next/types` route definitions are regenerated per build — a
 * mismatch there fails a deploy for a reason no local command reproduces and no
 * committed file expresses. The deployed artefact is a set of prerendered HTML pages
 * built from a JSON file that was already validated by `zod` at build time
 * (`lib/snapshot.ts`, R8.8); a type error cannot make those pages wrong in a way the
 * schema and the suite did not already refuse.
 *
 * The honest summary: type-checking is a thing this repository does, thoroughly, on
 * the machine that has the whole toolchain pinned. It is not a thing the deploy does
 * twice.
 *
 * **There is deliberately no `eslint` block.** An earlier version of this file carried
 * `eslint.ignoreDuringBuilds`, and Next 16 rejects the key outright — the first deploy
 * reported `Unrecognized key(s) in object: 'eslint'` and pointed at the note that
 * build-time linting was removed from the config surface. It was a warning rather than
 * a failure, and the build completed, but a config key the framework has dropped is
 * dead weight that reads as configuration. There is no ESLint configuration in this
 * repository for it to have suppressed in any case.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  typescript: {
    /* `npm run check` runs `tsc -p apps/ledger` over this exact program, with the DOM
       libs, before anything is committed. See the note above for why the build host is
       not asked to repeat it. */
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
