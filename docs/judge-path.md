# The judge path, measured

**What this is for.** `npm run demo` is the whole of what a reader has to run, and
Requirement 13.1 — cited as `R13.1` in the specs and the test suite — gives it thirty
seconds to reach a rendered landing view. "Under thirty seconds" is a claim about a clock,
and the only honest way to make one is to have looked at a clock, so this file records the
figures, the method, and the one run that did not fit the pattern.

```bash
npm ci          # once
npm run demo    # Ledger on :3000, fixture on :3100
```

Zero Kane invocations, zero credits, zero credentials, zero requests off localhost.

## What was measured

Wall clock from the moment the command was issued to the moment `http://localhost:3000/`
returned a 200 whose body contained the landing headline — **the rendered landing view,
not the port opening**, because a port that accepts a connection before the page exists is
not what Requirement 13.1 is about. The fixture figure is the same measurement against
`http://localhost:3100/`.

Method: Node 20.19, macOS, three repeated runs, dependencies already installed. The slowest
of the three is reported rather than the mean, because the claim is a ceiling.

- Ledger landing view: **3.6 s** slowest of three runs (2.4 s, 2.7 s, 3.6 s)
- Fixture landing view: **4.6 s** slowest of three runs (3.7 s, 3.8 s, 4.6 s)
- Ledger reload once warm: 37–40 ms

Both are inside Requirement 13.1's thirty seconds with room to spare, which is what the
design predicted at roughly three seconds: the landing view is statically rendered from
`apps/ledger/data/ledger.snapshot.json`, so there is no data fetch to wait for and nothing
to compile beyond the page itself.

## The one anomalous run

The very first `next dev` in a freshly installed tree took **383 s**. It is recorded rather
than discarded, because a reader deserves to know it happened and because discarding an
inconvenient measurement is the habit this project exists to argue against.

It is a storage-latency cost, not a property of the demo. The tree these figures were taken
on sits under a cloud-synced directory, and during that run the file provider daemon held a
core at 81% while Next materialised its first build cache. The same latency is documented in
`vitest.config.ts` and it is what produced the spurious `git fsck` failure recorded in
[`commit-history-audit.md`](commit-history-audit.md).

Every run after it landed under four seconds, including one with `apps/ledger/.next` deleted
to force a cold build. A reader who opens the deployed URL — which the README carries in its
first twenty lines — never pays even that once.

## What the demo does not do

The demo starts exactly two processes: `next dev -p 3000` in `apps/ledger` and
`next dev -p 3100` in `apps/fixture`, both through this repository's own Node. `Ctrl-C` stops
both and both sockets close.

It invokes Kane zero times, spends zero credits, reads no credential, and reaches nothing
beyond localhost. The live Kane loop is a separate command, `npm run loop`, documented in the
README with its prerequisites of a local Chrome installation and Kane CLI credentials.

"Reaches nothing" is about what the page loads, and it is worth saying exactly where the line
falls, because the colophon at the foot of every route carries two outbound links — the
repository and the documents. Neither is a request. No font, script, image, stylesheet or
`fetch` names a host other than localhost, so a Ledger sitting open on a laptop with the
network unplugged renders identically; the two links do nothing at all until a person clicks
one, and clicking one leaves the Ledger. The suite below holds precisely that distinction: an
absolute URL is allowed in an anchor's `href` and nowhere else.

## How these claims are held

Two suites keep the figures and the guarantee from drifting apart once they are written down:

- **`packages/kept-core/test/judge-path.test.ts`** scans `scripts/demo.mjs` and everything it
  transitively spawns for a Kane invocation, a subprocess, a credential read or an origin
  beyond localhost. The origin rule reads *position* as well as host: a remote `src`,
  `srcSet`, `url()`, `@import`, `<link>` href, `<script src>`, font, `next/image` loader or
  domain, or argument to `fetch` fails it, and a URL in an anchor's `href` does not — the one
  case where naming a host loads nothing. Both directions are planted and asserted, so the
  allowance cannot widen quietly. It then reads the figures back out of *this file* and checks them against
  Requirement 13.1's thirty-second ceiling — so editing a number here re-checks it, and
  deleting the line fails the suite. Every one of its rules is also proven to fire against a
  planted violation, because a scan that cannot fail is not a scan.
- **`apps/ledger/test/read-only-scan.test.ts`** and **`scripts/check-readonly.mjs`** hold the
  other half: the Ledger cannot start a process or authenticate a request even if a later
  commit wanted it to.
