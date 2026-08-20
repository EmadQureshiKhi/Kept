/**
 * `PromiseNode` and `LaneNode`, rendered — task 9.6, design §10.3, §10.7, §10.8,
 * R8.1, R10.2, R10.5, R10.7.
 *
 * jsdom applies no stylesheet, so every assertion here is the render a reader gets
 * with colour, depth and clamping taken away. That is the right shape for a node:
 * §10.3 asks it to carry four pieces of information, R10.5 asks that colour never be
 * the only channel for one of them, and a test that could only see the styled version
 * would prove neither.
 *
 * Four claims, one per row of the node, plus the two structural ones:
 *
 *   1. the id is present verbatim, because it is the handle `?p=<id>` deep-links with;
 *   2. the claim is present in full in `title` even though CSS clamps it to two lines
 *      (§10.7) — the ellipsis costs a reader a hover, never the sentence;
 *   3. the `path:line` is spelled by `lib/citation.ts`, so the node and the panel
 *      cannot disagree about where a claim is written;
 *   4. the verdict arrives as a word, from `VerdictTag`.
 *
 * The geometry — 320×76, the 3px wash edge, the two-line clamp — is asserted in
 * `promise-graph-density.test.ts` against the stylesheet, because jsdom does no
 * layout and any width it reported here would be a fiction.
 */

import { cleanup, render } from '@testing-library/react';
import type { SnapshotPromise, Verdict } from '@kept/core';
import { SnapshotPromiseSchema } from '@kept/core';
import { afterEach, describe, expect, it } from 'vitest';

import { LANE_WORDS, LaneNode } from '../components/LaneNode.js';
import { PromiseNode } from '../components/PromiseNode.js';
import { citationLabel } from '../lib/citation.js';
import { VERDICT_RANK } from '../lib/layout.js';
import { snapshot } from '../lib/snapshot.js';

afterEach(cleanup);

const VERDICTS = Object.keys(VERDICT_RANK) as readonly Verdict[];

/** A long claim, so the two-line clamp has something to clamp. */
const LONG_CLAIM =
  'The cart subtotal rounds every line item half up to the nearest whole cent before ' +
  'the order total is computed, so a basket of three items never disagrees with the ' +
  'sum a customer adds up by hand.';

function makePromise(overrides: Partial<SnapshotPromise> = {}): SnapshotPromise {
  return SnapshotPromiseSchema.parse({
    id: 'p_177308118beb',
    claim: LONG_CLAIM,
    citation: { file: 'apps/fixture/README.md', line: 19, text: `- ${LONG_CLAIM}` },
    designedTest: { path: 'tests/settings_currency_test.md', testId: 'T-6' },
    verdict: 'stale',
    verdictSource: null,
    repair: null,
    evidencePackId: null,
    providers: ['baseline'],
    credits: null,
    ...overrides,
  });
}

describe('PromiseNode — the four things §10.3 puts on a node', () => {
  it('names the id, the claim, the citation and the verdict, as text', () => {
    const promise = makePromise();
    const { container, unmount } = render(<PromiseNode promise={promise} />);
    try {
      const node = container.querySelector(`[data-promise-node="${promise.id}"]`);
      expect(node, 'the node is not addressable by its promise id').not.toBeNull();

      expect(node?.querySelector('.promise-node__id')?.textContent).toBe(promise.id);
      expect(node?.querySelector('.promise-node__claim')?.textContent).toBe(promise.claim);
      expect(node?.querySelector('.promise-node__citation')?.textContent).toBe(
        citationLabel(promise.citation),
      );
      expect(node?.querySelector('.promise-node__citation')?.textContent).toBe(
        'apps/fixture/README.md:19',
      );

      /* R10.5: the verdict is a word, not only a hue */
      expect(node?.querySelector('.verdict-tag')?.textContent).toBe(promise.verdict);
    } finally {
      unmount();
    }
  });

  it('carries the whole claim in title, so the two-line clamp costs nothing (§10.7)', () => {
    const promise = makePromise();
    const { container, unmount } = render(<PromiseNode promise={promise} />);
    try {
      const claim = container.querySelector('.promise-node__claim');
      expect(claim?.getAttribute('title')).toBe(promise.claim);
      expect(promise.claim.length, 'the fixture claim is too short to clamp').toBeGreaterThan(120);
    } finally {
      unmount();
    }
  });

  it('states its verdict structurally for every verdict in the vocabulary', () => {
    for (const verdict of VERDICTS) {
      const { container, unmount } = render(<PromiseNode promise={makePromise({ verdict })} />);
      try {
        const node = container.querySelector('.promise-node');
        expect(node?.getAttribute('data-verdict')).toBe(verdict);
        expect(node?.textContent).toContain(verdict);
      } finally {
        unmount();
      }
    }
  });
});

describe('PromiseNode — selection and the roving focus model (§10.8)', () => {
  it('is a button that is not a tab stop, because the container roves focus', () => {
    const { container, unmount } = render(<PromiseNode promise={makePromise()} />);
    try {
      const node = container.querySelector('.promise-node');
      expect(node?.getAttribute('role')).toBe('button');
      expect(
        node?.getAttribute('tabindex'),
        'a focusable node per promise turns a 200-promise graph into a 200-stop tab trap',
      ).toBe('-1');
    } finally {
      unmount();
    }
  });

  it('reports its own id on click, so the graph owns what selection means', () => {
    const promise = makePromise();
    const selected: string[] = [];
    const { container, unmount } = render(
      <PromiseNode onSelect={(id) => selected.push(id)} promise={promise} />,
    );
    try {
      container.querySelector<HTMLElement>('.promise-node')?.click();
      expect(selected).toEqual([promise.id]);
    } finally {
      unmount();
    }
  });

  it('marks the selected state without borrowing the focus ring', () => {
    const promise = makePromise();
    const plain = render(<PromiseNode promise={promise} />);
    expect(plain.container.querySelector('.promise-node')?.getAttribute('data-selected')).toBe(
      'false',
    );
    plain.unmount();

    const chosen = render(<PromiseNode promise={promise} selected />);
    expect(chosen.container.querySelector('.promise-node')?.getAttribute('data-selected')).toBe(
      'true',
    );
    chosen.unmount();
  });

  it('registers its element on mount and releases it on unmount', () => {
    const promise = makePromise();
    const registry = new Map<string, HTMLElement | null>();
    const { unmount } = render(
      <PromiseNode
        promise={promise}
        registerElement={(id, element) => registry.set(id, element)}
      />,
    );

    expect(registry.get(promise.id), 'the graph was never handed an element to focus').toBeTruthy();
    unmount();
    expect(
      registry.get(promise.id),
      'a detached element left in the registry is a focus call into nothing',
    ).toBeNull();
  });
});

describe('LaneNode — the three lanes that are context rather than subjects', () => {
  it('names its kind in prose and its subject as an identifier', () => {
    for (const kind of ['document', 'test', 'evidence'] as const) {
      const { container, unmount } = render(<LaneNode kind={kind} name="apps/fixture/README.md" />);
      try {
        const chip = container.querySelector('.lane-node');
        expect(chip?.getAttribute('data-lane')).toBe(kind);
        expect(chip?.querySelector('.lane-node__kind')?.textContent).toBe(LANE_WORDS[kind]);
        expect(chip?.querySelector('.lane-node__name')?.textContent).toBe('apps/fixture/README.md');
        expect(chip?.querySelector('.lane-node__name')?.getAttribute('title')).toBe(
          'apps/fixture/README.md',
        );
      } finally {
        unmount();
      }
    }
  });

  it('is not a focus stop and not a button, because it activates nothing', () => {
    const { container, unmount } = render(<LaneNode kind="document" name="README.md" />);
    try {
      const chip = container.querySelector('.lane-node');
      expect(chip?.getAttribute('tabindex')).toBeNull();
      expect(chip?.getAttribute('role')).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe('PromiseNode — against the committed snapshot, not only a fixture', () => {
  it('renders every promise the repository actually states', () => {
    expect(snapshot.promises.length).toBeGreaterThan(0);
    for (const promise of snapshot.promises) {
      const { container, unmount } = render(<PromiseNode promise={promise} />);
      try {
        const text = container.textContent ?? '';
        expect(text).toContain(promise.id);
        expect(text).toContain(promise.claim);
        expect(text).toContain(citationLabel(promise.citation));
        expect(text).toContain(promise.verdict);
      } finally {
        unmount();
      }
    }
  });
});
