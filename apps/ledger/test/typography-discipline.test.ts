/**
 * Source scan 5 of 6 — typography discipline. Design §10.7, R10.1, R10.6.
 *
 * Three rules, each guarding a decision that is invisible until it is gone:
 *
 * 1. **Mono as texture, not as default.** `--font-mono` belongs to promise ids,
 *    `path:line` citations, designed-test ids, `result_code` and `reason_code`,
 *    credit figures, ISO timestamps, member statuses, diff bodies and metric
 *    numerals. Prose is `--font-ui`. The contrast between the two *is* the page's
 *    main typographic device, so mono spent on a sentence does not merely look
 *    wrong, it flattens the whole page. The mechanical form of "is a sentence" is
 *    a run of four or more consecutive non-identifier words.
 *
 * 2. **Tabular, lining numerals wherever a number animates or aligns.** The
 *    metric count-up of §10.6.2 jitters with proportional digits, and a credits
 *    column with proportional digits does not form a column. Non-negotiable, so
 *    asserted rather than remembered.
 *
 * 3. **`--wash-*` never behind text.** Design §10.4.3 keeps the washes on a node's
 *    3px left edge, a rail tile's trough and a tag's 1px border precisely so the
 *    contrast matrix stays finite. Property 22 (task 9.5) then *relies* on that
 *    exclusion. This scan checks it instead of trusting it — an unchecked
 *    exclusion is an assumption with a test-shaped hat on.
 *
 * Rules 1 and 2 address the component tree, which stage 9 has not built yet. They
 * are written now, against the file extension rather than a directory name, so
 * they engage the moment the first `.tsx` lands and cannot be disarmed by moving
 * `components/`. Until then the detectors themselves carry the coverage: every
 * pattern below is proven to catch known-bad text and to leave known-good text
 * alone, and the absence of components is asserted explicitly rather than skipped
 * quietly.
 */

import { describe, expect, it } from 'vitest';

import {
  CODE_EXTENSIONS,
  STYLE_EXTENSIONS,
  componentFiles,
  parseCss,
  scanLedger,
  type ScannedFile,
} from './_scan.js';

/** The declaration §10.7 makes non-negotiable, whitespace-normalised. */
const TABULAR = 'font-variant-numeric: tabular-nums lining-nums';

/** A run of this many consecutive prose words makes a sentence. */
const SENTENCE_WORDS = 4;

/**
 * Where a number animates or aligns (§10.7). Each site is matched by identifier,
 * not by the English word, so a mention of credits in prose is not mistaken for
 * the credits column.
 */
const TABULAR_SITES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'MetricFigure', pattern: /\bMetricFigure\b|\bmetric-figure\b/ },
  { name: 'the credits column', pattern: /\bCreditsColumn\b|\bcredits-column\b|\bcreditsColumn\b/ },
  { name: 'run durations', pattern: /\bRunDuration\b|\brun-duration\b|\brunDuration\b/ },
  { name: 'the diff gutter', pattern: /\bDiffGutter\b|\bdiff-gutter\b|\bdiffGutter\b/ },
];

/**
 * Properties a verdict wash may colour: an edge, a trough, a border. Never
 * `color`, and never a fill that sits under text — the rule below checks the
 * second half of that by requiring the rule to carry no text of its own.
 */
const WASH_PROPERTIES = new Set([
  'background',
  'background-color',
  'background-image',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
]);

const WASH_TOKEN = /--wash-[\w-]+/g;

/* ─────────────────────────── the mono-as-texture rule ─────────────────────── */

/**
 * `true` for a word that is a machine identifier rather than English: it carries
 * separator punctuation, a digit, or is a shouted constant. `result_code`,
 * `apps/ledger/lib/tokens.ts:42`, `PR-118`, `2026-01-04T09:12:00Z` and `SKIPPED`
 * are all identifiers. `the`, `claim` and `designed` are not.
 */
export function isIdentifierWord(word: string): boolean {
  const bare = word.replace(/^[("'`\[]+|[)"'`\],.;:!?]+$/g, '');
  if (bare === '') return true;
  if (/[_/\\:.@#$%()[\]{}=<>|~^]/.test(bare)) return true;
  if (/\d/.test(bare)) return true;
  if (/-/.test(bare)) return true;
  if (bare.length > 1 && bare === bare.toUpperCase() && /[A-Z]/.test(bare)) return true;
  if (/[a-z][A-Z]/.test(bare)) return true;
  return false;
}

/**
 * `true` when `text` contains a run of `SENTENCE_WORDS` or more consecutive
 * non-identifier words — the mechanical reading of "this is prose" from §10.7.
 */
export function isSentence(text: string): boolean {
  let run = 0;
  for (const word of text.trim().split(/\s+/)) {
    if (word === '') continue;
    run = isIdentifierWord(word) ? 0 : run + 1;
    if (run >= SENTENCE_WORDS) return true;
  }
  return false;
}

/** An element carrying a mono class or an explicit `--font-mono` family. */
const MONO_ELEMENT =
  /<([A-Za-z][\w.]*)((?:[^<>]|=>)*?(?:class(?:Name)?\s*=\s*(?:"[^"]*\bmono\b[^"]*"|'[^']*\bmono\b[^']*'|\{[^{}]*mono[^{}]*\})|--font-mono)(?:[^<>]|=>)*?)>([^<]*)/g;

export interface MonoElement {
  readonly tag: string;
  readonly text: string;
  readonly line: number;
}

/**
 * Mono-classed elements and their immediate literal text. Interpolations are
 * dropped rather than guessed at: `{promise.id}` is an identifier by
 * construction, and the rule is about the words an author typed.
 */
export function monoElements(source: string): MonoElement[] {
  const found: MonoElement[] = [];
  for (const match of source.matchAll(MONO_ELEMENT)) {
    const tag = match[1] ?? '';
    const text = (match[3] ?? '').replace(/\{[^{}]*\}/g, ' ').trim();
    if (text === '') continue;
    let line = 1;
    const upto = match.index ?? 0;
    for (let cursor = 0; cursor < upto; cursor += 1) {
      if (source[cursor] === '\n') line += 1;
    }
    found.push({ tag, text, line });
  }
  return found;
}

const TEST_DIRECTORY = 'apps/ledger/test/';

const COMPONENTS: ScannedFile[] = componentFiles();
const CODE = scanLedger(CODE_EXTENSIONS);
const STYLESHEETS = scanLedger(STYLE_EXTENSIONS);

/**
 * The shipped tree — everything the Ledger renders, with the scans themselves
 * removed.
 *
 * This exclusion is load-bearing rather than convenient. The site patterns below
 * name `MetricFigure` and the tabular declaration in the same file, so a scan that
 * read itself would find both and pass for the worst possible reason: agreeing
 * with its own definitions. The mono and wash rules need no such exclusion because
 * they read component files and stylesheets, and this file is neither.
 */
const SHIPPED: ScannedFile[] = [
  ...new Map(
    [...CODE, ...STYLESHEETS, ...COMPONENTS]
      .filter((file) => !file.path.startsWith(TEST_DIRECTORY))
      .map((file) => [file.path, file] as const),
  ).values(),
];

/* ───────────────────────────────── meta-tests ──────────────────────────────── */

describe('source scan 5 of 6 — the detectors are not a no-op', () => {
  it('read the Ledger tree, and the shipped part of it separately', () => {
    expect(CODE.length).toBeGreaterThan(0);
    expect(STYLESHEETS.length).toBeGreaterThanOrEqual(2);
    expect(SHIPPED.length, 'the shipped tree is empty — the scan would check nothing').toBeGreaterThan(
      0,
    );
    expect(SHIPPED.every((file) => !file.path.startsWith(TEST_DIRECTORY))).toBe(true);
  });

  it('calls prose prose', () => {
    const sentences = [
      'the claim is not covered by any designed test',
      'Baseline data only, so coverage cannot be proven',
      'This promise was amended after the last verified run',
    ];
    for (const text of sentences) {
      expect(isSentence(text), `not detected as prose: ${text}`).toBe(true);
    }
  });

  it('calls the permitted mono content what it is — identifiers, not prose', () => {
    const identifiers = [
      'promise:readme:currency-rounds-half-up',
      'apps/fixture/lib/currency.ts:42',
      'result_code 740',
      'reason_code MISSING_SELECTOR',
      '12 credits',
      '2026-01-04T09:12:00Z',
      'SKIPPED',
      'proven',
      'baseline data only',
      '- const rate = 0.2',
      '87%',
      'n/a',
    ];
    for (const text of identifiers) {
      expect(isSentence(text), `false-positived on mono-permitted content: ${text}`).toBe(false);
    }
  });

  it('finds a mono-classed element and reads its text', () => {
    const good = '<span className="font-mono text-xs">promise:readme:currency-rounds-half-up</span>';
    const bad = '<p className="mono">the claim is not covered by any designed test</p>';
    const prose = '<p className="claim">the claim is not covered by any designed test</p>';

    expect(monoElements(good).map((element) => element.text)).toEqual([
      'promise:readme:currency-rounds-half-up',
    ]);
    expect(monoElements(bad).map((element) => element.text)).toEqual([
      'the claim is not covered by any designed test',
    ]);
    expect(monoElements(prose)).toEqual([]);
    expect(monoElements('<code style={{ fontFamily: "var(--font-mono)" }}>ok fine</code>').length).toBe(
      1,
    );
  });

  it('would name a wash used as a text colour', () => {
    const rule = parseCss('.tag { color: var(--wash-red); }')[0];
    expect(rule?.declarations[0]?.property).toBe('color');
    expect([...(rule?.declarations[0]?.value.matchAll(WASH_TOKEN) ?? [])].length).toBe(1);
    expect(WASH_PROPERTIES.has('color')).toBe(false);
  });
});

/* ──────────────────────────── mono as texture (§10.7) ─────────────────────── */

describe('source scan 5 of 6 — mono is texture, never prose', () => {
  it('has components to scan, or none at all and says so', () => {
    if (COMPONENTS.length === 0) {
      expect(
        COMPONENTS,
        'No component file exists under apps/ledger yet (stage 9). This assertion is ' +
          'the tripwire: the mono and tabular-numeral rules below engage on the first ' +
          '.tsx to land, and this line starts failing the moment one does without the ' +
          'rules being exercised.',
      ).toEqual([]);
      return;
    }
    expect(COMPONENTS.length).toBeGreaterThan(0);
  });

  it('sets no sentence in monospace', () => {
    const offences: string[] = [];
    for (const file of COMPONENTS) {
      for (const element of monoElements(file.text)) {
        if (isSentence(element.text)) {
          offences.push(`${file.path}:${element.line}  <${element.tag}> "${element.text}"`);
        }
      }
    }
    expect(
      offences,
      offences.length === 0
        ? ''
        : `Monospace is reserved for ids, citations, result and reason codes, credit ` +
          `figures, timestamps, member statuses, diff bodies and metric numerals ` +
          `(design §10.7). Prose belongs to --font-ui; the contrast between the two is ` +
          `the page's typographic device.\n${offences.join('\n')}`,
    ).toEqual([]);
  });
});

/* ─────────────────────── tabular numerals where they matter ────────────────── */

describe('source scan 5 of 6 — tabular, lining numerals where a number aligns', () => {
  it('declares them at every site that animates or aligns a number', () => {
    const offences: string[] = [];
    let sitesSeen = 0;

    for (const site of TABULAR_SITES) {
      const mentions = SHIPPED.filter((file) => site.pattern.test(file.text));
      if (mentions.length === 0) continue;
      sitesSeen += 1;
      const declared = mentions.some((file) => file.text.includes(TABULAR));
      if (!declared) {
        offences.push(
          `${site.name} exists in ${mentions
            .map((file) => file.path)
            .join(', ')} but no file declares "${TABULAR}"`,
        );
      }
    }

    expect(
      offences,
      offences.length === 0
        ? ''
        : `The metric count-up of design §10.6.2 reflows on every frame with ` +
          `proportional digits, and a column of them is not a column.\n${offences.join('\n')}`,
    ).toEqual([]);

    if (sitesSeen === 0) {
      expect(
        TABULAR_SITES.length,
        'None of the four numeric sites exists yet (stage 9). The assertion above is ' +
          'written against the identifiers those components will carry, so it engages ' +
          'without being revisited.',
      ).toBe(4);
    }
  });
});

/* ────────────────────── washes never sit behind text (§10.4.3) ─────────────── */

describe('source scan 5 of 6 — verdict washes never sit behind text', () => {
  it('never colours text with a wash, and never puts text on one', () => {
    const offences: string[] = [];
    for (const file of STYLESHEETS) {
      for (const rule of parseCss(file.text)) {
        /* the declaration of the tokens themselves is not a use of them */
        const uses = rule.declarations.filter(
          (declaration) =>
            !declaration.property.startsWith('--wash-') &&
            [...declaration.value.matchAll(WASH_TOKEN)].length > 0,
        );
        if (uses.length === 0) continue;

        const carriesText = rule.declarations.some(
          (declaration) => declaration.property === 'color',
        );
        for (const use of uses) {
          if (!WASH_PROPERTIES.has(use.property)) {
            offences.push(
              `${file.path}:${use.line}  ${rule.prelude} { ${use.property}: ${use.value} } — a ` +
                `wash is an edge, a trough or a border, never a ${use.property}`,
            );
          }
          if (carriesText) {
            offences.push(
              `${file.path}:${use.line}  ${rule.prelude} sets both a wash and a color, so text ` +
                `sits on a wash and enters the contrast matrix Property 22 assumes is finite`,
            );
          }
        }
      }
    }
    expect(
      offences,
      offences.length === 0
        ? ''
        : `Design §10.4.3: verdict washes are permitted on a node's 3px left edge, a ` +
          `rail tile's trough and a tag's 1px border. Nowhere else, so the matrix stays ` +
          `finite and testable.\n${offences.join('\n')}`,
    ).toEqual([]);
  });

  it('leaves the wash tokens declared once and only in tokens.css', () => {
    const declaringFiles = STYLESHEETS.filter((file) =>
      file.text.includes('--wash-proven:'),
    ).map((file) => file.path);
    expect(declaringFiles).toEqual(['apps/ledger/styles/tokens.css']);
  });
});
