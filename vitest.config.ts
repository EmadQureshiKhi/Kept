import { defineConfig } from 'vitest/config';

/**
 * Single root Vitest config for the whole workspace (design §2.1).
 * Always run with `--run` — watch mode is never used in this repo.
 *
 * Projects:
 *   kept-core — node environment, parser/model/provider/verdict units and properties
 *   @corgod/kept-cli  — node environment, argv assertions and command wiring
 *   ledger    — jsdom environment, React component and reduced-motion parity tests
 *   fixture   — node environment, Kepler Coffee's cart/currency/storage arithmetic
 *
 * The fixture project covers `apps/fixture/test/**` only. Kane's Markdown test
 * corpus — the eight `*_test.md` designed tests — lives at the **repository root**
 * in `tests/`, is not a Vitest suite, and is deliberately not matched by any
 * project glob here.
 *
 * `passWithNoTests` is a root-level option in Vitest 4 and is kept on while the
 * package skeletons land (tasks 1.2 onward), so `npm test` is green on an empty
 * suite. JSX in the ledger project is transformed from that app's own tsconfig
 * (`"jsx": "react-jsx"`), so no plugin is needed here.
 *
 * ── Timeouts, and why they are this large ──────────────────────────────────────
 *
 * Nothing in this suite is slow. The disk is. This working tree sits under an
 * iCloud-synced directory, so a package's files can be *dataless* — present in
 * the listing, absent from the disk — until something reads them, and the first
 * read pays the download. Measured here: the very first `import('jsdom')` took
 * **629 seconds**; every load after it took 479 ms. That is a storage-latency
 * cost paid once per file, not a test that got slower, and it is why the ledger
 * project failed six-files-zero-tests with
 * `[vitest-pool-runner]: Timeout waiting for worker to respond` at exactly 60.0 s
 * on trees where none of the tested code even existed yet.
 *
 * Two mitigations, because they address different halves of that:
 *
 *   1. The budgets below are raised well past any honest runtime, so a cold file
 *      read inside a test or hook cannot be mistaken for a hang.
 *   2. The ledger project is pinned to a **single fork**. The worker-start budget
 *      itself is a fixed internal constant in Vitest (60 s) with no configuration
 *      surface, so it cannot be raised from here — what can be reduced is the
 *      number of processes racing to cold-start a jsdom environment at once. One
 *      process materialises jsdom once and every subsequent file in the project
 *      reuses it, instead of four workers each starting their own clock against
 *      that same fixed budget.
 *
 * If the ledger project ever does time out again, the fix is to warm the file
 * cache (`node -e "import('jsdom')"`) rather than to touch the tests.
 */
export default defineConfig({
  test: {
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 30_000,
    projects: [
      {
        test: {
          name: 'kept-core',
          environment: 'node',
          include: ['packages/kept-core/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: '@corgod/kept-cli',
          environment: 'node',
          include: ['packages/kept-cli/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'ledger',
          environment: 'jsdom',
          globals: true,
          include: ['apps/ledger/test/**/*.test.{ts,tsx}'],
          /* One process for the whole project, so jsdom cold-starts once rather
             than once per worker. See the note above: the start budget is a fixed
             constant, the contention for it is what this removes. `isolate: false`
             is safe here because every ledger suite is a pure source scan or a
             render-and-assert with no cross-file global state. */
          pool: 'forks',
          isolate: false,
          fileParallelism: false,
          /* Its own group, so serialising this project does not ask Vitest to
             reconcile one `maxWorkers` against the other three projects' — which
             it refuses to do, by design, when they share a group order. */
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: 'fixture',
          environment: 'node',
          include: ['apps/fixture/test/**/*.test.ts'],
        },
      },
    ],
  },
});
