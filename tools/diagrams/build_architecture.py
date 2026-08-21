#!/usr/bin/env python3
"""
Components and boundaries: hooks, the CLI, the core, Kane, the seam, the apps.

The grid is 1740 wide with three 460-wide columns and 140-wide gutters, and the
gutter width is not cosmetic: an edge label sits on an opaque plate clamped to its
corridor, so a 32px gutter renders a twelve-character label and silently truncates
the sense of it. 140 buys nineteen characters, and anything longer is written as
two lines rather than shortened into something vaguer.
"""

from __future__ import annotations

from svglib import ACCENT_FILL, Diagram, build_all, logo_image


def chip_h(lines: int) -> float:
    """Height for a chip with `lines` body rows, evenly padded."""
    return 51 + (lines - 1) * 15.5


W, H = 1740, 1494
COL = [40, 640, 1240]
CW = 460
INNER = CW - 32          # a chip inside a column group
GUT = 140


def main() -> int:
    d = Diagram(
        W, H,
        "KEPT architecture",
        "Two Kiro hooks turn a file save into a CLI run. bin/kept dispatches to the kept-cli "
        "command surface, which calls kept-core: the Kane contract layer, the promise model, the "
        "two providers, the verdict routers, the blast radius, the repair surfaces, the single "
        "write guard and the handoff writer. kept-core spawns kane-cli 0.8.4 with stdout piped "
        "and consumes its NDJSON. Working state lands under .kept/ and the committed "
        "ledger.snapshot.json is the only seam between the CLI and the two Next.js applications, "
        "the read-only Ledger on port 3000 and the fixture under verification on port 3100.",
    )
    d.heading(
        "Architecture",
        "Every promise cited to a line, bound to a Kane test, re-verified from two directions. "
        "One committed file is the only seam.",
        logo_image(),
    )

    # ── band A — the trigger, the CLI, the external process ───────────────
    ay, ah = 120, 312
    d.group(COL[0], ay, CW, ah, "Kiro IDE", "Two hooks, disjoint patterns — no save can fire both.")
    d.chip(COL[0] + 16, ay + 66, INNER, chip_h(3), "kept-code-verify.json", [
        "fileEdited on apps/fixture/{app,components,lib}",
        "askAgent: verify, read the handoff, then repair inside",
        "the path fence it declares",
    ], mono_title=True)
    d.chip(COL[0] + 16, ay + 160, INNER, chip_h(3), "kept-docs-reconcile.json", [
        "fileEdited on the fixture README and its docs",
        "askAgent: reconcile, then report the suite debt. Never",
        "applies a stored plan — a human decides that",
    ], mono_title=True)
    d.note(COL[0] + 16, ay + 254, INNER, chip_h(1), "Both prompts read the file, not the exit code", [
        "kept exits 0 on a crash, an absent binary and an empty radius alike",
    ])

    d.group(COL[1], ay, CW, ah, "kept-cli", "Hand-rolled argv. One non-zero exit in the product.")
    d.chip(COL[1] + 16, ay + 66, INNER, chip_h(2), "kept build", [
        "Both providers, then .kept/state.json. Degradation is",
        "recorded with a named reason, and is never fatal",
    ], mono_title=True)
    d.chip(COL[1] + 16, ay + 148, INNER, chip_h(3), "kept verify --changed | --all", [
        "The only command that can reach proven. Computes the",
        "radius, replays it, routes each failure, then writes the",
        "handoff and the snapshot",
    ], mono_title=True, fill=ACCENT_FILL)
    d.chip(COL[1] + 16, ay + 242, INNER, chip_h(2), "reconcile · evolve · amend · snapshot", [
        "A resolved source id or no spawn at all; held review",
        "cards; proposed amendments; canonical bytes",
    ], mono_title=True)

    d.group(COL[2], ay, CW, ah, "kane-cli 0.8.4", "Brings its own Chrome. Never runs on the deployment.")
    d.chip(COL[2] + 16, ay + 66, INNER, chip_h(3), "testrun run <paths>", [
        "Blast-radius replay. NDJSON because stdout is a pipe —",
        "there is no --agent flag on this command, and the",
        "invoker refuses an argv carrying one anywhere in it",
    ], mono_title=True)
    d.chip(COL[2] + 16, ay + 160, INNER, chip_h(2), "cover gaps --json --mode agent", [
        "The coverage axes, answered from the live assurance",
        "graph rather than out of a sealed pack",
    ], mono_title=True)
    d.chip(COL[2] + 16, ay + 242, INNER, chip_h(2), "<execution_id>.evidence", [
        "A sealed zip, not a directory. The triage note is per",
        "failing step, and is attributed by test id",
    ], mono_title=True)

    d.step(None, ay + 150, COL[0] + CW, COL[1], ["runs the CLI"])
    d.step(None, ay + 150, COL[1] + CW, COL[2], ["spawns, stdout", "piped"])
    d.step(None, ay + 210, COL[2], COL[1] + CW, ["NDJSON, and the", "[member] stderr"], dashed=True, below=True)

    # ── band B — kept-core ────────────────────────────────────────────────
    by = 472
    core_w = CW * 2 + GUT
    d.group(COL[0], by, core_w, 474, "kept-core — 39 modules, and no process of its own",
            "Every Kane outcome arrives as data. Exceptions are reserved for KEPT being wrong about itself.")

    quad = (core_w - 32 - 16) / 2
    for (cx, cy, title, mono, body) in [
        (COL[0] + 16, by + 66, "kane/", True, [
            "family.ts — the contract table, written exactly once",
            "ndjson.ts — the only parse entry point there is",
            "coerce.ts — result_code and credits, the one comparison site",
            "exit.ts — per-family exit interpretation, total over every int",
            "evidence.ts — pack location derived from the family, never an event",
        ]),
        (COL[0] + 32 + quad, by + 66, "model/", True, [
            "ids.ts — identity is the file plus the normalised claim, and never",
            "the line number, so a promise survives a paragraph above it",
            "admission.ts — the citation gate; a claim whose line does not",
            "resolve never enters the graph at all",
            "snapshot.ts — the schema, its refinements, canonical bytes",
        ]),
        (COL[0] + 16, by + 195, "providers/ · radius/", True, [
            "baseline.ts — scans *_test.md for @verifies tags. Total: succeeds",
            "on every repository state, including one with no tests at all",
            "enrichment.ts — cover gaps, accepted only on a clean done event",
            "merge.ts — baseline is the sole citation authority, so a Kane",
            "outage can degrade the proven axis and never move a citation",
        ]),
        (COL[0] + 32 + quad, by + 195, "verdict/ · repair/ · handoff/", True, [
            "router.ts — one strategy interface, chosen by one config string",
            "reviewCard.ts — held, and there is no apply path to guard",
            "docsAmendment.ts — proposed, and written only on accept, behind",
            "a sha256 interlock on the cited line",
            "lineEdit.ts — one line replaced, every other byte identical",
        ]),
    ]:
        d.chip(cx, cy, quad, chip_h(5), title, body, mono_title=mono)

    d.note(COL[0] + 16, by + 324, quad, chip_h(4), "state.ts — the single write guard", [
        "mayWriteVerdicts is true only for a complete stream whose exit meaning is",
        "success or failure. Crashed, paused, timed out, preflight-rejected and",
        "binary-absent all preserve prior verdicts by construction. applyRun carries",
        "promises outside the radius across by reference, evidence included.",
    ])
    d.note(COL[0] + 32 + quad, by + 324, quad, chip_h(4), "handoff/handoff.ts — the loop contract", [
        "Written for every run, including those that proved nothing: an agent reading",
        "a stale handoff repairs the wrong promise. A null branch always carries a",
        "diagnostic. nextAction gives the branch, the autonomy, the artefact, the",
        "command and two fences — and one branch only ever gets a write path.",
    ])

    # ── band B rails ──────────────────────────────────────────────────────
    d.group(COL[2], by, CW, 210, "The rule it is built on", "Three terminal contracts, not one.")
    d.chip(COL[2] + 16, by + 66, INNER, chip_h(2), "A stream cannot be parsed anonymously", [
        "parseStream takes a FamilyContract, and that type carries a",
        "private brand — so contractFor is the only way to obtain one",
    ])
    d.chip(COL[2] + 16, by + 140, INNER, chip_h(2), "A terminal event cannot be assumed", [
        "ParsedStream is a union and terminal lives only on the",
        "complete arm, so a crashed stream has none to reach for",
    ])

    ry = by + 230
    d.group(COL[2], ry, CW, 356, "What it deliberately never does", "Four absences, each load-bearing.")
    for i, (title, body) in enumerate([
        ("It never guesses an identifier", [
            "Radius ids come from testrun_plan.members[] and nowhere",
            "else. A member with no id is excluded and listed",
        ]),
        ("It never composes an evidence path", [
            "No terminal event carries one, and run_dir — the legacy",
            "field — is never read from disk under any circumstance",
        ]),
        ("It never writes prose", [
            "A replacement sentence is an input. A system generating",
            "documentation until its tests agreed would assert",
        ]),
        ("It never lowers the bar to go green", [
            "On code-break the fence forbids the fixture's own docs and",
            "all of tests/ — the one repair this loop cannot perform",
        ]),
    ]):
        d.chip(COL[2] + 16, ry + 66 + i * 70, INNER, chip_h(2), title, body)

    d.arrow([(COL[1] + CW / 2, ay + ah), (COL[1] + CW / 2, by)])
    d.edge_label(COL[1] + CW / 2, ay + ah, ["calls"], corridor=120, below=True)

    # ── band C — state, seam, apps ────────────────────────────────────────
    cy, ch = 1090, 364
    d.group(40, cy, 520, ch, ".kept/ — working state", "Gitignored and regenerable, except config.json.")
    d.chip(56, cy + 66, 488, chip_h(2), "config.json", [
        "The one committed file, and the one string the verdict spike may",
        "change: the router, member debug, and two timeout budgets",
    ], mono_title=True)
    d.chip(56, cy + 148, 236, chip_h(2), "state.json", [
        "The graph and the freshness",
        "stamp, as the guard left them",
    ], mono_title=True)
    d.chip(308, cy + 148, 236, chip_h(2), "plan.json · sources.json", [
        "Read-through caches. A failed",
        "refresh keeps the last answer",
    ], mono_title=True)
    d.chip(56, cy + 230, 236, chip_h(2), "handoff.json + handoff/", [
        "Newest, plus a per-run copy",
        "that is never overwritten",
    ], mono_title=True)
    d.chip(308, cy + 230, 236, chip_h(2), "review-cards/ · amendments/", [
        "The two held artefacts. Every",
        "write is fenced inside .kept/",
    ], mono_title=True)

    d.group(700, cy, 440, ch, "ledger.snapshot.json", "Committed, canonical, schema-validated. One direction of travel.")
    d.chip(716, cy + 66, 408, chip_h(4), "Why one file carries the judge story", [
        "Committed, so the deployment needs no Kane, no Chrome,",
        "no credential and no network. Validated at build time, so",
        "a malformed snapshot fails loudly rather than rendering a",
        "lie. It holds evidence paths; the packs are static files",
    ])
    d.chip(716, cy + 176, 408, chip_h(3), "Canonical bytes", [
        "Sorted keys, two-space indent, arrays sorted by id, and no",
        "Date surviving into the structure. So a parse round-trips,",
        "a re-serialise is byte-identical, and a diff reads by line",
    ])
    d.chip(716, cy + 270, 408, chip_h(2), "Cross-field rules it enforces", [
        "Counts agree with the promise list; coverage is null exactly",
        "at zero; every evidence ref and edge endpoint resolves",
    ])

    d.group(1280, cy, 420, ch, "apps/ — what a judge opens", "Both boot from committed data.")
    d.chip(1296, cy + 66, 190, chip_h(6), "apps/ledger — :3000", [
        "/           the graph",
        "/coverage   shareable",
        "/amendments the diffs",
        "/reviews    held cards",
        "/runs       event log",
        "/badge.svg  GET only",
    ], mono_title=True)
    d.chip(1502, cy + 66, 182, chip_h(6), "fixture — :3100", [
        "Kepler Coffee. Seven",
        "screens, no backend,",
        "no database, no fetch.",
        "Eight claims, one per",
        "line. One breakable,",
        "one never true",
    ], mono_title=True)
    d.note(1296, cy + 206, 388, chip_h(2), "Read-only, structurally", [
        "No non-GET handler, no server action, no auth, no",
        "child_process. The accept control copies a command",
    ])
    d.chip(1296, cy + 284, 388, chip_h(2), "Measured, not estimated", [
        "Worst of three runs to the landing view: 3.6 s",
        "Ledger, 4.6 s fixture, against a 30 s ceiling",
    ])

    d.arrow([(300, by + 474), (300, cy)])
    d.edge_label(300, by + 474, ["writes"], corridor=200, below=True)
    d.step(None, cy + 160, 560, 700, ["kept snapshot"])
    d.step(None, cy + 160, 1140, 1280, ["imported at", "build time"])

    return build_all([(d, "kept-architecture.svg")])


if __name__ == "__main__":
    raise SystemExit(main())
