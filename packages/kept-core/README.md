# @kept/core

The library half of [KEPT](https://github.com/EmadQureshiKhi/Kept): every promise your product
makes about itself, and continuous proof it is still kept.

This package is the contract layer. It holds the promise model and citation rules, the Kane CLI
NDJSON parser and its three completion contracts, the verdict router, the blast radius, the three
repair surfaces, the single write guard, and the snapshot schema the read-only Ledger reads. It
spawns nothing on its own and writes nothing on its own.

Most people want [`@kept/cli`](https://www.npmjs.com/package/@kept/cli) instead. Install this one
directly only if you are building your own tooling on the same model.

```bash
npm install @kept/core
```

## Prerequisites

- **Node 20.19.4 or newer.**
- **Kane CLI on your `PATH`.** KEPT never bundles, installs or vendors `kane-cli`. It spawns
  whatever is on `PATH` and parses the NDJSON it writes. You bring your own binary and your own
  credentials, because Kane is what bills.
- **A local Chrome.** Kane drives a real browser to earn a verdict. No hosted service can do this
  part for you.

Neither prerequisite is needed to import this package or to read a snapshot. They are needed to
produce one.

## First step

Verification starts in a repository, not in a script:

```bash
npx kept init
```

That scaffolds the config and the designed-test corpus KEPT expects. Then `kept build` and
`kept verify`.

## License

MIT.
