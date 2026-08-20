import { defineConfig } from 'vitest/config';

/**
 * Single root Vitest config for the whole workspace (design §2.1).
 * Always run with `--run` — watch mode is never used in this repo.
 *
 * Projects:
 *   kept-core — node environment, parser/model/provider/verdict units and properties
 *   kept-cli  — node environment, argv assertions and command wiring
 *   ledger    — jsdom environment, React component and reduced-motion parity tests
 *   fixture   — node environment, Kepler Coffee's cart/currency/storage arithmetic
 *
 * The fixture project covers `apps/fixture/test/**` only. `apps/fixture/tests/**`
 * is Kane's Markdown test suite, not a Vitest one, and is deliberately not
 * matched here.
 *
 * `passWithNoTests` is a root-level option in Vitest 4 and is kept on while the
 * package skeletons land (tasks 1.2 onward), so `npm test` is green on an empty
 * suite. JSX in the ledger project is transformed from that app's own tsconfig
 * (`"jsx": "react-jsx"`), so no plugin is needed here.
 */
export default defineConfig({
  test: {
    passWithNoTests: true,
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
          name: 'kept-cli',
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
