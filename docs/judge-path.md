# The judge path, measured

`npm run demo` is the whole of what a judge has to run (R13.1–R13.3, design §15.1).
This file records what it costs, because "under thirty seconds" is a claim about a
clock and the only honest way to make it is to have looked at one.

Two guards keep the claim from drifting once it is written down:

- `packages/kept-core/test/judge-path.test.ts` scans `scripts/demo.mjs` and
  everything it transitively spawns for a Kane invocation, a subprocess, a
  credential read or an origin beyond localhost, and reads the figures below back
  out of this file to check them against R13.1's thirty-second ceiling. Edit a
  number here and the suite re-checks it; delete the line and the suite fails.
- `apps/ledger/test/read-only-scan.test.ts` and `scripts/check-readonly.mjs` hold
  the other half: the Ledger cannot start a process or authenticate a request even
  if a later commit wanted it to.

## What was measured

Wall clock from the moment `npm run demo` was issued to the moment
`http://localhost:3000/` returned a 200 whose body contained the landing
headline — the rendered landing view, not the port opening. The fixture figure is
the same measurement against `http://localhost:3100/`. Node 20.19, macOS, three
repeated runs, dependencies already installed.

- Ledger landing view: **3.6 s** slowest of three runs (2.4 s, 2.7 s, 3.6 s)
- Fixture landing view: **4.6 s** slowest of three runs (3.7 s, 3.8 s, 4.6 s)
- Ledger reload once warm: 37–40 ms

Both are inside R13.1's thirty seconds with room to spare, which is what design
§15.1 predicted at "t ≈ 3 s": the landing view is statically rendered from
`apps/ledger/data/ledger.snapshot.json`, so there is no data fetch to wait for and
nothing to compile beyond the page itself.

## The one anomalous run

The very first `next dev` in a freshly installed tree took **383 s** on this
machine, and the number is recorded rather than discarded because a reader
deserves to know it happened. It is the storage-latency cost already documented in
`vitest.config.ts`, not a property of the demo: this working tree sits under an
iCloud-synced directory, and during that run the file provider daemon held a core
at 81% while Next materialised its first build cache. Every run after it, including
one with `apps/ledger/.next` deleted, landed in under four seconds. A judge with
the deployed HTTPS URL in the README's first twenty lines never pays even that
once (R13.9).

## What did not happen

Zero Kane invocations, zero credits, zero credentials, zero requests off localhost.
The demo starts exactly two processes — `next dev -p 3000` in `apps/ledger` and
`next dev -p 3100` in `apps/fixture` — both through this repository's own Node, both
routed through `assertNoKaneInvocation` first. Ctrl-C stops both and both sockets
close; the live Kane loop is a separate command, `npm run loop`, documented with its
prerequisites.
