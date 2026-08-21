# Curated evidence packs

This directory holds the evidence a judge clicks. Everything in it is a committed
static file, so an artefact link in the Ledger is a plain `<a href="/evidence/...">`
served by Next's static handler: no Kane, no credentials, no network, no route
handler in front of it (R13.4, R13.5, design §15.3).

## How it fills

`kept snapshot` writes it. For every pack the promise graph references, the command
reads the sealed archive Kane left under `.testmuai/evidence/<executionId>.evidence`
and unzips the artefacts a reviewer would actually open into
`apps/ledger/public/evidence/<packId>/`, then rewrites every `publicPath` in
`apps/ledger/data/ledger.snapshot.json` to the resulting static URL.

Three artefact kinds are curated, and only three:

| kind | what it is |
|---|---|
| `annotated` | `annotated.png` — the marked-up capture of a failing step, the first thing worth looking at |
| `screenshot` | the per-step `screenshot.jpg` record of the run |
| `failure-yaml` | Kane's own triage note, whose categorised form is nested per failing step and spells its category at `triage.rca.category` |

Everything else a sealed pack carries — network HARs, console streams, runner logs,
the agent's `execution.json` and its trajectory summaries — is the bulk of the one
to three megabytes each pack weighs, and nothing in the Ledger links it. Committing
the archives wholesale would trade a clonable repository for files no reviewer opens.

`.gitignore` ignores `.testmuai/evidence/` for exactly that reason and force-negates
`!apps/ledger/public/evidence/`, so the curated copies are committed and the raw
packs are not.

## Why it is otherwise empty right now

Curation is driven by references, not by what happens to be on disk. The committed
snapshot carries `evidence: []` today because no verified run has landed yet, so no
promise carries an `evidencePackId` and there is nothing to curate. That is the
honest state: a pack copied here that no promise referenced would be a file a judge
could open and nothing could explain.

The wiring is in place and tested — `packages/kept-cli/test/snapshot-curation.test.ts`
drives the whole path over archives built byte by byte in the shape real packs have,
and additionally reads a genuine sealed pack when the machine running the suite has
one. The directory fills the first time a verification run seals a pack and the graph
records it.
