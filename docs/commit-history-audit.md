# Commit history audit

**What this is for.** Requirement 14.2 asks for at least fifteen commits, each with a
message naming the change it makes. A submission checklist can only assert that; this
file measures it, so the claim is one you can check against the repository in front of
you rather than take on trust.

Reproduce every number below with one command:

```bash
git log --format='%H%x09%P%x09%an <%ae>%x09%aI%x09%s' --no-merges
```

Everything here falls out of that single pass. Nothing was counted by hand.

**This is an audit, not a rewrite.** The history is itself part of the evidence — it
shows the work happening inside the event window — so nothing was rebased, amended or
squashed to make a figure look better. Where the audit found nothing to report, that is
the finding, and it is stated as one.

## Measured at `47fa56e`

| What | Measured |
| --- | --- |
| Commits reachable from `HEAD` | **164** |
| Requirement 14.2's floor | 15, cleared 10.9× over |
| Merge commits | 0 — the history is a straight line |
| Root commits | 1 (`d5b4fc5`, `chore: initialise repo with Kane-aware gitignore`) |
| Authors | 1 — `emadqureshikhi <emadqureshi965@gmail.com>` |
| First commit | 2026-08-20T05:16:03+05:00 |
| Last commit audited | 2026-08-21T15:19:14+05:00 |
| Subjects failing the conventional-commit pattern | 0 of 164 |
| `wip` / `fixup!` / `squash!` / `Merge` subjects | 0 |
| Duplicate subjects | 0 |
| Subject length | 31 shortest, 62 median, 106 longest |

The whole history, root commit included, falls inside the event window. There is no
pre-event work carried in and no import commit that would need explaining.

## Every subject names its change

All 164 subjects match `^(feat|fix|test|docs|chore|refactor|perf|build|ci|style|revert)`
optionally followed by a scope, then a colon and a non-empty description.

| Prefix | Count | |
| --- | --- | --- |
| `test` | 60 | one suite per behaviour, which is why this is the largest group |
| `feat` | 58 | |
| `chore` | 23 | recordings, snapshots, tooling |
| `docs` | 17 | including the measured-fact records under `docs/kane/` |
| `fix` | 6 | |

`test` and `feat` running neck and neck is worth reading rather than hiding: the plan
pairs each behaviour with the suite that holds it, so the two grow together, and a
`feat` without a matching `test` in the same wave would be the anomaly.

The six `fix` commits are the honest figure. Defects found *during* a task were corrected
inside that task's own commit, so what reaches `fix` is the smaller set found afterwards
— the sealed triage note nothing opened, the enabler appended to a command that rejects
it, the evidence pack resolved from the wrong place. Each is described in
[`docs/kane/`](kane/) beside the stream that revealed it.

Scopes, where present: `core` 65, `ledger` 30, `kane` 22, `cli` 6, `spec` 4,
`integration` 4, `evidence` 3, `hooks` 3, and one or two each for `verify`, `handoff`,
`verdict`, `deploy`, `radius`, `reconcile`, `context`, `fixture` and `test`. Fourteen
commits carry no scope, and they are the repository-wide ones: the root commit, the
toolchain setup, the top-level documents.

The shortest subject is `feat(core): failure.yaml loader`, at 31 characters. It still
names its change — the file it parses — which is the test Requirement 14.2 sets, so it is
reported rather than padded out. Thirty-nine subjects run past 72 characters; they are
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

Had the audit found one, it would be listed here and left in place. Force-pushing over
published history inside the event window would destroy the evidence this section exists
to describe, which is a worse outcome than a reported blemish.

## The object database is sound

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
commit, so pinning 164 into the test suite would fail on the next one without telling
anybody anything true.

What is durable is the *shape* — linear, single author, every subject named, entirely
inside the event window — and the command at the top re-measures all of it in one pass
whenever you want the current figure.
