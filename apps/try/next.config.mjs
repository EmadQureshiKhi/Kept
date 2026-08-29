/**
 * The `try` application — Next configuration.
 *
 * Mirrors `apps/ledger/next.config.mjs`, and differs from it in exactly one way that matters: this
 * app has a route handler, so it is not a fully static export. Everything else is the same shape
 * for the same reasons.
 *
 * ## `outputFileTracingRoot`
 *
 * `apps/try` has no `package.json` of its own, the same arrangement `apps/ledger` uses: the root
 * manifest holds every dependency and the app is a directory in a workspace rather than a package.
 * So the trace has to be told where the workspace root is, or it resolves dependencies against the
 * app directory and finds no `node_modules` there.
 *
 * ## Why the build ignores type errors
 *
 * The same argument the Ledger's config makes, and it is not a weakening. `npm run check` is the
 * gate: the read-only scan, `tsc -b` over the solution, `tsc -p apps/fixture`, `tsc -p apps/ledger`,
 * `tsc -p apps/try`, then the suite. Nothing reaches a commit without passing all of it locally.
 *
 * What this removes is a second, weaker copy of that check running on a build host, where `npm ci`
 * can resolve a transitive `@types` package to a different patch than the tree it was written
 * against and Next's own generated `.next/types` are regenerated per build. A mismatch there fails
 * a deploy for a reason no local command reproduces.
 *
 * ## No `env`, no `rewrites`, no image domains
 *
 * There is nothing to point one at. This app holds no credential, reads no environment variable and
 * talks to exactly two hosts, both named literally in `lib/github.ts` and both public. A config
 * that carried a secret would be the first secret in this project.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  typescript: {
    /* `npm run check` runs `tsc -p apps/try` over this exact program, with the DOM libs, before
       anything is committed. See the note above for why the build host is not asked to repeat it. */
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
