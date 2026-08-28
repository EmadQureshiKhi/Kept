# Commit history audit

**What this is for.** Requirement 14.2 asks for at least fifteen commits, each with a
message naming the change it makes. A submission checklist can only assert that; this
file measures it, so the claim is one you can check against the repository in front of
you rather than take on trust.

Reproduce every number below with one command:

```bash
git log --format='%H%x09%P%x09%an <%ae>%x09%aI%x09%s' --no-merges
```

Everything here falls out of that single pass. Nothing was counted by hand. The one figure
that pass cannot produce is the remote count, which comes from `git remote -v`, and it is
named separately below for that reason.

**This is an audit, not a rewrite.** The history is itself part of the evidence — it
shows the work happening inside the event window — so nothing was rebased, amended or
squashed to make a figure look better. Where the audit found nothing to report, that is
the finding, and it is stated as one.

## Measured at `2fde403`

| What | Measured |
| --- | --- |
| Commits reachable from `HEAD` | **188** |
| Requirement 14.2's floor | 15, cleared 12.5× over |
| Merge commits | 0, the history is a straight line |
| Root commits | 1 (`d5b4fc5`, `chore: initialise repo with Kane-aware gitignore`) |
| Authors | 1, `emadqureshikhi <emadqureshi965@gmail.com>` |
| First commit | 2026-08-20T05:16:03+05:00 |
| Last commit audited | 2026-08-21T23:31:34+05:00 |
| Subjects failing the conventional-commit pattern | 0 of 188 |
| `wip` / `fixup!` / `squash!` / `Merge` subjects | 0 |
| Duplicate subjects | 0 |
| Subject length | 31 shortest, 64 median, 106 longest |
| Configured remotes | **0. The tree is local-only** |

**What moved since the previous pass.** That pass measured 164 commits at `47fa56e`; this
one measures 188 at `2fde403`, so twenty-four commits landed in between and the head is a
different one. Everything about the *shape* is unchanged: still linear, still one author,
still every subject named, still entirely inside the event window. The figures that moved
are the counts, and they are re-stated below rather than adjusted.

**What has moved since, on the latest re-measurement: nothing.** Every figure in the table
above was re-taken and every one of them still holds. `HEAD` is still `2fde403`, the count is
still 188, the merge count is still 0, the author is still one, and no subject fails the
pattern. That is not a stale reading, it is the finding: the work of stages 23 to 26 is in the
working tree and has not been committed, so a document that measures *committed* history has
nothing new to measure. The audit reports the history as it is rather than as the calendar
suggests it should be.

**There is no git remote, and that is deliberate.** `git remote -v` prints nothing, so the
tree these figures are taken from is local-only: nothing here has been pushed, and no figure
in this file was read from a hosted copy. Anywhere the reasoning below talks about published
history, read it as a rule about what would happen if this tree were ever pushed, not as a
description of a remote that exists.

The whole history, root commit included, falls inside the event window. There is no
pre-event work carried in and no import commit that would need explaining.

## Every subject names its change

All 188 subjects match `^(feat|fix|test|docs|chore|refactor|perf|build|ci|style|revert)`
optionally followed by a scope, then a colon and a non-empty description.

| Prefix | Count | |
| --- | --- | --- |
| `feat` | 64 | |
| `test` | 61 | one suite per behaviour, which is why the two leading groups move together |
| `docs` | 26 | including the measured-fact records under `docs/kane/` |
| `chore` | 24 | recordings, snapshots, tooling |
| `fix` | 13 | |

`feat` and `test` running neck and neck, three apart, is worth reading rather than hiding:
the plan pairs each behaviour with the suite that holds it, so the two grow together, and a
`feat` without a matching `test` in the same wave would be the anomaly. The lead has changed
hands since the previous pass, which is what two groups growing in step looks like.

The thirteen `fix` commits are the honest figure, seven more than the previous pass found.
Defects found *during* a task were corrected inside that task's own commit, so what reaches
`fix` is the smaller set found afterwards, and they group like this:

- **Five correct an assumption about how `kane-cli` 0.8.4 actually behaves**, two under
  `kane`, two under `verify`, one under `radius`: the eight-document corpus made runnable at
  all, `context list` invoked as the family-less command it is, the dry run shape the CLI
  really emits, `--all` scoped to recorded members, and `--changed` naming the plan's own
  member paths.
- **One resolves the evidence pack Kane actually seals**, rather than the newest thing in
  the directory.
- **Four are the Ledger's own rendering and bundling**, two under `ledger`, one under `runs`
  and one under `core`: overlapping graph lanes, an unbounded detail panel, and `node:fs`
  reaching the browser bundle twice by two different routes.
- **Two are the Vercel deploy**, the config block Next 16 no longer accepts and the build
  order `kept-core` needs.
- **One makes the reconcile fork guard hermetic.**

Each is described in [`docs/kane/`](kane/) beside the stream that revealed it.

Scopes, where present: `core` 66, `ledger` 35, `kane` 22, `cli` 6, `deploy` 5, `spec` 5,
`integration` 4, `evidence` 3, `hooks` 3, `test` 3, `fixture` 2, `readme` 2, `runs` 2,
`verify` 2, and one each for `context`, `diagrams`, `fixtures`, `handoff`, `judge-path`,
`radius`, `reconcile` and `verdict`. `fixture` and `fixtures` are the same subject area under
two spellings, which the conventional-commit pattern does not police and this audit does not
silently merge. Twenty commits carry no scope, and they are the repository-wide ones: the root
commit, the toolchain setup, the top-level documents.

The shortest subject is `feat(core): failure.yaml loader`, at 31 characters. It still
names its change, the file it parses, which is the test Requirement 14.2 sets, so it is
reported rather than padded out. Fifty-eight subjects run past 72 characters; they are
long because they name a numbered correctness property or a measured Kane fact in full,
and truncating them would cost a reader more than the wrapping does.

## No unnamed or squashed commit was found

Nothing here needed fixing before the deadline. Specifically:

- **No placeholder subjects.** Zero `wip`, `tmp`, `misc`, `various` or bare `update`.
- **No unlabelled squashes.** The `fixup!` and `squash!` autosquash markers appear zero
  times, and with zero merge commits there is no collapsed branch whose contents a
  subject could be hiding.
- **No reused subjects.** No two commits share one, so no subject is a generic label
  spread across unrelated changes.

Had the audit found one, it would be listed here and left in place. Rewriting history inside
the event window, whether by rebase, amend or force-push, would destroy the evidence this
section exists to describe, which is a worse outcome than a reported blemish. That holds with
no remote in the picture: the commits and their dates are themselves the evidence, so a
rewrite costs the same whether or not the tree was ever pushed anywhere.

## The object database is sound

Recorded at `47fa56e`, the head of the previous pass, and reported here as that earlier
check rather than re-taken: this pass re-measured the history, not the object database.

```console
$ git fsck --no-progress --no-dangling
$ echo $?
0
```

Clean, no output, exit 0.

That check is recorded because an earlier run of it reported
`fatal: unable to read 1eee79e6…` with `inflate: data stream error`, which reads exactly
like a corrupt repository. It was not one. The tree these measurements were taken on sits
under a cloud-synced directory, and the file provider was serving a dataless placeholder
for that object rather than its bytes — the same storage latency recorded in
[`judge-path.md`](judge-path.md) and in `vitest.config.ts`. Re-run once the object was
materialised, `fsck` is clean.

The distinction is worth the paragraph: one of those findings means the submission
repository is unsound, and the other means a disk was slow. Reporting the first when the
second is true would be exactly the kind of unchecked claim this project exists to catch.

## What this audit is not

A point-in-time count, not a running assertion. The history grows with every remaining
commit, so pinning 188 into the test suite would fail on the next one without telling
anybody anything true. The twenty-four commits between the previous pass and this one are
the demonstration: the count changed, nothing the audit is actually about did.

What is durable is the *shape* — linear, single author, every subject named, entirely
inside the event window — and the command at the top re-measures all of it in one pass
whenever you want the current figure.
