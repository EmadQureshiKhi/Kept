import { describe, expect, it } from 'vitest';

import { memoryStore, namespaced, read, remove, STORAGE_KEYS, write } from '../lib/storage';

describe('namespaced', () => {
  it('prefixes every key so the app never collides with another origin user', () => {
    expect(namespaced('cart')).toBe('kepler.cart');
    expect(namespaced(STORAGE_KEYS.orders)).toBe('kepler.orders');
  });
});

describe('read and write', () => {
  it('round-trips a value through JSON', () => {
    const store = memoryStore();
    write('cart', [{ slug: 'orion-house-blend', qty: 2 }], store);
    expect(read('cart', [], store)).toEqual([{ slug: 'orion-house-blend', qty: 2 }]);
  });

  it('writes under the namespaced key', () => {
    const store = memoryStore();
    write('currency', 'EUR', store);
    expect(store.getItem('kepler.currency')).toBe('"EUR"');
  });

  it('returns the fallback for a key that was never set', () => {
    expect(read('orders', ['fallback'], memoryStore())).toEqual(['fallback']);
  });

  it('returns the fallback for text that is not JSON', () => {
    const store = memoryStore({ 'kepler.cart': '{not json' });
    expect(read('cart', [], store)).toEqual([]);
  });

  it('treats a missing store as an absent value, which is what happens on the server', () => {
    expect(read('cart', ['fallback'], null)).toEqual(['fallback']);
    expect(() => write('cart', [1], null)).not.toThrow();
    expect(() => remove('cart', null)).not.toThrow();
  });

  it('survives a store that throws, as a privacy-mode browser does', () => {
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(read('cart', ['fallback'], hostile)).toEqual(['fallback']);
    expect(() => write('cart', [1], hostile)).not.toThrow();
    expect(() => remove('cart', hostile)).not.toThrow();
  });
});

describe('remove', () => {
  it('deletes the namespaced key', () => {
    const store = memoryStore();
    write('cart', [1], store);
    remove('cart', store);
    expect(store.getItem('kepler.cart')).toBeNull();
    expect(read('cart', ['fallback'], store)).toEqual(['fallback']);
  });
});
