/**
 * `/reviews`, rendered — design §8.1, §8.2, §10.1, §10.9, §10.10, R5.7, R7.2, R7.7,
 * R8.4.
 *
 * R7.7 is the requirement this file exists to hold: every review card must render its
 * originating **promise identifier**, its **repair branch**, and its **Kane evidence
 * reference**. Those three are asserted as DOM text, individually, because they are the
 * three things that make a held change traceable and because "the card renders" is true
 * of a card that shows none of them.
 *
 * The second thing asserted here is an **absence**. §8.1 gives this branch autonomy
 * `hold`, R5.7 says nothing reconciliation or evolution produces is ever applied, and
 * R8.4 forbids the Ledger any mutating surface — so this page must carry no accept
 * control, no button, and no form. That is easy to regress by copying `/amendments`, and
 * a control here would advertise an autonomy the design withholds. So it is a test rather
 * than a comment.
 *
 * The cards used are built through `SnapshotReviewCardSchema`, so the fixtures cannot
 * drift from the shape the Ledger is actually handed. Both kinds are covered — a
 * `reconcile` card with a rendered patch, and the `test-drift` card `kept evolve` writes
 * when it could not invoke `maintain evolve` at all, which legitimately carries an empty
 * `proposedChanges` list and must say so rather than look broken.
 */

import { cleanup, render } from '@testing-library/react';
import type { SnapshotReviewCard } from '@kept/core';
import { SnapshotReviewCardSchema } from '@kept/core';
import { afterEach, describe, expect, it } from 'vitest';

import ReviewsPage, { REVIEWS_EMPTY, reviewOrder } from '../app/reviews/page.js';
import { REVIEW_WORDS, ReviewCardView } from '../components/ReviewCardView.js';
import { snapshot } from '../lib/snapshot.js';

/** The ledger project shares one jsdom across suites, so unmount explicitly. */
afterEach(cleanup);

const PATCH = '-  click .total\n+  click .cart-total';

/** One card, through the strict schema the Ledger's own build parses with. */
function card(overrides: Partial<SnapshotReviewCard> = {}): SnapshotReviewCard {
  return SnapshotReviewCardSchema.parse({
    id: 'rc_7c1e04a9',
    createdAt: '2026-08-20T18:41:02.118Z',
    kind: 'test-drift',
    promiseId: 'p_9f2c1a4b7d33',
    branch: 'test-drift',
    title: 'cart_subtotal_test.md step 3 selector no longer resolves',
    detail: 'The cart total moved behind a new wrapper element, so the step 3 selector misses.',
    proposedChanges: [
      {
        file: 'tests/cart_subtotal_test.md',
        summary: 'retarget step 3 at the new wrapper',
        diff: PATCH,
      },
    ],
    evidenceRef: 'evidence/ev_2026-08-20T18-40-11Z/failure.yaml',
    strategy: 'resultCode740',
    status: 'open',
    ...overrides,
  });
}

/* ────────────────────────── the live path: nothing held ────────────────────── */

describe('/reviews states the empty case rather than showing a blank', () => {
  it('renders the committed snapshot, which holds no card yet', () => {
    expect(snapshot.reviewCards).toEqual([]);
    const { container } = render(<ReviewsPage />);
    expect(container.textContent).toContain(REVIEWS_EMPTY);
    expect(container.querySelectorAll('.review-card')).toHaveLength(0);
  });

  it('counts what it is showing, against the instant it measured', () => {
    const { container } = render(<ReviewsPage />);
    expect(container.textContent).toContain('0 review cards on file, 0 open');
    expect(container.textContent).toContain(snapshot.generatedAt);
  });

  it('states the autonomy rule in the lede, so the missing control is explained', () => {
    const { container } = render(<ReviewsPage />);
    expect(container.textContent).toContain('The Ledger writes nothing');
  });
});

/* ───────────────────────── the three fields R7.7 names ─────────────────────── */

describe('ReviewCardView renders the promise id, the branch and the evidence ref', () => {
  it('renders all three, each as its own labelled fact', () => {
    const record = card();
    const { container } = render(<ReviewCardView card={record} />);

    const terms = [...container.querySelectorAll('.review-card__term')].map(
      (node) => node.textContent,
    );
    const values = [...container.querySelectorAll('.review-card__value')].map(
      (node) => node.textContent,
    );

    expect(terms).toContain(REVIEW_WORDS.promise);
    expect(terms).toContain(REVIEW_WORDS.branch);
    expect(terms).toContain(REVIEW_WORDS.evidence);
    expect(values).toContain(record.promiseId);
    expect(values).toContain(record.branch);
    expect(values).toContain(record.evidenceRef);
  });

  it('links the promise back to the graph it came from', () => {
    const record = card();
    const { container } = render(<ReviewCardView card={record} />);
    expect(
      [...container.querySelectorAll('a')].map((node) => node.getAttribute('href')),
    ).toContain(`/?p=${record.promiseId}`);
  });

  it('shows kind beside branch, because they answer different questions (§8.2)', () => {
    const { container } = render(<ReviewCardView card={card({ kind: 'reconcile' })} />);
    const article = container.querySelector('.review-card');
    expect(article?.getAttribute('data-kind')).toBe('reconcile');
    expect(article?.getAttribute('data-branch')).toBe('test-drift');
  });

  it('states an absent evidence reference rather than omitting the section', () => {
    const { container } = render(<ReviewCardView card={card({ evidenceRef: null })} />);
    expect(container.textContent).toContain(REVIEW_WORDS.noEvidence);
  });
});

/* ─────────────────────────── the held change itself ────────────────────────── */

describe('ReviewCardView renders each held change as a diff', () => {
  it('renders Kane\u2019s own patch as marked rows', () => {
    const { container } = render(<ReviewCardView card={card()} />);
    const rows = [...container.querySelectorAll('.diff-row')];
    expect(rows.map((node) => node.getAttribute('data-diff'))).toEqual(['del', 'add']);
    expect(rows[0]?.querySelector('.diff-text')?.textContent).toBe('  click .total');
    expect(rows[1]?.querySelector('.diff-text')?.textContent).toBe('  click .cart-total');
  });

  it('names the changed file and quotes the summary', () => {
    const { container } = render(<ReviewCardView card={card()} />);
    expect(container.textContent).toContain('tests/cart_subtotal_test.md');
    expect(container.textContent).toContain('retarget step 3 at the new wrapper');
  });

  it('states the evolve degradation card honestly: a drift with no proposed change', () => {
    // The card `kept evolve` writes when `maintain evolve` carries no --mode agent.
    const { container } = render(
      <ReviewCardView
        card={card({
          title: 'Test drift held for tests/cart_subtotal_test.md',
          proposedChanges: [],
        })}
      />,
    );
    expect(container.textContent).toContain(REVIEW_WORDS.noChanges);
    expect(container.querySelectorAll('.diff-row')).toHaveLength(0);
  });

  it('says the change is held, on every card', () => {
    const { container } = render(<ReviewCardView card={card()} />);
    expect(container.textContent).toContain(REVIEW_WORDS.held);
  });

  it('states an absent detail rather than leaving an empty paragraph', () => {
    const { container } = render(<ReviewCardView card={card({ detail: '' })} />);
    expect(container.textContent).toContain(REVIEW_WORDS.noDetail);
  });
});

/* ──────────────────── the absence that is the requirement ──────────────────── */

describe('/reviews exposes nothing that could apply a change', () => {
  it('renders no button, no form and no accept control on a card', () => {
    const { container } = render(<ReviewCardView card={card()} />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('.accept-control')).toBeNull();
    expect(container.querySelector('[formaction]')).toBeNull();
  });

  it('renders no button anywhere on the page either', () => {
    const { container } = render(<ReviewsPage />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
  });

  it('carries only the two statuses §8.2 declares, and never an applied one', () => {
    for (const status of ['open', 'dismissed'] as const) {
      const { container, unmount } = render(<ReviewCardView card={card({ status })} />);
      expect(container.querySelector('.review-card__status')?.textContent).toBe(status);
      unmount();
    }
  });
});

/* ───────────────────────────────── ordering ────────────────────────────────── */

describe('/reviews orders the outstanding work first', () => {
  it('puts an open card above a dismissed one, however old each is', () => {
    const order = reviewOrder([
      card({ id: 'rc_dismissed', status: 'dismissed', createdAt: '2026-08-19T00:00:00.000Z' }),
      card({ id: 'rc_open', status: 'open', createdAt: '2026-08-21T00:00:00.000Z' }),
    ]);
    expect(order.map((entry) => entry.id)).toEqual(['rc_open', 'rc_dismissed']);
  });

  it('is deterministic within a group: createdAt, then id', () => {
    const order = reviewOrder([
      card({ id: 'rc_bbbb', createdAt: '2026-08-20T00:00:00.000Z' }),
      card({ id: 'rc_aaaa', createdAt: '2026-08-20T00:00:00.000Z' }),
      card({ id: 'rc_cccc', createdAt: '2026-08-19T00:00:00.000Z' }),
    ]);
    expect(order.map((entry) => entry.id)).toEqual(['rc_cccc', 'rc_aaaa', 'rc_bbbb']);
    expect(reviewOrder(order).map((entry) => entry.id)).toEqual(order.map((entry) => entry.id));
  });

  it('renders one card per held change when the snapshot carries them', () => {
    const { container } = render(
      <ul>
        {reviewOrder([card(), card({ id: 'rc_00000000' })]).map((entry) => (
          <li key={entry.id}>
            <ReviewCardView card={entry} />
          </li>
        ))}
      </ul>,
    );
    expect(container.querySelectorAll('.review-card')).toHaveLength(2);
  });
});
