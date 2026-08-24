# @kept/cli

The `kept` command. [KEPT](https://github.com/EmadQureshiKhi/Kept) graphs every claim your product
makes about itself, cites each one to the file and line that states it, binds each to a Kane CLI
test, and publishes the verdicts. You cannot break what was never proven to work.

```bash
npm install -g @kept/cli
```

Commands: `init`, `build`, `verify`, `reconcile`, `evolve`, `amend`, `snapshot`, `handoff`,
`doctor`.

## Prerequisites

- **Node 20.19.4 or newer.**
- **Kane CLI on your `PATH`.** KEPT never bundles, installs or vendors `kane-cli`. It spawns
  whatever is on `PATH` and parses the NDJSON it writes, so you bring your own binary and your own
  credentials. Kane is what bills. A missing binary is a supported state: `kept doctor` reports it
  and exits 0.
- **A local Chrome.** Kane drives a real browser to earn a verdict, which is why no hosted service
  can run this for you.

## First step

```bash
kept init
```

`kept init` scaffolds the KEPT config and the designed-test corpus in the repository you run it in.
It is idempotent: run it twice and the second run writes nothing. Everything else assumes it has
run.

Then:

```bash
kept doctor      # what is present, what is missing, and the remedy for each
kept build       # read the claims, cite them, bind the designed tests
kept verify      # spawn Kane, route the verdicts
kept snapshot    # write the ledger snapshot
```

`kept doctor` is safe to run first and costs nothing: it probes Kane once on a 10-second budget and
spends zero credits.

## License

MIT.
