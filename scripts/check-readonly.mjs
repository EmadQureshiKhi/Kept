#!/usr/bin/env node
// Placeholder. Task 9.12 replaces this with the real read-only scan over
// apps/ledger: no mutating request handlers, no auth surface, no child_process,
// no `kane` string (design §15.2). Until apps/ledger exists there is nothing to
// scan, so this exits 0 and `npm run check` stays wired to its final shape.
// TODO(9.12): implement the Ledger read-only source scan and fail on violations.
process.exit(0);
