/**
 * Namespaced `localStorage` with a JSON round-trip.
 *
 * This is the whole persistence layer of Kepler Coffee. There is no API route,
 * no database and no `fetch` (R12.2) — every screen's state lives under the
 * `kepler.` key prefix in the browser.
 *
 * Two properties matter for the demonstration:
 *
 *  - **Server-safe.** `read` and `write` are callable during server rendering and
 *    simply do nothing, because `localStorage` does not exist there. Screens use
 *    that to render a deterministic pre-hydration state instead of guessing.
 *  - **Injectable.** The backing store is a parameter, so these functions are
 *    testable in a plain Node environment with an object literal, no jsdom.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const NAMESPACE = 'kepler';

export const STORAGE_KEYS = {
  cart: 'cart',
  orders: 'orders',
  currency: 'currency',
} as const;

/** `namespaced('cart') === 'kepler.cart'`. */
export function namespaced(key: string): string {
  return `${NAMESPACE}.${key}`;
}

/**
 * The browser's `localStorage`, or `null` when there isn't one: during server
 * rendering, and in a privacy mode where touching it throws.
 */
export function browserStore(): StorageLike | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const candidate = (globalThis as { localStorage?: StorageLike }).localStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads and parses a namespaced value. Returns `fallback` when the store is
 * absent, the key is unset, or the stored text is not valid JSON — a shopper
 * with a corrupted key sees an empty cart, never a crash.
 */
export function read<T>(
  key: string,
  fallback: T,
  store: StorageLike | null = browserStore(),
): T {
  if (!store) return fallback;
  try {
    const raw = store.getItem(namespaced(key));
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Serialises and stores a namespaced value. A no-op without a store. */
export function write<T>(
  key: string,
  value: T,
  store: StorageLike | null = browserStore(),
): void {
  if (!store) return;
  try {
    store.setItem(namespaced(key), JSON.stringify(value));
  } catch {
    /* Quota exceeded or storage denied: the screen keeps working in memory. */
  }
}

/** Deletes a namespaced value. A no-op without a store. */
export function remove(key: string, store: StorageLike | null = browserStore()): void {
  if (!store) return;
  try {
    store.removeItem(namespaced(key));
  } catch {
    /* Nothing useful to do; the in-memory state is still correct. */
  }
}

/** An in-memory `StorageLike`, used by the unit tests. */
export function memoryStore(seed: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}
