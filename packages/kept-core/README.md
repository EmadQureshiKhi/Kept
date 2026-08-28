# kept-core

The library half of [KEPT](https://github.com/EmadQureshiKhi/Kept): every promise your product
makes about itself, and continuous proof it is still kept.

This package is the contract layer. It holds the promise model and citation rules, the Kane CLI
NDJSON parser and its three completion contracts, the verdict router, the blast radius, the three
repair surfaces, the single write guard, and the snapshot schema the read-only Ledger reads. It
spawns nothing on its own and writes nothing on its own.

Most people want [`@corgod/kept-cli`](https://www.npmjs.com/package/@corgod/kept-cli) instead. Install this one
directly only if you are building your own tooling on the same model.

```bash
npm install kept-core
```

## Prerequisites

- **Node 20.19.4 or newer.**
- **Kane CLI on your `PATH`, authenticated with your own account.** KEPT ships no keys, stores no
  keys and reads none of yours. It never bundles, installs or vendors `kane-cli`: it spawns whatever
  is on `PATH` and parses the NDJSON that binary writes. Authentication, billing and credits are
  entirely between you and Kane, and Kane is what bills. Install and log in to Kane yourself,
  following Kane's own documentation.
- **A local Chrome.** Kane drives a real browser to earn a verdict. No hosted service can do this
  part for you.

Neither prerequisite is needed to import this package or to read a snapshot. They are needed to
produce one. Without Kane authenticated the model still builds a graph and cites your documents; it
withholds the coverage figure rather than reporting a zero it has not earned.

## First step

Verification starts in a repository, not in a script:

```bash
npx @corgod/kept-cli init
```

That scaffolds the config and the designed-test corpus KEPT expects. The CLI package installs a
`kept` binary, so with it on your `PATH` the same first step reads `kept init`, and the steps after
it are `kept build` then `kept verify`.

## License

MIT.
