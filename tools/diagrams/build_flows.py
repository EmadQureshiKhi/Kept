#!/usr/bin/env python3
"""
The code-break loop as a sequence: save, radius, replay, route, guard, handoff.

Six lifelines rather than eight, and the reason is the same one that set the
architecture grid: a step's label is clamped to the corridor between the two
lifelines it spans, so squeezing in two more columns costs every label a third of
its room. Six leaves 43 characters between adjacent lifelines and 67 across two,
which is enough to say what a step actually did.
"""

from __future__ import annotations

from svglib import Diagram, build_all, logo_image


def chip_h(lines: int) -> float:
    return 51 + (lines - 1) * 15.5


W, H = 1740, 1546
HEAD_W = 240
HEAD_X = [40, 324, 608, 892, 1176, 1460]
HEAD_Y, HEAD_H = 120, 82
BOTTOM = 1380


def main() -> int:
    d = Diagram(
        W, H,
        "The KEPT code-break loop",
        "A sequence across six lifelines: the Kiro hook, kept verify, the plan cache, kane-cli, "
        "the parser and verdict router, and the state store with the handoff writer. A save fires "
        "the hook. The plan is refreshed by a dry run and cached. The blast radius is computed "
        "from the identifiers the plan supplied, and the argv names the corresponding member "
        "paths. kane-cli is spawned with stdout piped and the member-debug variable set. The "
        "NDJSON and the bracketed member stderr stream come back, failing members are routed to "
        "exactly one repair branch, the write guard is asked before any verdict is written, and "
        "the handoff returns to the agent, whose repair re-fires the hook and closes the loop.",
    )
    d.heading(
        "The code-break loop",
        "A save fires a hook, Kane's own identifiers scope the replay, and the agent's next action "
        "comes back as a file rather than a status.",
        logo_image(),
    )

    lanes = [
        d.lifeline(HEAD_X[0], HEAD_Y, HEAD_W, HEAD_H, BOTTOM, "Kiro hook", [
            "kept-code-verify, on a save",
            "under apps/fixture source",
        ]),
        d.lifeline(HEAD_X[1], HEAD_Y, HEAD_W, HEAD_H, BOTTOM, "kept verify", [
            "runVerify — the only command",
            "that can reach proven",
        ]),
        d.lifeline(HEAD_X[2], HEAD_Y, HEAD_W, HEAD_H, BOTTOM, "plan cache", [
            ".kept/plan.json, refreshed",
            "by a dry run when stale",
        ]),
        d.lifeline(HEAD_X[3], HEAD_Y, HEAD_W, HEAD_H, BOTTOM, "kane-cli", [
            "through the one process",
            "boundary. stdin ignored",
        ]),
        d.lifeline(HEAD_X[4], HEAD_Y, HEAD_W, HEAD_H, BOTTOM, "parse + route", [
            "under the ExecutionTestrun",
            "contract, then one strategy",
        ]),
        d.lifeline(HEAD_X[5], HEAD_Y, HEAD_W, HEAD_H, BOTTOM, "state + handoff", [
            "the write guard, then the",
            "instruction the agent reads",
        ]),
    ]
    hook, verify, plan, kane, route, state = lanes

    d.step(1, 240, hook, verify, ["a save on apps/fixture/lib/cart.ts"])
    d.step(2, 286, verify, plan, ["which tests cover this path?"])
    d.step(3, 332, plan, kane, ["stale, so refresh: testrun run --dry-run"])
    d.step(4, 378, kane, plan, ["one line: the testrun_plan event, exit 0"], dashed=True)

    d.note(608, 400, 682, chip_h(3), "A dry run has no terminal event, because it executed nothing", [
        "Requiring testrun_done conjunctively discarded every plan the installed CLI can produce, which left the",
        "cache unwritten and every radius empty. The gate is now: a clean exit carrying a plan event is a complete",
        "dry run and is cached; a truncated stream that also exited badly is still a crash, and keeps the cache.",
    ])

    d.step(5, 520, plan, verify, ["members, and the id the plan gave each"], dashed=True)

    d.note(324, 542, 966, chip_h(3), "The radius is computed from identifiers; the argv names paths", [
        "testIds come from testrun_plan.members[] and nowhere else. A member the plan gave no id is excluded and listed in skippedNoTestId —",
        "a missing recording is exactly what a missing id means, and replaying it would author the document live against a feature the fixture",
        "does not have. --from-context cannot carry them either: it resolves against the assurance graph, where a plan's test_id does not live.",
    ])

    d.chip(40, 656, 1660, chip_h(2), "Zero identifiers — the branch that spends nothing", [
        "shouldInvokeKane is false, so no process starts, no credit is spent and no verdict moves. The handoff is still written, with branch null and a",
        "diagnostic saying no designed test covers the changed file, because an agent that reads a stale handoff repairs the wrong promise.",
    ], dashed=True)

    d.step(6, 770, verify, kane, ["replay the radius: testrun run <the plan's paths>"])

    d.note(608, 792, 682, chip_h(3), "Two flags stated in the argv rather than inherited", [
        "--on-failure continue, so one failing member does not stop the suite. And --bug-detection continue, because",
        "bug detection is a profile setting in Kane's own config file: without the flag the branch KEPT picks would",
        "depend on ambient state in another tool — editable by anyone, invisible in the argv, absent from a recording.",
    ])

    d.step(7, 912, kane, route, ["NDJSON: plan, member_end x9, then done"], dashed=True)
    d.step(8, 958, kane, verify, ["each member's own stream, on stderr"], dashed=True)

    d.note(892, 980, 808, chip_h(4), "Where the classification signal actually lives", [
        "Measured across six live runs: testrun_member_end carries only path, test_id and status. No result_code, no",
        "reason_code, no verdict object — so the router's first two rungs have nothing to read from a suite member.",
        "Under KANE_TESTRUN_MEMBER_DEBUG Kane echoes each member's own testmd stream on stderr, and that run_end does",
        "carry all three. It is written to .kept/diagnostics/ before anything is routed, so an absence leaves proof too.",
    ])

    d.step(9, 1120, route, state, ["one branch, and the evidence for it"])

    d.note(1176, 1142, 524, chip_h(3), "applyRun asks the guard first", [
        "A crashed stream, a pause, a preflight rejection or a missing",
        "binary returns the prior state by reference, so nothing was",
        "written is structural rather than an if in the command.",
    ])

    d.step(10, 1270, state, verify, ["handoff.json: branch, fence, citation, evidence"], dashed=True)
    d.step(11, 1310, verify, hook, ["the agent reads the file, not the code"], dashed=True)
    d.step(12, 1356, hook, verify, ["restored; the second run proves it"])

    d.group(40, 1410, 818, 96, "What the handoff hands back here", None)
    d.text(56, 1452, "branch code-break · autonomy apply · artefact patch · command none, because the action is an edit", size=11.2, fill="#4a4a4a")
    d.text(56, 1470, "allowedPaths: the three fixture source globs. forbiddenPaths: the fixture's own docs, all of tests/,", size=11.2, fill="#4a4a4a")
    d.text(56, 1488, "apps/ledger and packages — so the loop cannot make a promise green by weakening its claim or its test.", size=11.2, fill="#4a4a4a")

    d.group(882, 1410, 818, 96, "And the one condition on that fence", None)
    d.text(898, 1452, "allowedPaths is non-empty only when a promise carrying this branch was proven before the run.", size=11.2, fill="#4a4a4a")
    d.text(898, 1470, "You cannot break what was never proven to work — so a never-proven promise keeps the branch, loses", size=11.2, fill="#4a4a4a")
    d.text(898, 1488, "the write path, and is named in a diagnostic. The repair-branch diagram sets out why.", size=11.2, fill="#4a4a4a")

    return build_all([(d, "kept-verify-path.svg")])


if __name__ == "__main__":
    raise SystemExit(main())
