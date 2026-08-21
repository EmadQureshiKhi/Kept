#!/usr/bin/env python3
"""
Two analysis diagrams: the repair decision, and the promise state machine.

Both are the kind of thing prose is bad at — a precedence ladder where the order
*is* the argument, and a state machine where one transition out of five is the
only one an agent may act on by itself.
"""

from __future__ import annotations

from svglib import ACCENT_FILL, Diagram, build_all, logo_image


def chip_h(lines: int) -> float:
    return 51 + (lines - 1) * 15.5


# ── the repair decision ───────────────────────────────────────────────────────


def repair() -> Diagram:
    W, H = 1740, 1720
    d = Diagram(
        W, H,
        "KEPT three-way repair, and the one condition on autonomy",
        "The resultCode740 rung ladder and the failureYamlTriage signal lists decide which of "
        "three repair branches a failing promise gets. Each branch carries its own autonomy, its "
        "own artefact and two path fences, and only one of the three ever hands an agent a write "
        "path. Beneath them is the measured reason that write path needs a further condition: "
        "Kane reads the test document as the specification, so a genuine regression and a claim "
        "that was never true earn the same triage category, and one unchanged failure has drawn "
        "four different answers across three sealed packs and six live runs. The discriminator "
        "KEPT holds and Kane does not is the promise's own prior verdict. Last, the eight steps of "
        "the documentation-triggered loop, which reaches an amendment without writing anything.",
    )
    d.heading(
        "Three-way repair",
        "A red promise has exactly three causes. Kane's verdict picks between them; what it cannot "
        "pick is whether a product fault is a regression or a lie.",
        logo_image(),
    )

    # ── the ladder ────────────────────────────────────────────────────────
    ay = 120
    d.group(40, ay, 820, 510, "resultCode740 — the rungs, in order",
            "Total: exactly one branch for every input, never a throw, never two.")
    rungs = [
        ("1 · the inline verdict object reports confirmed false", [
            "→ test-drift. Kane investigated and did not confirm a product bug, so the failure is the test's own.",
            "The object outranks the numeric code: it is the richer signal, and the later one.",
        ]),
        ("2 · the inline verdict object reports confirmed true", [
            "→ code-break. Its severity, category and confidence travel with the branch, because the branch alone is",
            "not enough for a reviewer to judge a repair and Kane has already graded it.",
        ]),
        ("3 · no object, and the coerced code is 740", [
            "→ code-break, category product_bug. Read through the coercing accessor only, so the string \"740\" and the",
            "number 740 reach the same rung rather than one firing and the other silently never firing.",
        ]),
        ("4 · 5 · no object, any other code — including none at all", [
            "→ delegate to failureYamlTriage, and return its answer verbatim. The annotation names the delegate as the",
            "strategy, because strategy records which rung decided rather than which router was configured.",
        ]),
        ("6 · the delegate returned nothing, or threw", [
            "→ docs-lie, with a rationale saying the delegation is what failed. That distinction matters: this is a",
            "statement about KEPT, where every rung above it is a statement about the product.",
        ]),
    ]
    for i, (title, body) in enumerate(rungs):
        d.chip(56, ay + 78 + i * 84, 788, chip_h(2), title, body)

    # ── the triage lists ──────────────────────────────────────────────────
    d.group(880, ay, 820, 510, "failureYamlTriage — the note, in precedence order",
            "The signal is triage.rca.category, then three shallower aliases. Exact matches are tried before any containment match.")
    d.table(
        896, ay + 78, 788,
        [("signal class", 0), ("branch", 560)],
        [
            ["application_issue · product_bug · app_error · server_error", "*code-break"],
            ["http_5xx · crash · console_error", "*code-break"],
            ["selector_not_found · locator · element_not_found · timeout", "*test-drift"],
            ["stale_element · navigation · flaky · timing", "*test-drift"],
            ["assertion · expectation_mismatch · value_mismatch", "*docs-lie"],
            ["absent, unreadable, unparseable, or unrecognised", "*docs-lie"],
        ],
        where="triage signals",
    )
    d.note(896, ay + 240, 788, chip_h(3), "Why an assertion means the documentation lied", [
        "code-break requires positive evidence of a product fault. test-drift requires positive evidence of a test-mechanics",
        "fault. An assertion that failed while the application behaved and every selector resolved is neither — it is the",
        "signature of a claim that was never true, so the residue is the documentation's problem rather than nobody's.",
    ])
    d.chip(896, ay + 348, 788, chip_h(3), "And why exact beats containment", [
        "A signal that is exactly `timeout` must not be captured by a containment rule from a higher list, while",
        "`selector_timeout` should still land on test-drift. Containment then runs in precedence order, which is what makes",
        "`assertion_timeout` a mechanics fault: positive evidence about the mechanism outranks the residue.",
    ])
    d.note(896, ay + 438, 788, chip_h(2), "application_issue was added deliberately, and it is not a small change", [
        "It is Kane's own top-level fault family, and admitting it is what makes code-break reachable at all — without it a",
        "deliberately broken subtotal routed docs-lie while Kane's note read application_issue/ui_data_defect at 0.96.",
    ])

    # ── the three branches ────────────────────────────────────────────────
    by = 662
    branches = [
        (40, "code-break", "The only branch an agent applies by itself", [
            ("autonomy", "apply"),
            ("artefact", "a source patch"),
            ("command", "none — the action is an edit"),
            ("may write", "apps/fixture/{app,components,lib}"),
            ("never writes", "the fixture's docs, tests/, ledger"),
        ], "The two forbidden entries are one failure twice", [
            "Editing the claim would make the README agree with",
            "broken code. Editing the test would weaken the",
            "assertion instead of fixing the bug. Either turns a",
            "red promise green by lowering the bar.",
        ]),
        (640, "test-drift", "Held, because Kane already holds it", [
            ("autonomy", "hold"),
            ("artefact", ".kept/review-cards/<id>.json"),
            ("command", "kept evolve <ref>"),
            ("may write", "nothing"),
            ("never writes", "everything"),
        ], "This mirrors Kane rather than reimplementing it", [
            "maintain reconcile --plan lands the head move and",
            "stages everything else into Kane's own plan, which is",
            "already the hold-everything semantic. So KEPT projects",
            "those staged items and adds no second source of truth.",
        ]),
        (1240, "docs-lie", "Proposed, and never written silently", [
            ("autonomy", "propose"),
            ("artefact", ".kept/amendments/<id>.json"),
            ("command", "kept amend propose"),
            ("may write", "nothing"),
            ("never writes", "anything, until a human accepts"),
        ], "The guarantee is structural, not careful", [
            "Every write in repair/ passes a fence that answers null",
            "outside .kept/. The one function that writes elsewhere",
            "is called from exactly one place, past a sha256",
            "interlock on the cited line.",
        ]),
    ]
    for x, name, subtitle, facts, note_title, note_body in branches:
        d.group(x, by, 460, 330, name, subtitle)
        end = d.table(
            x + 16, by + 78, 428,
            [("", 0), ("", 130)],
            [[fact, value] for fact, value in facts],
            row_h=20, where=f"{name} facts",
        )
        d.note(x + 16, end + 14, 428, chip_h(4), note_title, note_body)

    # ── the fence ─────────────────────────────────────────────────────────
    cy = 1024
    d.group(40, cy, 1060, 372, "The one condition on automatic repair",
            "Measured against three committed packs and six live runs, not assumed.")
    d.chip(56, cy + 78, 1028, chip_h(3), "Kane reads the test document as the specification", [
        "So it has no way to conclude that the specification is what is wrong. For the fixture's never-true discount claim its note reads",
        "application_issue/ui_data_defect at 0.89, with a suggested fix telling the reader to check the cart's discount calculation — a correct",
        "description, on Kane's own terms, of a discount the cart never applies. The genuinely broken subtotal earns the same category, at 0.96.",
    ])
    d.table(
        56, cy + 186, 1028,
        [("source", 0), ("what Kane said", 320), ("implies", 690), ("correct?", 830)],
        [
            ["pack 0944d075 — the broken subtotal", "application_issue/ui_data_defect, 0.96", "code-break", "yes, the product regressed"],
            ["pack 57591bff — the discount claim", "application_issue/ui_data_defect, 0.89", "code-break", "*no, the claim was never true"],
            ["pack 108dbb62 — the same failure again", "automation_bug/state_transition_bug, 0.91", "test-drift", "*no — and it contradicts row 2"],
            ["[member] stream, the suite replay", "740, confirmed true, 0.95", "code-break", "—"],
            ["[member] streams, three runs", "absent entirely", "docs-lie, residue", "—"],
            ["[member] stream, 57591bff", "710, confirmed false, 0.89", "test-drift", "—"],
        ],
        where="measurement",
    )
    d.text(56, cy + 352, "No widening of the vocabulary turns that into a discriminator, and re-running until it says something convenient is a coin flip presented as a demonstration.", size=11.2, fill="#4a4a4a")

    d.group(1240, cy, 460, 372, "The discriminator KEPT holds", "And Kane, structurally, cannot.")
    d.note(1256, cy + 78, 428, chip_h(4), "The promise's own prior verdict", [
        "proven means this repository witnessed the",
        "behaviour, with a terminal event and a sealed pack",
        "behind it. Red after that is a regression, and",
        "restoring it is what the branch authorises.",
    ])
    d.chip(1256, cy + 186, 428, chip_h(2), "You cannot break what was never proven to work", [
        "A promise never proven has no witness — nothing",
        "established that it ever worked, so nothing broke.",
    ], fill=ACCENT_FILL)
    d.chip(1256, cy + 268, 428, chip_h(4), "So the fence narrows, and the branch does not move", [
        "The router keeps returning code-break, so the",
        "snapshot and /runs keep publishing Kane's real",
        "conclusion. Only the autonomy is withheld:",
        "allowedPaths empties and nothing is added anywhere.",
    ])

    # ── the docs loop ─────────────────────────────────────────────────────
    dy = 1428
    d.group(40, dy, 1660, 262, "The other trigger — documentation that overpromises, answered without a line of product code",
            "Eight steps, and step 6 is what distinguishes this from an ordinary failing test.")
    steps = [
        ("1 · a ninth claim", [
            "A sentence is added to the fixture's README",
            "describing behaviour it does not implement.",
        ]),
        ("2 · the docs hook fires", [
            "kept reconcile --changed. The CLI resolves the",
            "source id itself and passes both arguments.",
        ]),
        ("3 · the suite owes something", [
            "The claim enters the graph as undesigned, and",
            "the count of those is the suite debt.",
        ]),
        ("4 · a test is bound to it", [
            "A hand-written *_test.md with an @verifies tag.",
            "One replay, and no assurance chain.",
        ]),
        ("5 · it fails", [
            "The application behaves correctly and every",
            "selector resolves. The assertion still loses.",
        ]),
        ("6 · docs-lie, and no write path", [
            "The router says the product is not at fault, so",
            "allowedPaths is empty and source is forbidden.",
        ]),
        ("7 · an amendment is proposed", [
            "One file under .kept/, rendered on /amendments",
            "as a diff with an accept control beside it.",
        ]),
        ("8 · the claim is reverted", [
            "The README returns to its committed content and",
            "its pinned digest still holds.",
        ]),
    ]
    step_w = (1660 - 32 - 3 * 12) / 4
    for i, (title, body) in enumerate(steps):
        col, row = i % 4, i // 4
        d.chip(
            56 + col * (step_w + 12), dy + 78 + row * 88, step_w, chip_h(2),
            title, body,
            fill=ACCENT_FILL if title.startswith("6") else "#ffffff",
        )
    d.text(56, dy + 250, "Committed as the reconciliation stream, the verification stream, both handoffs, the amendment and the snapshot that renders it — so the whole cycle is reproducible from committed bytes with Kane invoked zero times.", size=11.2, fill="#4a4a4a")

    return d


# ── the promise state machine ─────────────────────────────────────────────────


def lifecycle() -> Diagram:
    W, H = 1740, 1400
    d = Diagram(
        W, H,
        "A KEPT promise and its four states",
        "The verdict state machine: undesigned becomes stale when a designed test gains an "
        "@verifies tag citing it; stale becomes proven on a passing member and red on a failing or "
        "broken one; proven becomes red when the product regresses, which is the only transition "
        "an agent may repair by itself; and a repaired promise returns to proven on the next run. "
        "Beside the machine sits how a promise identifier is derived and the admission gate in "
        "front of it, the two coverage figures that count different things over different "
        "denominators, and the four lanes the Ledger graph lays out.",
    )
    d.heading(
        "A promise, and its four states",
        "Identity is the file plus the normalised claim, and never the line number — so a promise "
        "survives being moved down the page.",
        logo_image(),
    )

    # ── the machine ───────────────────────────────────────────────────────
    ay = 120
    d.group(40, ay, 1660, 470, "The verdict vocabulary — exactly four values, and no others",
            "Only one transition can be caused by a passing run, and only one can authorise an automatic repair.")

    d.chip(120, 270, 200, 64, "undesigned", None, centred=True)
    d.chip(520, 270, 200, 64, "stale", None, centred=True)
    d.chip(960, 190, 200, 64, "proven", None, centred=True, fill=ACCENT_FILL)
    d.chip(960, 370, 200, 64, "red", None, centred=True, fill=ACCENT_FILL)

    d.arrow([(320, 302), (520, 302)])
    d.edge_label(420, 302, ["a *_test.md gains an", "@verifies tag citing it"], corridor=176)

    d.arrow([(620, 270), (620, 222), (960, 222)])
    d.edge_label(790, 222, ["a member passed"], corridor=320)

    d.arrow([(620, 334), (620, 402), (960, 402)])
    d.edge_label(790, 402, ["a member failed or broken"], corridor=320)

    d.arrow([(1060, 254), (1060, 370)])
    d.edge_label(1060, 310, [
        "the product regressed —", "the only transition an", "agent may repair itself",
    ], corridor=200, below=True)

    d.arrow([(1160, 402), (1240, 402), (1240, 222), (1160, 222)])
    d.edge_label(1240, 312, ["repaired, and the", "second run proves it"], corridor=150)

    d.note(1320, 250, 364, chip_h(5), "Two ways a promise leaves the graph", [
        "Its citation stops resolving — the line is gone, or",
        "the file is — so the admission gate refuses it and",
        "the removal is recorded in the run diagnostics.",
        "Or its words change, which makes it a different",
        "promise: a new id, undesigned, with no proof.",
    ])

    d.chip(56, 460, 796, chip_h(4), "A status Kane has not documented yet", [
        "The mapping takes a string rather than the four-value union, because the value arrives from another process and a",
        "fifth status from a later release is a state of the world, not a bug. An unrecognised status maps to stale — the",
        "verdict that claims nothing — and is flagged unknown so the caller diagnoses it. undesigned would be wrong,",
        "because a member plainly ran, and proven or red would be a claim invented out of a value nobody understands.",
    ])
    d.chip(868, 460, 816, chip_h(4), "Why four rather than five", [
        "failed and broken both become red: a member that asserted and lost, and one whose harness fell over, are both",
        "not proven right now, and there is no fifth colour for the difference. The distinction is not lost, though — the",
        "raw status is quoted verbatim into the run diagnostics, so a reviewer can still tell a broken member from an",
        "asserted failure afterwards. An interrupted member proved nothing at all, so it never reaches the router.",
    ])

    # ── identity and the gate ─────────────────────────────────────────────
    by = 622
    d.group(40, by, 820, 300, "Identity, and the gate in front of it", "Both halves are what make the graph's memory trustworthy.")
    d.chip(56, by + 78, 788, chip_h(4), "p_ + sha256(file + \"\\n\" + normalisedClaim)[0..12]", [
        "The line number is deliberately absent. A promise carries its verdict, its evidence pack, its repair annotation and",
        "its freshness under this id; if the id moved when somebody inserted a paragraph above the claim, every rebuild",
        "would orphan the history of a promise that never changed. Normalisation strips leading markdown structure and",
        "collapses whitespace — but strips a list marker only when whitespace follows, so \"3.5x faster\" keeps its digits.",
    ], mono_title=True)
    d.chip(56, by + 190, 788, chip_h(4), "The admission gate — one funnel, three refusals", [
        "no citation → refused, and the diagnostic names the provider that supplied it",
        "a line beyond the end of the file → refused, carrying the requested line and the actual count",
        "the cited file unreadable → refused the same way",
        "On admission the text is overwritten with the line read from disk, so the graph cannot carry text disagreeing with the file.",
    ])

    d.group(880, by, 820, 300, "The two figures on the metric rail", "Different denominators over different objects. They will disagree.")
    d.chip(896, by + 78, 788, chip_h(4), "Proven coverage — promises this repository verified", [
        "Promises with verdict proven in the newest consumed pack, over the total. Eight claims here, seven proven. Null when",
        "the total is zero, and null when the graph is degraded: degraded means the enrichment axis was discarded, so a number",
        "would claim knowledge KEPT does not have. The Ledger then replaces the tile with a chip rather than showing a zero.",
        "The honest failure mode is \"we are not claiming proof right now\", and never \"proof is 0%\".",
    ])
    d.chip(896, by + 190, 788, chip_h(4), "The proven axis — acceptance criteria Kane holds facts for", [
        "Read verbatim from cover gaps, whose own configuration names its source as graph_execution_facts and its denominator",
        "as current_live_acs. Six of six, and the latest run it names is this repository's own. Reached this way because the",
        "singular cover command reads its depth axis out of a sealed pack, and a coverage document is minted only at authoring",
        "time — every pack here is a replay pack, so cover refuses at exit 2 rather than answering with a stale number.",
    ])

    # ── the lanes ─────────────────────────────────────────────────────────
    cy = 954
    d.group(40, cy, 1660, 406, "How the graph is laid out, and why it is a pure function",
            "Four lanes, x by kind and y by verdict rank then id. No layout engine, no physics, no jitter between screenshots.")
    lanes = [
        ("lane 0 — documents", [
            "One node per cited file. Ids are prefixed",
            "by kind, so the Ledger can lane an edge",
            "without a lookup back into the graph.",
        ]),
        ("lane 1 — promises", [
            "Claim text, citation path and line, and a",
            "verdict tag. Red sorts to the top, so the",
            "thing needing attention is where eyes land.",
        ]),
        ("lane 2 — designed tests", [
            "One node per *_test.md, keyed on the path",
            "rather than on Kane's test id, which a",
            "later plan may renumber.",
        ]),
        ("lane 3 — evidence packs", [
            "Ids are a readable stamp rather than a",
            "hash, so a reviewer can find the pack in",
            "the committed tree by reading the URL.",
        ]),
    ]
    lane_w = (1660 - 32 - 3 * 12) / 4
    for i, (title, body) in enumerate(lanes):
        d.chip(56 + i * (lane_w + 12), cy + 78, lane_w, chip_h(3), title, body)

    d.note(56, cy + 186, 1628, chip_h(2), "Motion is layered on top and never feeds back into the layout", [
        "The staggered entrance animates opacity and a six-pixel offset from the position the layout already computed, so the resting state is byte-identical to the",
        "no-motion render. A screenshot taken after the entrance completes is pixel-identical to one taken with motion disabled entirely.",
    ])
    d.chip(56, cy + 268, 1628, chip_h(4), "Under prefers-reduced-motion: reduce, every orchestration resolves to its end state synchronously on first paint", [
        "Nodes at opacity 1. Metric figures at their final value. The panel open. Edges fully drawn. Verdict tags at their final colour and scale.",
        "The reduced-motion render and the post-animation render are the same DOM with the same computed styles, and a test asserts that directly rather than",
        "describing it. Nothing in the Ledger's information is carried by motion: every verdict, figure, citation and link is present and correct with motion off.",
        "The media query is observed live, and an in-flight timeline is completed rather than cancelled — cancelling would leave the DOM half-way.",
    ])

    return d


def main() -> int:
    return build_all([
        (repair(), "kept-repair-branches.svg"),
        (lifecycle(), "kept-promise-lifecycle.svg"),
    ])


if __name__ == "__main__":
    raise SystemExit(main())
