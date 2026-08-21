# Deploying the Ledger

Five minutes, no environment variables, no secrets. The build reads a file that is
already committed, so there is nothing to configure that could leak.

`vercel.json` at the repository root already carries every build setting. This
document is the dashboard half — the two clicks the file cannot make for you — plus
what to check afterwards.

## First, the thing that trips everyone up

**Leave the Root Directory empty. Do not set it to `apps/ledger`.**

`apps/ledger` has no `package.json`, deliberately (design §15.2, and the reasoning is
in `scripts/demo.mjs`). It is not an npm workspace member; the root manifest holds
every dependency, including `next`, and the root scripts are `typecheck:ledger` and
friends. Vercel detects the framework by reading the `package.json` in the Root
Directory and looking for `next` in its dependencies. Point it at `apps/ledger` and it
finds no manifest at all, reports **"No Next.js version detected"**, and there is no
setting that rescues it.

So the project root *is* the monorepo root. That is also what makes the task's
"install `npm ci` at the monorepo root" fall out for free: the install command runs in
the Root Directory, and the Root Directory is the monorepo root. The app directory is
named by the build command instead — `next build apps/ledger` — and the output is
picked up from `apps/ledger/.next`.

## The settings, in order

1. **Add New → Project**, import `EmadQureshiKhi/Kept`.
2. **Framework Preset**: Next.js. (Vercel should pick this up from the root
   `package.json`. If it says "Other", set it by hand.)
3. **Root Directory**: leave it **blank**. See above.
4. **Build and Output Settings**: leave every field untouched. `vercel.json` overrides
   all three of them and takes precedence over the dashboard:

   | field | value | why |
   |---|---|---|
   | Install Command | `npm ci` | the lockfile is at the root, and so are we |
   | Build Command | `next build apps/ledger` | the app is not its own package, so it is named as an argument |
   | Output Directory | `apps/ledger/.next` | where that build writes |

5. **Environment Variables**: **add none.** Not one. The build reads
   `apps/ledger/data/ledger.snapshot.json` off disk; there is no API to key, no
   database to address and no Kane to authenticate. Kane needs a local Chrome and
   cannot run here anyway (assumption A9), and this design does not want it to.
6. **Deploy.**

`npm ci` at the root installs the whole workspace, which is more than the Ledger
strictly needs. That is the trade for not having a manifest per app, and it costs
install seconds rather than correctness.

### If the build fails on `next: command not found`

Vercel puts `node_modules/.bin` on `PATH` for the build command, so it should not. If
it does, change the build command to the spelling that depends on no `PATH` at all —
the same one `scripts/demo.mjs` uses, and the one measured below:

```
node node_modules/next/dist/bin/next build apps/ledger
```

Edit it in `vercel.json` rather than in the dashboard, so the next person sees it.

## Then one edit to `README.md`

R13.9 wants the deployed URL inside the README's first 20 lines. Line 9 currently reads:

```
- **Live Ledger** — `LEDGER_URL_PENDING_DEPLOY`
```

Replace the backticked token, backticks included, with the HTTPS URL Vercel gives you.
That is the whole edit. `packages/kept-core/test/readme-front-matter.test.ts` is
watching that line: while the token is there it holds you to the token, and the moment
a real URL replaces it the suite starts asserting R13.9 against the URL instead —
inside the first 20 lines, HTTPS, not localhost. There is one `it.todo` in that file
naming this edit, and it disappears when you make it.

## What to check afterwards

Four things, in the order they can go wrong.

1. **It is HTTPS and it is public.** Open the URL in a private window. No login wall,
   no Vercel authentication interstitial. If Vercel enabled Deployment Protection on
   the project, turn it off for production — R8.5 and R14.6 both say a judge reaches
   this with no account.
2. **It serves the committed snapshot.** The landing view shows the promise graph, and
   its figures should match the committed file exactly. Read the file:

   ```
   node -e 'const s=require("./apps/ledger/data/ledger.snapshot.json"); console.log(s.metrics);'
   ```

   At the commit this document was written against that is **8 promises, 7 proven, 1
   red, 0 stale, designed coverage 1, proven coverage withheld as `null`**. Re-read it
   rather than trusting those numbers — the point is that the page and the file agree.
   A page showing eight `stale` promises is serving a build from before the recorded
   replay landed.
3. **Kane was invoked zero times.** Read the Vercel build log and search it for `kane`.
   Expected: nothing, other than the string appearing inside the refusal message the
   Ledger renders verbatim. Two suites already hold the source side of this —
   `packages/kept-core/test/judge-path.test.ts` scans the whole spawn closure and
   `apps/ledger/test/read-only-scan.test.ts` plus `scripts/check-readonly.mjs` scan the
   app — so the build log is a confirmation, not the proof.
4. **No environment variable is set.** Project → Settings → Environment Variables
   should be an empty list. If anything is there, it did not come from this
   repository, and it should go.

Also worth a look: every route in the build output should be marked static. The local
build prerenders all seven — `/`, `/_not-found`, `/amendments`, `/badge.svg`,
`/coverage`, `/reviews`, `/runs` — and a route that turns dynamic is a route that grew
a server, which is the read-only guarantee slipping (R8.4).

## Measured locally, before any deploy

The build command in `vercel.json` was run at the repository root on the committed tree:

```
$ node node_modules/next/dist/bin/next build apps/ledger
▲ Next.js 16.3.1 (Turbopack)
✓ Compiled successfully in 4.9s
  Finished TypeScript in 3.7s
✓ Generating static pages using 7 workers (8/8) in 272ms
```

Exit 0. Seven routes, all `○ (Static)`, prerendered as static content.
`apps/ledger/.next/routes-manifest.json` — the artefact Vercel looks for in the output
directory — is present. Nothing outside `apps/ledger/.next` was written: Next did not
rewrite `apps/ledger/tsconfig.json` or the root `package.json`, both checksummed either
side of the run. `.gitignore` already ignores `.vercel` and `.next`, so a local
`vercel` login leaves no trace in the diff.

What this does *not* prove is the hosted half: the install, the framework detection and
the output pickup are Vercel's, and the only way to measure those is to deploy. The
Root Directory reasoning above is why they are expected to hold, and the
`next: command not found` note is what to do if the build half does not.
