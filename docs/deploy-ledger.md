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
| Live at | **<https://withkept.vercel.app>** |
| Host | Vercel |
| Framework | Next.js 16.3 |
| Project root | the **monorepo root**, not `apps/ledger` — see below |
| Install | `npm ci` |
| Build | `tsc -b packages/kept-core && next build apps/ledger` |
| Output | `apps/ledger/.next` |
| Environment variables | **none** |
| Routes | 9, all statically prerendered |

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

## Why the build command starts with `tsc -b packages/kept-core`

**Because `@kept/core` is a workspace package that ships compiled output, and the compiled
output is not in the repository.**

The Ledger imports `@kept/core` in three places — `lib/snapshot.ts` for `parseSnapshot`,
`lib/runVocabulary.ts` for the exit meanings and the verdict contract, and
`components/AmendmentCard.tsx` for `amendedPromiseId`. `packages/kept-core/package.json`
resolves that specifier through `main` and `exports`, and both point at `./dist/index.js`.
`.gitignore` line 5 excludes `dist/`, so a fresh clone has none: `git ls-files
packages/kept-core/dist` returns nothing.

`npm ci` does create the symlink — `node_modules/@kept/core` → `packages/kept-core` — which
is why the failure is confusing. The package is *found*. Its entry point is what is
missing. Turbopack reports that as three `Module not found: Can't resolve '@kept/core'`
errors and the build exits 1.

Locally the specifier resolves only because `npm run check` runs `tsc -b` before anything
else, so `dist/` is sitting there from the last check. The build host has no such
history. **This was reproduced rather than reasoned about**: deleting
`packages/kept-core/dist` and running `next build apps/ledger` produces the same three
errors against the same three files as the failed deploy, and building the one package
clears all three.

Two details in the spelling are deliberate:

- **`packages/kept-core`, not a bare `tsc -b`.** A bare solution build also type-checks
  every package test suite and the Ledger's `lib/` and `test/` trees against the root
  `tsconfig.json`. That is exactly the second, weaker copy of the type check that
  `apps/ledger/next.config.mjs` explains removing — `@types` drift under a lockfile
  install can fail it for a reason no local command reproduces. The Ledger needs one
  package built; the build command builds one package.
- **It emits, so it cannot be `--noEmit`.** `dist/index.js` and `dist/index.d.ts` are the
  artefact, not a side effect. `typescript` is a root `devDependency` and Vercel installs
  dev dependencies by default, so `tsc` is on `PATH` for the same reason `next` is.

The pinning test accepts this: it asserts the build command *ends by naming the app
directory*, not that it is the only thing in the command.

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

The build command from `vercel.json`, run at the repository root on the committed tree —
**with `packages/kept-core/dist` deleted first**, so the starting state is the one a fresh
clone has rather than the one a local `npm run check` leaves behind:

```console
$ rm -rf packages/kept-core/dist
$ tsc -b packages/kept-core && node node_modules/next/dist/bin/next build apps/ledger
▲ Next.js 16.3.1 (Turbopack)
✓ Running next.config.mjs took 8ms
  Creating an optimized production build ...
✓ Compiled successfully in 2.8s
  Skipping validation of types
✓ Generating static pages using 7 workers (10/10) in 239ms
Turbopack build encountered 4 warnings:
```

Exit 0. Nine routes, every one marked `○ (Static)` and prerendered — `/`, `/_not-found`,
`/amendments`, `/apple-icon.png`, `/badge.svg`, `/coverage`, `/icon.png`, `/reviews`,
`/runs`. `apps/ledger/.next/routes-manifest.json` — the artefact Vercel looks for in the
output directory — is present.

`Skipping validation of types` is `next.config.mjs` doing what its comment says; the type
check ran locally under `npm run check`.

**The four warnings are expected and not a failure.** They are output-tracing notices
against `packages/kept-core/dist/kane/evidence.js`, which calls `resolve()` and `join()` on
paths the tracer cannot statically scope, so the tracer widens what it includes in the
server bundle. That module is on the import graph because `lib/snapshot.ts` pulls the
snapshot model through the `@kept/core` barrel, and it is never *called* on any route: the
Ledger reads evidence through the committed `publicPath` values, which is the whole point
of R13.4. The cost is a larger traced bundle, not a behaviour change. Removing them means
splitting the barrel so the browser half never reaches the filesystem half, which is a
change to design §2.1's single-entry-point rule and wants its own decision.

Deleting `dist/` and re-running is also the check that the first line of the build command
is load-bearing: without it, the same command fails with three
`Module not found: Can't resolve '@kept/core'` errors.

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
first 20 lines, and line 17 held a placeholder until the deploy landed. **That edit is
made**: line 17 now reads

```
- **Live Ledger** — [withkept.vercel.app](https://withkept.vercel.app)
```

and the `<!-- DEPLOY … -->` note beside it is gone, because an instruction to replace a
token that is no longer in the file is worse than no instruction.

The suite followed the line across on its own, which is the part worth knowing if you ever
redeploy to a different host. While the placeholder was there it held the README to *making
no URL claim at all* — not URL-shaped, no `deployed at`, no second HTTPS address in the
front matter — and an `it.todo` printed the pending edit in every run's summary so it could
not be forgotten in a document. The moment a real URL replaced the token, that block went
quiet and the opposite block woke up: exactly one HTTPS URL on the bullet, not localhost, a
host with a dot in it, not the repository URL by mistake, and still inside line 20. Nothing
was re-enabled by hand and no assertion was relaxed; the `it.todo` is discharged and the
file's test count drops by one.

### If the build fails on `next: command not found` or `tsc: command not found`

Vercel puts `node_modules/.bin` on `PATH` for the build command, so it should not. If it
does, use the spelling that depends on no `PATH` at all — the same one `scripts/demo.mjs`
uses for `next`, and the one measured above:

```
node node_modules/typescript/bin/tsc -b packages/kept-core && node node_modules/next/dist/bin/next build apps/ledger
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
prerenders all nine — `/`, `/_not-found`, `/amendments`, `/apple-icon.png`, `/badge.svg`,
`/coverage`, `/icon.png`, `/reviews`, `/runs`. A route that turns dynamic is a route that
grew a server, which is the read-only guarantee of Requirement 8.4 slipping.

### Measured on the live deployment

Run against `https://withkept.vercel.app` after the first successful deploy.

Every route answers, and the two icon routes confirm the build served the branding
artefacts rather than a placeholder — `/icon.png` comes back at 15,649 bytes, which is the
favicon as built:

| Route | Status | Bytes | Content type |
|---|---|---|---|
| `/` | 200 | 105,920 | `text/html` |
| `/amendments` | 200 | 22,578 | `text/html` |
| `/coverage` | 200 | 31,594 | `text/html` |
| `/reviews` | 200 | 12,131 | `text/html` |
| `/runs` | 200 | 203,269 | `text/html` |
| `/badge.svg` | 200 | 569 | `image/svg+xml` |
| `/icon.png` | 200 | 15,649 | `image/png` |
| `/apple-icon.png` | 200 | 8,981 | `image/png` |
| a path that does not exist | 404 | 11,026 | `text/html` |

**Public, and static rather than server-rendered.** The response headers on `/` carry
`x-nextjs-prerender: 1` and `x-vercel-cache: HIT`, with no `set-cookie` and no `location`
redirect — so there is no Deployment Protection interstitial and no session to acquire. The
prerender header is the one that matters for Requirement 8.4: it is the host stating the
page was built ahead of the request, not rendered for it.

**The page agrees with the committed file.** Rendered text off the live landing view:
8 promises with the red one first, `p_45ccecba7aa5` at `apps/fixture/README.md:20` — the
10-percent-discount claim that was never true — then seven proven. The rail reads
`baseline data only` where proven coverage would go and `100 %` for designed coverage,
which is `provenCoverage: null` and `designedCoverage: 1` in
`apps/ledger/data/ledger.snapshot.json` rendered honestly: the withheld figure is a phrase
rather than a zero.

One thing that looks like a bug and is not: the freshness chip reads a fixed relative age
rather than counting up as the page ages. `app/page.tsx` passes `snapshot.generatedAt` as
`now`, not the wall clock, so the chip states the gap between the run and the snapshot —
a fact about the artefact, true for as long as the artefact is. Reading the real clock on a
prerendered page would make one snapshot render as two different pages, and the exact
instant is on the chip's `title` either way.
