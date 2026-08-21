# How the Ledger is deployed

**What this is for.** The Ledger is the one artefact a reader reaches without installing
anything, so how it is built matters to whether its numbers can be trusted. This file
states the deployment's shape, the one unusual thing about it and why, what was measured
locally before any deploy, and the exact steps to reproduce it.

The short version: **no environment variables, no secrets, and Kane is never invoked.**
The build reads a file that is already committed, so there is nothing to configure that
could leak and nothing to authenticate against.

| | |
|---|---|
| Host | Vercel |
| Framework | Next.js 16.3 |
| Project root | the **monorepo root**, not `apps/ledger` — see below |
| Install | `npm ci` |
| Build | `next build apps/ledger` |
| Output | `apps/ledger/.next` |
| Environment variables | **none** |
| Routes | 7, all statically prerendered |

Every one of those settings is committed in `vercel.json` at the repository root, so the
dashboard is not the source of truth for any of them.

## The one unusual thing, and why it is not a mistake

**The project root is the monorepo root. It is deliberately not `apps/ledger`.**

`apps/ledger` has no `package.json` of its own. That is a design decision rather than an
omission: the root manifest holds every dependency including `next`, and the app is a
directory in a workspace rather than a package. Vercel detects a framework by reading the
`package.json` in the configured root directory and looking for `next` among its
dependencies — so pointing it at `apps/ledger` finds no manifest at all, reports
**"No Next.js version detected"**, and no other setting rescues it.

Two things follow, and both look odd until you know the above:

- The app directory is named as an **argument to the build command**,
  `next build apps/ledger`, rather than by the root setting.
- "Install at the monorepo root" falls out for free, because the install command runs in
  the root directory and the root directory *is* the monorepo root.

An edit that tidies this into the obvious-looking pairing — root `apps/ledger`, build
`next build` — produces a framework-detection failure that no local command reproduces.
`packages/kept-core/test/readme-front-matter.test.ts` therefore pins the shape: it asserts
the build command names the app directory, the output directory matches, and
`apps/ledger/package.json` still does not exist, since that absence is what forces the
arrangement.

`npm ci` at the root installs the whole workspace, which is more than the Ledger strictly
needs. That is the trade for not having a manifest per app, and it costs install seconds
rather than correctness.

## Why there are no environment variables

Not "none needed yet" — none possible. The build reads
`apps/ledger/data/ledger.snapshot.json` off disk. There is no API to key, no database to
address, and no Kane to authenticate: Kane drives a real browser, needs a local Chrome
installation, and cannot run on a build host at all.

That is the point of the committed snapshot. It makes the deployed page a pure function of
a file in the repository, so the same commit produces the same pixels, and a reader can
open the file and the page side by side and compare them.

`vercel.json` carries no `env` block and no `build.env` block, and the same test asserts
the file contains no `KANE`, `API_KEY`, `TOKEN` or `SECRET` string at all.

## Measured locally, before any deploy

The build command from `vercel.json`, run at the repository root on the committed tree:

```console
$ node node_modules/next/dist/bin/next build apps/ledger
▲ Next.js 16.3.1 (Turbopack)
✓ Compiled successfully in 4.9s
  Finished TypeScript in 3.7s
✓ Generating static pages using 7 workers (8/8) in 272ms
```

Exit 0. Seven routes, every one marked `○ (Static)` and prerendered.
`apps/ledger/.next/routes-manifest.json` — the artefact Vercel looks for in the output
directory — is present. Nothing outside `apps/ledger/.next` was written: neither
`apps/ledger/tsconfig.json` nor the root `package.json` changed, both checksummed either
side of the run.

**What this does not prove.** The install, the framework detection and the output pickup
are the host's, and the only way to measure those is to deploy. The root-directory
reasoning above is why they are expected to hold; the note further down is what to do if
the build half does not.

## Reproducing it

1. **Add New → Project**, import the repository.
2. **Framework Preset**: Next.js. Vercel should read this from the root `package.json`; if
   it says "Other", set it by hand.
3. **Root Directory**: leave it **blank**. See above — this is the step that matters.
4. **Build and Output Settings**: leave every field untouched. `vercel.json` overrides all
   three and takes precedence over the dashboard.
5. **Environment Variables**: add none.
6. **Deploy.**

Then one edit to `README.md`. Requirement 13.9 wants the deployed URL inside the README's
first 20 lines, and line 17 currently reads:

```
- **Live Ledger** — `LEDGER_URL_PENDING_DEPLOY`
```

Replace the backticked token, backticks included, with the HTTPS URL. That is the whole
edit, and the suite is watching that one line: while the placeholder is there it holds the
README to *making no URL claim at all*, and the moment a real URL replaces it the same file
starts asserting Requirement 13.9 against the URL instead — inside the first 20 lines,
HTTPS, and not localhost. A single `it.todo` names the edit and prints in every run's
summary until it is made, so it cannot be forgotten in a document.

### If the build fails on `next: command not found`

Vercel puts `node_modules/.bin` on `PATH` for the build command, so it should not. If it
does, use the spelling that depends on no `PATH` at all — the same one `scripts/demo.mjs`
uses, and the one measured above:

```
node node_modules/next/dist/bin/next build apps/ledger
```

Change it in `vercel.json` rather than in the dashboard, so the next reader sees it.

## What to check on a live deployment

Four things, in the order they can go wrong.

1. **It is HTTPS and it is public.** Open the URL in a private window: no login wall and no
   deployment-protection interstitial. Requirements 8.5 and 14.6 both say a reader reaches
   this with no account. If the host enabled Deployment Protection, turn it off for
   production.
2. **It serves the committed snapshot.** The landing figures should match the committed
   file exactly:

   ```bash
   node -e 'const s=require("./apps/ledger/data/ledger.snapshot.json"); console.log(s.metrics);'
   ```

   At the commit this was written against: **8 promises, 7 proven, 1 red, 0 stale, designed
   coverage 1, proven coverage withheld as `null`**. Re-read the file rather than trusting
   those figures — the check is that the page and the file agree. A page showing eight
   `stale` promises is serving a build from before the recorded replay landed.
3. **Kane was invoked zero times.** Search the build log for `kane`. Expected: nothing,
   beyond the string appearing inside a refusal message the Ledger renders verbatim. Two
   suites already hold the source side of this — `judge-path.test.ts` scans the whole spawn
   closure, and `read-only-scan.test.ts` with `scripts/check-readonly.mjs` scans the app —
   so the build log is a confirmation rather than the proof.
4. **No environment variable is set.** Settings → Environment Variables should be an empty
   list. Anything there did not come from this repository.

Also worth a look: every route in the build output should be marked static. The local build
prerenders all seven — `/`, `/_not-found`, `/amendments`, `/badge.svg`, `/coverage`,
`/reviews`, `/runs`. A route that turns dynamic is a route that grew a server, which is the
read-only guarantee of Requirement 8.4 slipping.
