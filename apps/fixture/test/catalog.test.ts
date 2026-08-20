import { describe, expect, it } from 'vitest';

import {
  allCoffees,
  byRoast,
  CATALOG_SIZE,
  featuredCoffees,
  findCoffee,
  ROASTS,
} from '../lib/catalog';

describe('catalogue', () => {
  it('lists exactly six coffees', () => {
    expect(allCoffees()).toHaveLength(CATALOG_SIZE);
    expect(CATALOG_SIZE).toBe(6);
  });

  it('has a unique slug per coffee', () => {
    const slugs = allCoffees().map((coffee) => coffee.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('prices every coffee above zero, in whole cents', () => {
    for (const coffee of allCoffees()) {
      expect(coffee.price).toBeGreaterThan(0);
      expect(Math.round(coffee.price * 100)).toBe(coffee.price * 100);
    }
  });

  it('features three coffees for the Home screen', () => {
    expect(featuredCoffees()).toHaveLength(3);
  });

  it('has at least one coffee in every roast level, so no filter is ever empty', () => {
    for (const roast of ROASTS) {
      expect(byRoast(roast).length).toBeGreaterThan(0);
    }
  });

  it('partitions the shelf across the roast filters', () => {
    const filtered = ROASTS.reduce((total, roast) => total + byRoast(roast).length, 0);
    expect(filtered).toBe(CATALOG_SIZE);
  });

  it('returns the whole shelf for no filter', () => {
    expect(byRoast(null)).toHaveLength(CATALOG_SIZE);
  });

  it('finds a coffee by slug and returns undefined for an unknown one', () => {
    expect(findCoffee('kepler-reserve')?.name).toBe('Kepler Reserve');
    expect(findCoffee('not-a-coffee')).toBeUndefined();
  });
});
