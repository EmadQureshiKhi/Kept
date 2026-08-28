# @corgod/kept-cli

The `kept` command. [KEPT](https://github.com/EmadQureshiKhi/Kept) graphs every claim your product
makes about itself, cites each one to the file and line that states it, binds each to a Kane CLI
test, and publishes the verdicts. You cannot break what was never proven to work.

```bash
npm install -g @corgod/kept-cli
```

Commands: `init`, `build`, `verify`, `reconcile`, `evolve`, `amend`, `snapshot`, `handoff`,
`doctor`.

## Prerequisites

- **Node 20.19.4 or newer.**
- **Kane CLI on your `PATH`,** authenticated with **your own account**. See the section below.
- **A local Chrome.** Kane drives a real browser to earn a verdict, which is why no hosted service
  can run this for you.

## Bring your own Kane credentials

**KEPT ships no keys, stores no keys and reads none of yours.** It never bundles, installs or
vendors `kane-cli`: it spawns whatever is on your `PATH` and parses the NDJSON that binary writes.
Authentication, billing and credit consumption are entirely between you and Kane, and Kane is what
bills. Nothing you install from npm here can spend anything.

So install and log in to Kane yourself, following Kane's own documentation:

```bash
npm install -g kane-cli     # or however Kane distributes it for you
kane-cli --version          # KEPT is developed against 0.8.4
kane-cli login              # your account, your credits
```

Then confirm KEPT can see it:

```bash
kept doctor
```

Check 1 reports the resolved binary path and the version it answered with. If it reports the binary
missing, that is a supported state rather than a crash, and the check names the remedy.

**Without Kane authenticated you still get most of the product**, which is deliberate:

| Command | Without Kane |
|---|---|
| `kept init` | works fully, zero invocations |
| `kept doctor` | works fully, reports Kane as missing with a remedy |
| `kept build` | works: reads your documents, cites them, binds designed tests. The coverage axis is **withheld** rather than reported as zero, and the graph says so |
| `kept snapshot` | works, writes the ledger from whatever the graph honestly holds |
| `kept verify` | needs Kane. This is the command that earns verdicts and spends credits |
| `kept reconcile`, `kept evolve` | need Kane |

That split is the point. A graph with no verdicts tells you what you have promised and what you owe;
it simply refuses to claim anything was proven. Authenticating Kane is what turns the owed column
into an earned one.

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
