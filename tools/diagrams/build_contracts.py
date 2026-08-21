#!/usr/bin/env python3
"""The three Kane command families, the exit matrix, and the write gate."""

from __future__ import annotations

from svglib import ACCENT_FILL, Diagram, build_all, logo_image


def chip_h(lines: int) -> float:
    return 51 + (lines - 1) * 15.5


W, H = 1740, 1330
COL = [40, 640, 1240]
CW = 460
INNER = CW - 32


def main() -> int:
    d = Diagram(
        W, H,
        "The three-contract Kane model",
        "Kane 0.8.4 has three terminal-event contracts rather than one, and both paths KEPT "
        "depends on are the two that are not run_end. ExecutionRun terminates on run_end and is "
        "enabled by the agent flag. ExecutionTestrun terminates on testrun_done and is enabled by "
        "piping stdout, with no such flag existing. Assurance terminates on done, is enabled by "
        "mode agent, and its exit code 3 means paused and resumable rather than failure. Two "
        "further commands belong to no family at all. Below the families sit the complete "
        "exit-code matrix and the two-condition write gate that every row of the failure matrix "
        "follows from.",
    )
    d.heading(
        "The three-contract Kane model",
        "A parser built on run_end alone reports nothing on either path KEPT uses — not with an "
        "error, but by waiting for an event that never comes.",
        logo_image(),
    )

    # ── band A — one group per family ─────────────────────────────────────
    ay = 120
    families = [
        (COL[0], "ExecutionRun", "run · testmd run", [
            ("terminal event", "run_end"),
            ("NDJSON enabled by", "--agent"),
            ("exit 3 means", "timeout or cancelled"),
            ("evidence pack", "session_dir/evidence/"),
        ], "The documented path, and the one KEPT uses least", [
            "Its recorded smoke run is the parser's pinned regression:",
            "twelve lines, one run_end, and zero diagnostics. That run is",
            "also where result_code appears as both 100 and \"100\".",
        ]),
        (COL[1], "ExecutionTestrun", "testrun run", [
            ("terminal event", "testrun_done"),
            ("NDJSON enabled by", "piped stdout — no flag exists"),
            ("exit 3 means", "timeout or cancelled"),
            ("evidence pack", "<cwd>/.testmuai/evidence/"),
        ], "Blast-radius verification — the loop's own path", [
            "There is no --agent flag on this command, and the invoker",
            "refuses an argv carrying one anywhere in it: the flag would",
            "be read as a positional and quietly change the selection.",
        ]),
        (COL[2], "Assurance", "cover gaps · maintain reconcile · …", [
            ("terminal event", "done"),
            ("NDJSON enabled by", "--mode agent"),
            ("exit 3 means", "*paused and resumable"),
            ("evidence pack", "none"),
        ], "The ledger's data source, and the dangerous cell", [
            "Reading its exit 3 as a failure would overwrite good verdicts",
            "with red ones, and the pause would be unrecoverable because",
            "the prior state is gone. So the meaning is read, not guessed.",
        ]),
    ]

    for x, name, commands, facts, note_title, note_body in families:
        d.group(x, ay, CW, 340, name, commands)
        end = d.table(
            x + 16, ay + 78, INNER,
            [("fact", 0), ("value", 148)],
            [[fact, value] for fact, value in facts],
            where=f"{name} facts",
        )
        d.note(x + 16, end + 16, INNER, chip_h(3), note_title, note_body)

    # ── band B — the exit matrix ──────────────────────────────────────────
    by = 492
    d.group(40, by, 1060, 300, "Exit interpretation — total over every integer and null",
            "exitMeaning(family, code, killed). An exit code is a fact another process reported, so no value of it is a programming error.")
    d.table(
        56, by + 74, 1028,
        [("process exit", 0), ("ExecutionRun", 200), ("ExecutionTestrun", 440), ("Assurance", 700)],
        [
            ["0", "success", "success", "success"],
            ["2", "failure", "*preflight-rejected", "failure"],
            ["3", "timeout-or-cancelled", "timeout-or-cancelled", "*paused-resumable"],
            ["130", "force-interrupted", "force-interrupted", "force-interrupted"],
            ["127", "kane-not-found", "kane-not-found", "kane-not-found"],
            ["null — signalled", "force-interrupted", "force-interrupted", "force-interrupted"],
            ["killed by our timer", "killed-by-timeout", "killed-by-timeout", "killed-by-timeout"],
            ["anything else", "failure", "failure", "failure"],
        ],
        where="exit matrix",
    )
    d.text(56, by + 278, "Exit 3's meaning lives in the contract table. Exit 2's does not — it is a rejection only for testrun run, where the plan was invalid and nothing executed.", size=11.2, fill="#4a4a4a")

    # ── band B rail — the family-less commands ────────────────────────────
    d.group(COL[2], by, CW, 300, "Two commands that belong to no family", "Absence is a measured fact about them, not an oversight.")
    d.chip(COL[2] + 16, by + 78, INNER, chip_h(4), "context list --type source --json", [
        "It was in the Assurance table once, on a reading",
        "of the design that measurement refuted:",
        "  exit 1, stdout empty, and on stderr",
        "  error: unknown option '--mode'",
    ], mono_title=True)
    d.note(COL[2] + 16, by + 186, INNER, chip_h(3), "So it goes through invokePlain", [
        "Which appends nothing and hands back lines rather",
        "than a stream. Listing it as a family made every",
        "documentation save resolve to listing-unreadable.",
    ])

    # ── band C — the write gate ───────────────────────────────────────────
    cy = 824
    d.group(40, cy, 1660, 466, "The write gate — where the whole model pays off",
            "Two conditions, both required. Every row below follows from them rather than from a check anyone has to remember.")

    d.chip(56, cy + 74, 1628, chip_h(3), "mayWriteVerdicts(run) = stream.kind === 'complete' && (exitMeaning === 'success' || exitMeaning === 'failure')", [
        "The stream half says the family's terminal event actually arrived, so the outcome is known. The exit half says the process reported an outcome rather than an interruption.",
        "A run failing either one returns the prior state by reference — the same objects, not a copy that happens to match — so nothing was written is a property of the code.",
        "degraded is a different question: it reports that the proven axis is untrustworthy, which is why an unresolved reconcile source leaves it alone. No proven data was lost.",
    ], mono_title=True, fill=ACCENT_FILL)

    d.table(
        56, cy + 190, 1628,
        [("condition", 0), ("verdicts", 620), ("degraded", 800), ("CLI exit", 950), ("handoff", 1090)],
        [
            ["Kane binary absent from PATH", "unchanged", "true", "0", "written, branch null"],
            ["Assurance paused, exit 3", "unchanged", "true", "0", "written, resumable true"],
            ["Stream ends without its terminal event", "unchanged", "true", "0", "written, terminalSeen false"],
            ["Our timeout fired: SIGTERM, then SIGKILL", "unchanged", "true", "0", "written, with the budget named"],
            ["Preflight rejection — plan invalid, exit 2", "unchanged", "true", "0", "written, one reason per member"],
            ["Member reported broken", "that promise red", "false", "0", "written, branch routed"],
            ["Member reported interrupted", "that promise stale", "false", "0", "written, branch null"],
            ["Reconcile source unresolved — no spawn", "unchanged", "*false", "0", "written, branch null"],
            ["Snapshot missing or invalid at build", "n/a", "n/a", "*build fails", "n/a — names the field path"],
            ["--plan and --apply both given", "unchanged", "false", "*2", "not written — never spawned"],
        ],
        where="failure matrix",
    )
    d.text(56, cy + 448, "The CLI's own exit code reports whether KEPT worked, and never whether the product passed. The last row is the only non-zero exit in the product.", size=11.2, fill="#4a4a4a")

    return build_all([(d, "kept-three-contracts.svg")])


if __name__ == "__main__":
    raise SystemExit(main())
