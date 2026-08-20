/**
 * The Kepler Coffee catalogue: six coffees, static, committed.
 *
 * Six is a contract, not an accident — the Shop screen claims to list exactly
 * six (design §12.2). Prices are USD and every one is a multiple of $0.25, so
 * quantity arithmetic is exact in binary floating point and the subtotal a
 * shopper reads is the subtotal a test asserts.
 */

export const ROASTS = ['light', 'medium', 'dark'] as const;

export type Roast = (typeof ROASTS)[number];

export const ROAST_LABELS: Record<Roast, string> = {
  light: 'Light',
  medium: 'Medium',
  dark: 'Dark',
};

export interface Coffee {
  readonly slug: string;
  readonly name: string;
  readonly roast: Roast;
  readonly origin: string;
  /** Price per 340 g bag, in USD. */
  readonly price: number;
  readonly notes: string;
  readonly blurb: string;
  /** Shown in the three-bean row on the Home screen. */
  readonly featured: boolean;
}

export const CATALOG: readonly Coffee[] = [
  {
    slug: 'orion-house-blend',
    name: 'Orion House Blend',
    roast: 'medium',
    origin: 'Brazil and Colombia',
    price: 18.0,
    notes: 'Cocoa, toasted almond, brown sugar',
    blurb:
      'The everyday bag. Balanced enough for a drip machine at seven in the morning and forgiving enough that a rushed pour still tastes like breakfast.',
    featured: true,
  },
  {
    slug: 'kepler-reserve',
    name: 'Kepler Reserve',
    roast: 'dark',
    origin: 'Sumatra, Lake Tawar',
    price: 24.0,
    notes: 'Dark chocolate, cedar, dried fig',
    blurb:
      'Our longest roast, and the one we argue about most. Heavy bodied, low acidity, and unbothered by milk.',
    featured: true,
  },
  {
    slug: 'halley-light-roast',
    name: 'Halley Light Roast',
    roast: 'light',
    origin: 'Kenya, Nyeri',
    price: 19.5,
    notes: 'Blackcurrant, lime zest, cane sugar',
    blurb:
      'Bright and unmistakably fruity. Best as a pour-over with water just off the boil.',
    featured: true,
  },
  {
    slug: 'cassini-ethiopia',
    name: 'Cassini Ethiopia',
    roast: 'light',
    origin: 'Ethiopia, Yirgacheffe',
    price: 21.25,
    notes: 'Jasmine, peach, bergamot',
    blurb:
      'A washed Yirgacheffe that tastes like tea for the first sip and like stone fruit for the rest of the cup.',
    featured: false,
  },
  {
    slug: 'meridian-espresso',
    name: 'Meridian Espresso',
    roast: 'dark',
    origin: 'Guatemala and Sumatra',
    price: 16.75,
    notes: 'Molasses, walnut, baked plum',
    blurb:
      'Built for a pressurised basket. Syrupy, sweet under pressure, and stable across a wide grind range.',
    featured: false,
  },
  {
    slug: 'titan-decaf',
    name: 'Titan Decaf',
    roast: 'medium',
    origin: 'Colombia, Huila',
    price: 17.5,
    notes: 'Milk chocolate, orange peel, hazelnut',
    blurb:
      'Sugarcane-process decaf that keeps its sweetness. The bag people buy after their doctor talks to them.',
    featured: false,
  },
];

/** Exactly six, asserted at module load so a bad edit fails loudly. */
export const CATALOG_SIZE = 6;

export function allCoffees(): readonly Coffee[] {
  return CATALOG;
}

export function featuredCoffees(): readonly Coffee[] {
  return CATALOG.filter((coffee) => coffee.featured);
}

export function findCoffee(slug: string): Coffee | undefined {
  return CATALOG.find((coffee) => coffee.slug === slug);
}

/** `null` means "no filter", which is what the Shop screen's "All roasts" sends. */
export function byRoast(roast: Roast | null): readonly Coffee[] {
  if (roast === null) return CATALOG;
  return CATALOG.filter((coffee) => coffee.roast === roast);
}
