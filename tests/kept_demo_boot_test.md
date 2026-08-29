---
mode: testing
url: http://localhost:3000/
tags: [kept, demo, self-cited]
---

# npm run demo serves the Ledger on 3000 and the fixture on 3100

<!-- @verifies README.md:141 the demo command claim -->

**This promise is cited to KEPT's own README, not to the fixture's** (design §23.1, R19.1).
Line 68 of the root `README.md` is the one line that states which two applications
`npm run demo` brings up and on which ports, so it is the line this document cites. Nothing
about the citation is special: the admission gate reads the line off disk exactly as it reads
`apps/fixture/README.md:13`, `promiseId` keys on the path plus the claim exactly as it does
there, and the fence derivation puts `README.md` on `code-break`'s forbidden side because
`subject.docs` names it. That parity is what Property 36 pins.

**No Kane run has ever been authored for this document, and the frontmatter says so by
carrying no `assurance.id`.** A member's identifier is read from its recording, so a document
with no recording under `tests/output-*/` gets no `test_id` from `testrun_plan`, and
`kept verify --all` therefore leaves it out and records the exclusion rather than authoring it
live. The cost of admitting this claim is zero credits, and the price of that is an honest
one: the promise stands in the graph unproven, and the Ledger publishes the lower coverage
figure instead of a figure that leaves the claim out (R19.4, R19.5).

**No `@covers` globs, deliberately.** A claim about the demo command is not a claim about a
fixture source file, so no source save should pull this document into a blast radius. An empty
radius here is the correct radius.

The two assertions below are the two halves of line 68. Both origins render server-side, so
neither waits on hydration: the Ledger's hero title is in the first response, and the fixture's
Shop count line is too.

## Step 1: assert the Ledger is serving on port 3000

Navigate to http://localhost:3000/ and assert that the page shows the heading
"The promises this codebase makes".

## Step 2: assert the fixture is serving on port 3100

Navigate to http://localhost:3100/shop and assert that the Shop screen reads
"Showing 6 of 6 coffees".
