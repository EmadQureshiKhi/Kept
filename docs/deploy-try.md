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

## The build is configured in a file, not in the dashboard

`apps/try/vercel.json` holds it:

```json
{
  "framework": "nextjs",
  "installCommand": "cd ../.. && npm ci --no-audit --no-fund",
  "buildCommand": "cd ../.. && npx tsc -b packages/kept-core && npx next build apps/try",
  "outputDirectory": ".next"
}
```

There are **two** `vercel.json` files in this repository and that is deliberate. The one at the
root configures the Ledger and is live; this one configures the try page. Vercel reads the file
from a project's Root Directory, so the way to give two applications in one repository two
different builds is to give them two Root Directories and a config file each. Editing the root
file to serve both would mean one project building the other's output.

Three things in it are load-bearing.

**`cd ../..` in both commands.** Root Directory is `apps/try`, so commands start there, and both
the lockfile and every dependency live at the workspace root. `apps/try/package.json` declares no
dependencies of its own on purpose: it exists so Vercel has a manifest to detect a Next application
by, and the root manifest stays the one place a version is pinned. This needs **Include source
files outside of the Root Directory** left enabled, which is Vercel's default.

**`tsc -b packages/kept-core` before `next build`.** Not a type-check for its own sake. `apps/try`
imports `kept-core`, which is consumed from its built output, so the build has to happen before
Next resolves the import. Without it the deploy fails with `Cannot find module 'kept-core'`.

**`outputDirectory` is `.next`, relative to the Root Directory.** `next build apps/try` writes to
`apps/try/.next`, which is `.next` as seen from `apps/try`. Writing the full path here would look
for `apps/try/apps/try/.next`.

## Vercel settings

Create a second project against the same Git repository. Only one setting has to be changed from
the defaults.

| Setting | Value |
|---|---|
| Project Name | `kept-try` |
| Framework preset | Next.js, detected |
| **Root Directory** | **`apps/try`** |
| Build Command | from `vercel.json`, leave the dashboard field empty |
| Output Directory | from `vercel.json`, leave the dashboard field empty |
| Install Command | from `vercel.json`, leave the dashboard field empty |
| Node version | 20.x or later |

A value typed into the dashboard overrides `vercel.json`, so leaving those three fields empty is
what keeps the configuration in the repository where it is reviewable.

### Why the project name matters

`kept-try` gives `kept-try.vercel.app`, and that exact host is the fallback compiled into
`apps/ledger/components/Masthead.tsx`. A matching name means the Ledger's link works with no
environment variable set anywhere. If you name it something else, set `NEXT_PUBLIC_TRY_URL` on the
**Ledger** project to the new URL and redeploy the Ledger.

`NEXT_PUBLIC_TRY_URL` is a build-time constant, not a runtime read. It is inlined when the Ledger
is built, which is what lets `judge-path.test.ts` read the fallback out of the source and prove the
URL is only ever an anchor's `href` and never something the page fetches.

## Type errors do not fail the deploy, and that is not a loosening

`apps/try/next.config.mjs` sets `typescript.ignoreBuildErrors`, the same as the Ledger's config and
for the same reason. `npm run check` is the gate: the read-only scan, `tsc -b` over the solution,
three per-application type-check passes and the whole suite, all before a commit. What the flag
removes is a second, weaker copy of that check running on a build host, where `npm ci` can resolve
a transitive `@types` package to a different patch than the tree it was written against and Next
regenerates `.next/types` per build. A mismatch there fails a deploy for a reason no local command
reproduces.

There is deliberately no `eslint` block. Next 16 rejects the key outright, and there is no ESLint
configuration in this repository for it to have suppressed.

## Environment variables

None are required on either project. Two are read if present.

| Variable | Set on | Effect |
|---|---|---|
| `NEXT_PUBLIC_TRY_URL` | the Ledger | where the masthead's `Try your repo` link points |
| `NEXT_PUBLIC_LEDGER_URL` | the try project | where this page's lockup links back to |

Both fall back to the production hosts, so a deployment with nothing configured works. Set them
only when you want a preview of one side to point at a preview of the other.

There is no GitHub token by design. A token would mean asking a stranger to trust this deployment
with a scope, and it would give the deployment something to leak. The cost of going without one is
GitHub's unauthenticated rate limit of sixty API requests an hour per address, and a rate-limited
read answers with a sentence saying so.

## Timeouts, retries and the budget

The numbers are in `apps/try/lib/limits.ts` and they nest deliberately, largest first.

| Bound | Value | Why |
|---|---|---|
| Route `maxDuration` | 60 s | the platform's ceiling, raised from its 10 s default |
| Client `fetch` timeout | 45 s | so a lost connection cannot leave the page reading forever |
| `READ_BUDGET_MS` | 25 s | reading stops here, so the *page* explains itself rather than the platform |
| `TREE_TIMEOUT_MS` | 20 s | one request, and it can be tens of megabytes |
| `REQUEST_TIMEOUT_MS` | 10 s | any single document |
| `MAX_ATTEMPTS` | 3 | with a 400 ms backoff that doubles |

Retried: a timeout, a dropped socket, a 5xx, a 429. Not retried: a 404, a 403 or a 451, because
those are GitHub deciding rather than failing, and asking again gets the same answer while spending
another of the hour's sixty requests.

Every bound reports itself in the response's `notes` rather than failing the read, including the
retries: a slow read says it was slow. The one case that becomes a failure is a tree that listed
documents and a read that transferred none of them, because "no claims found" and "nothing could
be transferred" are not the same answer and must not read alike.

## What one request costs

One GitHub API call for the default branch, one for the recursive tree, then one
`raw.githubusercontent.com` fetch per markdown document up to 200 files, 2 MB in total and 512 KB
per file, eight at a time. The raw host is not part of the API budget, so a read spends two of the
sixty.

Measured, on this machine, against a cold cache:

| Repository | Documents | Time |
|---|---|---|
| `sindresorhus/ky` | 2 | 1.3 s |
| `EmadQureshiKhi/Kept` | 47 | 3.4 s |
| `vercel/next.js` | 200 of 509 offered | 16 s |

A successful response is cached at the edge for an hour on the commit sha, so a repository that
gets attention is read once and every later reader gets it instantly.

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
npm run typecheck:try          # app/, components/ and their JSX, with the DOM libs
npx tsc -b                     # lib/ and test/ under a no-DOM lib, from the solution root
npx vitest run --project try   # the URL parser, the bounds, the retry policy, the gate
```

All three are inside `npm run check`. The split between the two type-check passes is the point:
the parsing and the admission wiring are checked with no DOM available, which is how the claim
that they are the same logic the CLI runs stays honest.

There is also an HTTP sweep, which needs a server and a network:

```bash
npm run dev:try                # in one terminal
node tools/verify-try.mjs      # in another
```

It presses all three example buttons, asserts the graph it gets back for this repository is the
same thirteen promises the CLI finds, and checks every refusal. That last part is why it exists:
the page fetches what it is pointed at, so the parser is a security boundary and the sweep is what
proves the boundary holds against a paste rather than against a unit test's idea of one.
