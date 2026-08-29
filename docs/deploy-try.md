# Deploying `apps/try`

`apps/try` is a second Vercel project from the same repository. This document says why it has to
be second, what to type into Vercel, and what the deployment is allowed to do.

## Why two projects and not one

`apps/ledger` states in its own README, on a line cited by a promise in KEPT's graph, that the
deployed artefact carries no non-GET handler. `scripts/check-readonly.mjs` enforces that over
eleven rules across every file under `apps/ledger`, and `read-only-scan.test.ts` runs the scan in
the suite. The paste-a-repository page needs a `POST`. Putting it in `apps/ledger` would break a
promise the project is built to keep, so it lives in its own tree and gets its own deployment. The
scan's root is `apps/ledger` and only that, so `apps/try` is outside it by construction rather than
by exclusion.

Two projects also separate what they can be trusted with. The Ledger holds a committed snapshot
and reaches nothing. The try page reaches `github.com` and nowhere else, holds no credential and
stores nothing.

## Vercel settings

Create a second project against the same Git repository.

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Root Directory | leave at the repository root |
| Build Command | `npx tsc -b packages/kept-core && npx next build apps/try` |
| Output Directory | `apps/try/.next` |
| Install Command | `npm ci` |
| Node version | 20.x or later |

Root Directory stays at the repository root on purpose. `apps/try` imports `kept-core`, which is
a workspace package, so the install has to happen where the workspaces are declared. Setting Root
Directory to `apps/try` would give Vercel a directory with no `package.json` and no lockfile.

The `tsc -b` in the build command is not a type-check for its own sake: `kept-core` is consumed
from its built output, so the build has to happen before Next resolves the import.

### Project name

Name the project `kept-try`, which gives `kept-try.vercel.app`. That exact host is the fallback
written into `apps/ledger/components/Masthead.tsx`, so a matching name means the Ledger's link
works with no environment variable set anywhere. If you name it something else, set
`NEXT_PUBLIC_TRY_URL` on the **Ledger** project to the new URL and redeploy the Ledger.

`NEXT_PUBLIC_TRY_URL` is a build-time constant, not a runtime read. It is inlined when the Ledger
is built, which is what lets `judge-path.test.ts` read the fallback out of the source and prove
the URL is only ever an anchor's `href` and never something the page fetches.

## Environment variables

None are required on the try project. There is no GitHub token by design: a token would mean
asking a stranger to trust this deployment with a scope, and it would give the deployment
something to leak. The cost of going without one is GitHub's unauthenticated rate limit, and the
route answers a rate-limited read with a sentence rather than a stack trace.

## What one request costs

One GitHub API call for the tree, then one `raw.githubusercontent.com` fetch per markdown document
up to the bounds in `apps/try/lib/limits.ts`: 200 files, 2 MB in total, 512 KB per file, 8 at a
time, 8 seconds of reading. A successful response is cached at the edge for an hour on the commit
sha, so a repository that gets attention is read once.

No Kane, no browser, no clone, no install. Credits spent: zero, the reader's and the author's
alike. Every promise the page returns has no verdict, because no run happened.

## Running it locally

```bash
npm run dev:try     # next dev apps/try -p 3300
```

Port 3300 keeps it clear of the Ledger on 3000 and the fixture on 3100, so all three can run at
once. `npm run demo` deliberately does not start it: the demo's claim is that it invokes Kane zero
times and needs no network, and this page needs a network.

## Checks that cover it

```bash
npm run typecheck:try           # app/, components/ and their JSX, with the DOM libs
npx tsc -b                      # lib/ and test/ under a no-DOM lib, from the solution root
npx vitest run --project try     # the URL parser, the bounds, the admission wiring
```

All three are inside `npm run check`. The split between the two type-check passes is the point:
the parsing and the admission wiring are checked with no DOM available, which is how the claim
that they are the same logic the CLI runs stays honest.
