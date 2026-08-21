/**
 * Typed mirror of `styles/tokens.css` — design §10.4.1 and §10.4.4.
 *
 * Keys are the CSS custom property names *including* the leading `--`, so the
 * parity test (`test/token-parity.test.ts`) compares this object against the
 * stylesheet with no name mangling in between, and so the contrast matrix prints
 * the same identifiers the design document tabulates.
 *
 * Values are the CSS values with runs of whitespace collapsed to one space. The
 * parity test normalises the stylesheet the same way before comparing, which is
 * why the multi-line `--elev-*` declarations are safe to keep readable in CSS
 * and one line here.
 *
 * Nothing in this module reaches for the DOM, so it type-checks under the
 * repository's no-DOM `lib` and is importable from a Node test, a React server
 * component and the badge renderer alike.
 */

export const TOKENS = {
  /* paper surfaces — the `--ink-*` names are kept, the values are now paper and
     the ramp reads brighter as it rises */
  '--ink-000': '#F4F3EE',
  '--ink-050': '#E9E8E0',
  '--ink-100': '#FCFCF9',
  '--ink-150': '#FFFFFF',

  /* The two rules are ink at 18% and 32% over the page in intent, written as the
     opaque flattening of exactly that: `parseHex` below accepts hex only, and both
     rules are pinned as non-text cells in the matrix, so an rgba() value here would
     throw rather than measure. Recompute if the page surface moves. */
  '--hairline': '#CAC9C5',
  '--hairline-strong': '#A9A9A5',

  /* light: one implied source, above and 15° off vertical */
  '--light-edge': 'rgba(255, 255, 255, 0.90)',
  '--light-edge-strong': 'rgba(255, 255, 255, 1)',
  '--light-wash': 'rgba(255, 255, 255, 0.55)',
  '--occlude': '#0B0B0B',

  /* text */
  '--text-000': '#0B0B0B',
  '--text-100': '#3A3A40',
  '--text-200': '#55555A',

  /* verdicts — the only chromatic channel, darkened for AA on paper */
  '--verdict-proven': '#1F6F4A',
  '--verdict-stale': '#6B5426',
  '--verdict-red': '#9A4630',
  '--verdict-undesigned': '#55555A',

  /* verdict washes — edges, troughs and tag borders only, never behind text */
  '--wash-proven': 'rgba(31, 111, 74, 0.16)',
  '--wash-stale': 'rgba(107, 84, 38, 0.16)',
  '--wash-red': 'rgba(154, 70, 48, 0.18)',
  '--wash-undesigned': 'rgba(85, 85, 90, 0.14)',

  /* structural accent — a solid ink focus ring only */
  '--focus': '#0B0B0B',

  /* elevation ramp — hard offset slab, zero blur, one direction */
  '--elev-0': 'none',
  '--elev-1': '0 1px 0 0 var(--light-edge) inset, 4px 4px 0 0 var(--occlude)',
  '--elev-2': '0 1px 0 0 var(--light-edge-strong) inset, 6px 6px 0 0 var(--occlude)',
  '--elev-3': '0 1px 0 0 var(--light-edge-strong) inset, 10px 10px 0 0 var(--occlude)',

  /* neubrutalist geometry — parity covers every declared custom property, not just
     the colours, so these are mirrored here too */
  '--line': '2px',
  '--line-heavy': '3px',
  '--shadow-pressed': '1px 1px 0 0 var(--occlude)',
  '--grid-cell': '28px',

  /* type scale (16px root) */
  '--fs-root': '0.9375rem',
  '--fs-micro': '0.6875rem',
  '--fs-xs': '0.75rem',
  '--fs-sm': '0.8125rem',
  '--fs-base': '0.875rem',
  '--fs-md': '1rem',
  '--fs-lg': '1.25rem',
  '--fs-xl': '1.75rem',
  '--fs-metric': '2.5rem',

  /* leading, loosest first: the document inherits --lh-root, prose resets to
     --lh-body, display type sets solid at --lh-display */
  '--lh-root': '1.6',
  '--lh-tight': '1.2',
  '--lh-body': '1.55',
  '--lh-mono': '1.45',
  '--lh-display': '1.1',

  /* tracking — one step per role, negative as the size grows and positive as it
     shrinks into caps */
  '--tr-display': '-0.03em',
  '--tr-heading': '-0.02em',
  '--tr-tight': '-0.011em',
  '--tr-mono': '0.002em',
  '--tr-caps-nav': '0.02em',
  '--tr-caps-wordmark': '0.04em',
  '--tr-caps-label': '0.06em',
  '--tr-caps-table': '0.09em',
  '--tr-caps-eyebrow': '0.1em',

  /* spacing — 4-based, no other values permitted */
  '--s-1': '4px',
  '--s-2': '8px',
  '--s-3': '12px',
  '--s-4': '16px',
  '--s-6': '24px',
  '--s-8': '32px',
  '--s-12': '48px',
  '--s-16': '64px',

  /* radii */
  '--r-chip': '2px',
  '--r-card': '6px',
  '--r-panel': '10px',

  /* motion — consumed by lib/motion.ts (§10.6) */
  '--dur-micro': '90ms',
  '--dur-fast': '160ms',
  '--dur-base': '240ms',
  '--dur-slow': '420ms',
  '--dur-figure': '760ms',
  '--dur-pulse': '1400ms',
  '--stagger-node': '24ms',
  '--stagger-panel': '40ms',
  '--ease-out': 'cubic-bezier(.16, .84, .28, 1)',
  '--ease-in-out': 'cubic-bezier(.50, .00, .20, 1)',
  '--ease-emphasis': 'cubic-bezier(.20, .90, .10, 1)',

  /* type families — system stacks, zero downloads */
  '--font-ui': 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  '--font-mono': 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
} as const;

/** Every declared token name, as a union. */
export type TokenName = keyof typeof TOKENS;

/**
 * The four paper surfaces a foreground can land on, in ramp order: page, recess,
 * raised, raised-2. Elevation now reads brighter as it rises, so `--ink-050` is the
 * darkest of the four and the worst case for dark text. `--ink-150` is the hover /
 * selected fill, so a pair that clears its floor across all four clears it in every
 * interaction state (§10.4.2).
 */
export const INK_SURFACES = ['--ink-000', '--ink-050', '--ink-100', '--ink-150'] as const;

/**
 * How a pair is judged.
 *
 * - `body`     — text a reader reads. WCAG 1.4.3 floor, 4.5:1 (R10.6).
 * - `node-label` — a graph node's label, large-ish and always paired with a word
 *                  as well as a colour. 3:1 (R10.6, Property 22).
 * - `non-text` — a 1px rule or a focus ring. Never text, never the sole carrier
 *                of meaning, and therefore excluded from the text floors *by
 *                construction* rather than by exception (§10.4.2).
 */
export type ContrastRole = 'body' | 'node-label' | 'non-text';

/** The floor each judged role must clear. `non-text` carries no text floor. */
export const CONTRAST_FLOORS: { readonly body: 4.5; readonly 'node-label': 3 } = {
  body: 4.5,
  'node-label': 3,
};

export interface ContrastPair {
  readonly fg: TokenName;
  readonly bg: TokenName;
  readonly role: ContrastRole;
}

/**
 * Every foreground/background pair the components actually use (§10.4.4).
 *
 * Enumerated rather than generated: a cross product would quietly acquire a
 * meaning-free pair the moment a token is added, and the point of the matrix is
 * that each row is a real place in the interface.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  /* body, secondary and label text across the whole ramp — §10.4.2 rows 1-3 */
  { fg: '--text-000', bg: '--ink-000', role: 'body' },
  { fg: '--text-000', bg: '--ink-050', role: 'body' },
  { fg: '--text-000', bg: '--ink-100', role: 'body' },
  { fg: '--text-000', bg: '--ink-150', role: 'body' },
  { fg: '--text-100', bg: '--ink-000', role: 'body' },
  { fg: '--text-100', bg: '--ink-050', role: 'body' },
  { fg: '--text-100', bg: '--ink-100', role: 'body' },
  { fg: '--text-100', bg: '--ink-150', role: 'body' },
  { fg: '--text-200', bg: '--ink-000', role: 'body' },
  { fg: '--text-200', bg: '--ink-050', role: 'body' },
  { fg: '--text-200', bg: '--ink-100', role: 'body' },
  { fg: '--text-200', bg: '--ink-150', role: 'body' },

  /* verdict text on the page and the panel base: tag text, freshness chip,
     diff deletions — read as body copy, so held to the body floor */
  { fg: '--verdict-proven', bg: '--ink-000', role: 'body' },
  { fg: '--verdict-proven', bg: '--ink-050', role: 'body' },
  { fg: '--verdict-stale', bg: '--ink-000', role: 'body' },
  { fg: '--verdict-stale', bg: '--ink-050', role: 'body' },
  { fg: '--verdict-red', bg: '--ink-000', role: 'body' },
  { fg: '--verdict-red', bg: '--ink-050', role: 'body' },
  { fg: '--verdict-undesigned', bg: '--ink-000', role: 'body' },
  { fg: '--verdict-undesigned', bg: '--ink-050', role: 'body' },

  /* the same four hues as a graph node's label, on the raised node fill and on
     the hovered / selected fill — the pairs Property 22 measures */
  { fg: '--verdict-proven', bg: '--ink-100', role: 'node-label' },
  { fg: '--verdict-proven', bg: '--ink-150', role: 'node-label' },
  { fg: '--verdict-stale', bg: '--ink-100', role: 'node-label' },
  { fg: '--verdict-stale', bg: '--ink-150', role: 'node-label' },
  { fg: '--verdict-red', bg: '--ink-100', role: 'node-label' },
  { fg: '--verdict-red', bg: '--ink-150', role: 'node-label' },
  { fg: '--verdict-undesigned', bg: '--ink-100', role: 'node-label' },
  { fg: '--verdict-undesigned', bg: '--ink-150', role: 'node-label' },

  /* badge inversion (§10.11): the verdict word in ink *on* a verdict fill, which
     is the one place a verdict token is a background */
  { fg: '--ink-000', bg: '--verdict-proven', role: 'body' },
  { fg: '--ink-000', bg: '--verdict-stale', role: 'body' },
  { fg: '--ink-000', bg: '--verdict-red', role: 'body' },
  { fg: '--ink-000', bg: '--verdict-undesigned', role: 'body' },

  /* non-text: a 3px solid ink focus outline and two 1px rules. Never text, and
     never the sole carrier of meaning */
  { fg: '--focus', bg: '--ink-000', role: 'non-text' },
  { fg: '--focus', bg: '--ink-050', role: 'non-text' },
  { fg: '--focus', bg: '--ink-100', role: 'non-text' },
  { fg: '--focus', bg: '--ink-150', role: 'non-text' },
  { fg: '--hairline', bg: '--ink-000', role: 'non-text' },
  { fg: '--hairline-strong', bg: '--ink-000', role: 'non-text' },
];

/** `#RGB`, `#RRGGBB` and their alpha forms, to 8-bit channels. */
export function parseHex(value: string): { r: number; g: number; b: number } {
  const body = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(body) || ![3, 4, 6, 8].includes(body.length)) {
    throw new Error(
      `parseHex expects a hex colour, received "${value}". Tokens in the contrast ` +
        `matrix are opaque hex by construction — an rgba() token belongs to the ` +
        `wash or light group, which never carries text (design §10.4.3).`,
    );
  }
  const short = body.length === 3 || body.length === 4;
  const at = (index: number): number => {
    const slice = short
      ? `${body[index] ?? ''}${body[index] ?? ''}`
      : body.slice(index * 2, index * 2 + 2);
    return Number.parseInt(slice, 16);
  };
  return { r: at(0), g: at(1), b: at(2) };
}

/** WCAG 2.1 relative luminance of an opaque colour. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const channel = (eight: number): number => {
    const srgb = eight / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG 2.1 contrast ratio. Symmetric, so the badge's inverted pairs need no
 * separate formula — only a separate row in the matrix.
 */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The ratio for a pair, resolved through `TOKENS`. */
export function pairRatio(pair: ContrastPair): number {
  return contrastRatio(TOKENS[pair.fg], TOKENS[pair.bg]);
}
