# Commit history audit

R14.2 asks for at least fifteen commits, each with a message naming the change it
makes. This file records what the history actually contains, measured rather than
asserted, so that the claim in the submission checklist is one a judge can check
against the repository in front of them.

This is an **audit, not a rewrite**. Every commit below sits inside the event
window and the history is itself part of the evidence, so nothing here was
rebased, amended or squashed to make a figure look better. Where the audit found
nothing to report, that is the finding.

## Measured at `18d8476`

Taken from a single `git log --format='%H%x09%P%x09%an <%ae>%x09%aI%x09%s'
--no-merges` pass, post-processed. Reproduce it with that command; every number
below falls out of the same text.

| What | Measured |
| --- | --- |
| Commits reachable from `HEAD` | **126** |
| R14.2's floor | 15, cleared 8.4× over |
| Merge commits | 0 — the history is a straight line |
| Root commits | 1 (`d5b4fc5`, `chore: initialise repo with Kane-aware gitignore`) |
| Authors | 1 — `emadqureshikhi <emadqureshi965@gmail.com>` |
| First commit | 2026-08-20T05:16:03+05:00 |
| Last commit audited | 2026-08-21T07:26:22+05:00 |
| Subjects failing the conventional-commit pattern | 0 of 126 |
| `wip` / `fixup!` / `squash!` / `Merge` subjects | 0 |
| Duplicate subjects | 0 |
| Subject length | 31 chars shortest, 59 median, 106 longest |

The whole history — root commit included — falls inside the event window. There is
no pre-event work carried in, and no import commit that would need explaining.

### Every subject names its change

All 126 subjects match `^(feat|fix|test|docs|chore|refactor|perf|build|ci|style|
revert)(\(scope\))?: ` followed by a non-empty description. The distribution:

| Prefix | Count |
| --- | --- |
| `feat` | 51 |
| `test` | 51 |
| `chore` | 16 |
| `docs` | 7 |
| `fix` | 1 |

`feat` and `test` landing on the same count is not a coincidence worth hiding: the
plan pairs each behaviour with the suite that holds it, so the two grow together.
The single `fix` is the honest figure — bugs found during a task were corrected
inside that task's own commit rather than deferred into a follow-up.

Scopes, where present: `core` 64, `ledger` 24, `kane` 14, `cli` 6, `hooks` 3,
`test` 2, `fixture` 2, `spec` 2, and 9 commits with no scope (repository-wide
work: the root commit, the tooling setup, the top-level documents).

The shortest subject is `feat(core): failure.yaml loader` at 31 characters. It
still names its change — the file it parses — which is the test R14.2 sets, so it
is reported rather than padded. Nineteen subjects run past 72 characters; they are
long because they name a numbered property in full, and truncating them would cost
more than the wrapping does.

### No unnamed or squashed commit was found

Nothing here needed fixing before the deadline. Specifically:

- No subject is a placeholder. Zero `wip`, `tmp`, `misc`, `various` or bare
  `update` subjects.
- No commit is an unlabelled squash. `fixup!` and `squash!` autosquash markers
  appear zero times, and with zero merge commits there is no collapsed branch
  whose contents a subject would be hiding.
- No two commits share a subject, so no subject is a generic label reused across
  unrelated changes.

Had the audit found one, it would have been listed here and left in place. Force-
pushing over published history inside the event window would destroy the evidence
this section exists to describe.

## The repository passes `git fsck`

```
$ git fsck --no-progress --no-dangling
$ echo $?
0
```

Clean, no output, exit 0. Worth stating because an earlier attempt at this check
reported `fatal: unable to read 1eee79e6…` with `inflate: data stream error`,
which reads exactly like a corrupt object database. It was not. This working tree
sits under an iCloud-synced directory, and the file provider was serving a
dataless placeholder for that object rather than its bytes — the same storage
latency documented in `docs/judge-path.md` and `vitest.config.ts`. Re-run once the
object was materialised, `fsck` is clean. The distinction matters: one of those
findings means the submission repository is unsound, and the other means a
network drive was slow.

## Scope of this audit

A point-in-time count, not a running assertion. The history grows with every
remaining task, so pinning 126 into the test suite would fail on the next commit
without telling anyone anything true. What is durable is the shape — linear, one
author, every subject named, inside the window — and the command above re-measures
all of it in one pass whenever someone wants the current figure.
