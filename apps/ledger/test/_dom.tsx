/**
 * The two browser APIs jsdom does not implement and React Flow requires.
 *
 * Not a test suite — the filename is deliberately outside Vitest's
 * `**\/*.test.{ts,tsx}` glob, matching the precedent `_scan.ts` sets. `.tsx` rather
 * than `.ts` because the root `tsconfig.json` type-checks `apps/ledger/test/**\/*.ts`
 * under `lib: ["ES2022"]` with **no DOM**, deliberately, and this module's whole
 * subject is the DOM. The `.tsx` extension puts it in `tsc -p apps/ledger` instead,
 * which is where the DOM libs live.
 *
 * **This is a shim, not a mock.** It does not stand in for anything the Ledger wrote;
 * it supplies `ResizeObserver` and `DOMRect`, which every browser has and jsdom does
 * not (jsdom has never implemented resize observation, because it does no layout).
 * Without them, importing `@xyflow/react` throws `ResizeObserver is not defined` on
 * mount and the graph cannot be asserted at all. Nothing under test is replaced: the
 * layout arithmetic, the keyboard model, the nodes, the list and the panel are all
 * the shipped code.
 *
 * The observer reports one fixed size and reports it once. That is honest about what
 * jsdom can offer — there is no layout to measure, so any number here is a stated
 * assumption rather than a measurement — and it is enough for React Flow to install
 * its viewport instead of warning that the container has no dimensions. It is
 * deliberately **not** used to make claims about width: the no-horizontal-overflow
 * assertion of R10.8 is arithmetic over the authored grid in
 * `promise-graph-density.test.ts`, precisely because jsdom cannot measure one.
 */

/** The canvas size the observer reports: the 1280px breakpoint R10.8 names. */
export const OBSERVED_WIDTH = 1280;
export const OBSERVED_HEIGHT = 620;

type ObserverCallback = (entries: readonly unknown[], observer: unknown) => void;

/**
 * Installs `ResizeObserver` and `DOMRect` on `globalThis` if they are missing.
 *
 * Idempotent, and safe to call from every suite that renders the graph: the ledger
 * project shares one jsdom instance across its files (`isolate: false`), so the
 * second call finds the first call's work and does nothing.
 */
export function installBrowserShims(): void {
  const scope = globalThis as unknown as Record<string, unknown>;

  if (scope['DOMRect'] === undefined) {
    scope['DOMRect'] = class {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      constructor(x = 0, y = 0, width = 0, height = 0) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
      }
      get top(): number {
        return this.y;
      }
      get left(): number {
        return this.x;
      }
      get right(): number {
        return this.x + this.width;
      }
      get bottom(): number {
        return this.y + this.height;
      }
      toJSON(): unknown {
        return { ...this };
      }
    };
  }

  if (scope['ResizeObserver'] !== undefined) return;

  scope['ResizeObserver'] = class {
    readonly #callback: ObserverCallback;

    constructor(callback: ObserverCallback) {
      this.#callback = callback;
    }

    observe(target: unknown): void {
      const rect = {
        x: 0,
        y: 0,
        width: OBSERVED_WIDTH,
        height: OBSERVED_HEIGHT,
        top: 0,
        left: 0,
        right: OBSERVED_WIDTH,
        bottom: OBSERVED_HEIGHT,
      };
      this.#callback(
        [{ target, contentRect: rect, borderBoxSize: [], contentBoxSize: [] }],
        this,
      );
    }

    unobserve(): void {
      /* nothing observed asynchronously, so nothing to stop */
    }

    disconnect(): void {
      /* as above */
    }
  };
}
