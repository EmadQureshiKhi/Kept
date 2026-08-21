/**
 * `/amendments`, rendered — design §8.3, §8.4, §8.5, §10.1, §10.8, §10.9, §10.10,
 * R7.3, R7.5, R8.4, R10.5, R10.7.
 *
 * Two halves.
 *
 * The **empty** half renders the route against the committed snapshot, which carries
 * `amendments: []` because nothing has been proposed against the fixture yet. That is the
 * live path today and the first thing a reader sees, so it is asserted to *state* the
 * fact and to name what would put an amendment there — §10.10 makes an empty state a
 * specified state, and a blank page here would read as a surface that does not work.
 *
 * The **populated** half renders a card against an amendment built here and parsed
 * through `SnapshotAmendmentSchema`, so the fixture cannot drift from the shape the
 * Ledger will actually be handed. What it checks is the set of things a judge reads off
 * this page and could not get anywhere else:
 *
 * - the diff, with the cited line's own number in the gutter (§10.9);
 * - the accept control's accessible name, spelled exactly as §10.8 spells it;
 * - the command, present as text rather than only on the clipboard (§8.5);
 * - **both promise ids** — the one this amendment retires and the one it creates —
 *   because accepting changes the claim and therefore the promise identity (§3.2), and a
 *   card showing one id would imply the verdict survives the edit;
 * - the sha256 interlock, in full and untruncated (§8.4 step 3).
 *
 * jsdom applies no stylesheet, so every assertion here is what a reader gets with colour
 * removed entirely. That is the honest test of R10.5 for a diff: the `-`/`+` markers and
 * the `removed`/`added` accessible names are in the DOM, not in the CSS.
 */

import { cleanup, render } from '@testing-library/react';
import type { SnapshotAmendment } from '@kept/core';
import { SnapshotAmendmentSchema, amendedPromiseId } from '@kept/core';
import { afterEach, describe, expect, it } from 'vitest';

import AmendmentsPage, { AMENDMENTS_EMPTY, amendmentOrder } from '../app/amendments/page.js';
import {
  ACCEPT_WORDS,
  AcceptControl,
  acceptCommand,
  acceptControlLabel,
  citedDocumentName,
} from '../components/AcceptControl.js';
import { AMENDMENT_WORDS, AmendmentCard } from '../components/AmendmentCard.js';
import { DIFF_WORDS, DiffView } from '../components/DiffView.js';
import { diffLines } from '../lib/diff.js';
import { snapshot } from '../lib/snapshot.js';

/** The ledger project shares one jsdom across suites, so unmount explicitly. */
afterEach(cleanup);

const README = 'apps/fixture/README.md';
const CURRENT =
  '- The Cart screen applies a 10 percent discount automatically when the subtotal ' +
  'exceeds 50 dollars.';
const PROPOSED = '- The Cart screen shows the order total with no automatic discounts.';

/** One amendment, through the strict schema the Ledger's own build parses with. */
function amendment(
  overrides: Partial<SnapshotAmendment> = {},
): SnapshotAmendment {
  return SnapshotAmendmentSchema.parse({
    id: 'am_3b9d21f0',
    createdAt: '2026-08-20T18:41:02.118Z',
    status: 'pending',
    promiseId: 'p_44ab90c1e7d2',
    citation: { file: README, line: 20, text: CURRENT },
    currentText: CURRENT,
    proposedText: PROPOSED,
    expectedSha256: '9e0c'.repeat(16),
    rationale:
      'Kane asserted the discount at subtotal 62.00 and observed no discount applied. The ' +
      'application implements no discount rule.',
    evidenceRef: 'evidence/ev_2026-08-20T18-40-11Z/failure.yaml',
    // Artefact values are **public** paths under `/evidence/`, which is what the
    // browser fetches; `evidenceRef` above is the repository-relative reference into
    // the committed pack. Two different path grammars, deliberately, and the strict
    // schema refuses one spelled as the other.
    artifacts: {
      annotated: '/evidence/ev_2026-08-20T18-40-11Z/annotated.png',
      screenshot: '/evidence/ev_2026-08-20T18-40-11Z/step-4.png',
    },
    strategy: 'resultCode740',
    appliedAt: null,
    ...overrides,
  });
}

/* ──────────────── the live path: the real docs-lie, staged (15.5) ──────────── */

describe('/amendments renders the amendment the committed snapshot carries', () => {
  it('shows the staged docs-lie as a pending card, one per amendment', () => {
    // Stage 15.5 proposed this off T-7's real red verdict. Until then the page had
    // only its empty state to render, and `AMENDMENTS_EMPTY` still says what would
    // put a card here in prose rather than shrugging.
    expect(snapshot.amendments).toHaveLength(1);
    expect(AMENDMENTS_EMPTY).toContain('docs-lie');

    const { container } = render(<AmendmentsPage />);
    expect(container.textContent).not.toContain(AMENDMENTS_EMPTY);
    expect(container.querySelectorAll('.amendment-card')).toHaveLength(1);
    const amendment = snapshot.amendments[0];
    expect(container.textContent).toContain(amendment?.id ?? 'no amendment');
    // The claim and the replacement, both verbatim, which is the whole card.
    expect(container.textContent).toContain(amendment?.proposedText ?? '');
    expect(container.textContent).toContain(
      `${amendment?.citation.file ?? ''}:${amendment?.citation.line ?? 0}`,
    );
    // The accept control names the command rather than performing it: the Ledger
    // still exposes no non-GET handler (§8.5, R8.4).
    expect(container.textContent).toContain(`kept amend accept ${amendment?.id ?? ''}`);
  });

  it('counts what it is showing, so the count is checkable against the list', () => {
    const { container } = render(<AmendmentsPage />);
    const pending = snapshot.amendments.filter((entry) => entry.status === 'pending').length;
    expect(container.textContent).toContain(
      `${snapshot.amendments.length} amendment${snapshot.amendments.length === 1 ? '' : 's'} ` +
        `on file, ${pending} pending`,
    );
    expect(container.textContent).toContain(snapshot.generatedAt);
  });
});

/* ─────────────────────────────── the diff (§10.9) ──────────────────────────── */

describe('DiffView renders the change with colour removed', () => {
  it('renders one deletion and one addition, each marked and named', () => {
    const { container } = render(
      <DiffView
        label="Proposed replacement for the cited line"
        rows={diffLines(CURRENT, PROPOSED, { firstLine: 20 })}
      />,
    );

    const rows = [...container.querySelectorAll('.diff-row')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-diff')).toBe('del');
    expect(rows[1]?.getAttribute('data-diff')).toBe('add');
    // The markers are text, so the diff survives the stylesheet being gone (R10.5).
    expect(rows[0]?.querySelector('.diff-marker')?.textContent).toBe('-');
    expect(rows[1]?.querySelector('.diff-marker')?.textContent).toBe('+');
    // And so do the words.
    expect(rows[0]?.getAttribute('aria-label')).toBe('removed line 20');
    expect(rows[1]?.getAttribute('aria-label')).toBe('added line 20');
  });

  it('quotes both texts verbatim', () => {
    const { container } = render(
      <DiffView label="d" rows={diffLines(CURRENT, PROPOSED, { firstLine: 20 })} />,
    );
    const texts = [...container.querySelectorAll('.diff-text')].map((node) => node.textContent);
    expect(texts).toEqual([CURRENT, PROPOSED]);
  });

  it('numbers the gutter with the cited line, on both sides', () => {
    const { container } = render(
      <DiffView label="d" rows={diffLines(CURRENT, PROPOSED, { firstLine: 20 })} />,
    );
    const first = [...(container.querySelector('.diff-row')?.querySelectorAll('.diff-gutter') ?? [])];
    expect(first.map((node) => node.textContent)).toEqual(['20', '']);
  });

  it('reads as cut into the card: the well, and no shadow of its own', () => {
    const { container } = render(<DiffView label="d" rows={diffLines('a', 'b')} />);
    const view = container.querySelector('.diff-view');
    expect(view?.classList.contains('surface-well')).toBe(true);
    expect(view?.getAttribute('style')).toBeNull();
  });

  it('says so when the proposal changes nothing', () => {
    const { container } = render(<DiffView label="d" rows={diffLines(CURRENT, CURRENT)} />);
    expect(container.textContent).toContain(DIFF_WORDS.unchanged);
    expect(container.querySelectorAll('.diff-row')).toHaveLength(0);
  });

  it('distinguishes an unchanged diff from one that was never rendered', () => {
    const { container } = render(<DiffView label="d" rows={[]} />);
    expect(container.textContent).toContain(DIFF_WORDS.absent);
  });
});

/* ───────────────────────── the accept control (§8.5, §10.8) ─────────────────── */

describe('AcceptControl is a keyboard-focusable button that copies a command', () => {
  it('carries the accessible name §10.8 specifies, verbatim', () => {
    expect(acceptControlLabel(amendment())).toBe(
      'Accept amendment am_3b9d21f0 for README line 20',
    );
  });

  it('names the cited document rather than calling everything a README', () => {
    expect(citedDocumentName('apps/fixture/README.md')).toBe('README');
    expect(citedDocumentName('docs/pricing.md')).toBe('pricing');
    expect(citedDocumentName('LICENSE')).toBe('LICENSE');
  });

  it('renders a native button, focusable with no tabindex trickery', () => {
    const { container } = render(<AcceptControl amendment={amendment()} />);
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('type')).toBe('button');
    // A native button is in the tab order by itself; an explicit tabindex here would
    // mean the element is not really a button (§10.8, R10.7).
    expect(button?.getAttribute('tabindex')).toBeNull();
    expect(button?.getAttribute('aria-label')).toBe(
      'Accept amendment am_3b9d21f0 for README line 20',
    );
    expect(button?.getAttribute('disabled')).toBeNull();
  });

  it('reveals the command inline, so the clipboard is an affordance and not the point', () => {
    const { container } = render(<AcceptControl amendment={amendment()} />);
    expect(container.querySelector('.accept-control__command')?.textContent).toBe(
      'kept amend accept am_3b9d21f0',
    );
    expect(acceptCommand('am_00000000')).toBe('kept amend accept am_00000000');
  });

  it('states in words what to do with the command, in a live region', () => {
    const { container } = render(<AcceptControl amendment={amendment()} />);
    const status = container.querySelector('.accept-control__status');
    expect(status?.textContent).toBe(ACCEPT_WORDS.hint);
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.getAttribute('aria-live')).toBe('polite');
  });

  it('exposes no form, no action and no method — the Ledger writes nothing (R8.4)', () => {
    const { container } = render(<AcceptControl amendment={amendment()} />);
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[formaction]')).toBeNull();
    expect(container.querySelector('a[href]')).toBeNull();
  });
});

/* ─────────────────────────────── one whole card ────────────────────────────── */

describe('AmendmentCard shows what a judge needs to check it', () => {
  it('quotes the citation as path:line and carries the card at elevation 2', () => {
    const { container } = render(<AmendmentCard amendment={amendment()} />);
    const card = container.querySelector('.amendment-card');
    expect(card?.classList.contains('surface-raised-2')).toBe(true);
    expect(container.textContent).toContain(`${README}:20`);
    // The DOM id is the amendment id, so /amendments#am_… reaches one card.
    expect(card?.getAttribute('id')).toBe('am_3b9d21f0');
  });

  it('links both ends of the identity change: the promise retired and the one created', () => {
    const record = amendment();
    const { container } = render(<AmendmentCard amendment={record} />);
    const successor = amendedPromiseId(record);

    expect(successor).not.toBe(record.promiseId);
    expect(container.textContent).toContain(AMENDMENT_WORDS.retires);
    expect(container.textContent).toContain(AMENDMENT_WORDS.creates);
    const hrefs = [...container.querySelectorAll('a')].map((node) => node.getAttribute('href'));
    expect(hrefs).toContain(`/?p=${record.promiseId}`);
    expect(hrefs).toContain(`/?p=${successor}`);
  });

  it('shows the sha256 interlock in full', () => {
    const record = amendment();
    const { container } = render(<AmendmentCard amendment={record} />);
    expect(container.textContent).toContain(record.expectedSha256);
    expect(record.expectedSha256).toHaveLength(64);
  });

  it('shows the rationale as prose, and the evidence reference beside it', () => {
    const record = amendment();
    const { container } = render(<AmendmentCard amendment={record} />);
    expect(container.textContent).toContain(record.rationale);
    expect(container.textContent).toContain(record.evidenceRef as string);
  });

  it('lists every artefact as a plain static link, sorted by label', () => {
    const { container } = render(<AmendmentCard amendment={amendment()} />);
    const artifacts = [...container.querySelectorAll('.amendment-card__artifact')];
    expect(artifacts.map((node) => node.getAttribute('href'))).toEqual([
      '/evidence/ev_2026-08-20T18-40-11Z/annotated.png',
      '/evidence/ev_2026-08-20T18-40-11Z/step-4.png',
    ]);
  });

  it('carries the accept control while pending', () => {
    const { container } = render(<AmendmentCard amendment={amendment()} />);
    expect(container.querySelector('.accept-control__button')).not.toBeNull();
  });

  it('withholds the control once the amendment is no longer pending, and says why', () => {
    for (const status of ['accepted', 'rejected'] as const) {
      const { container, unmount } = render(
        <AmendmentCard amendment={amendment({ status })} />,
      );
      expect(container.querySelector('.accept-control__button')).toBeNull();
      expect(container.textContent).toContain(AMENDMENT_WORDS.notPending);
      unmount();
    }
  });

  it('explains a stale amendment rather than offering a write that would refuse', () => {
    const { container } = render(<AmendmentCard amendment={amendment({ status: 'stale' })} />);
    expect(container.textContent).toContain(AMENDMENT_WORDS.stale);
    expect(container.querySelector('.accept-control__button')).toBeNull();
  });

  it('states an absent rationale and an absent artefact map rather than omitting them', () => {
    const { container } = render(
      <AmendmentCard amendment={amendment({ rationale: '', artifacts: {} })} />,
    );
    expect(container.textContent).toContain(AMENDMENT_WORDS.noRationale);
    expect(container.textContent).toContain(AMENDMENT_WORDS.noArtifacts);
  });
});

/* ──────────────────────────── the page, populated ──────────────────────────── */

describe('/amendments orders the work before the record', () => {
  it('puts a pending amendment above an accepted one, however old each is', () => {
    const order = amendmentOrder([
      amendment({
        id: 'am_22222222',
        status: 'accepted',
        createdAt: '2026-08-19T00:00:00.000Z',
        appliedAt: '2026-08-19T00:10:00.000Z',
      }),
      amendment({
        id: 'am_11111111',
        status: 'pending',
        createdAt: '2026-08-21T00:00:00.000Z',
      }),
    ]);
    expect(order.map((record) => record.id)).toEqual(['am_11111111', 'am_22222222']);
  });

  it('is deterministic within a group: createdAt, then id', () => {
    const order = amendmentOrder([
      amendment({ id: 'am_bbbbbbbb', createdAt: '2026-08-20T00:00:00.000Z' }),
      amendment({ id: 'am_aaaaaaaa', createdAt: '2026-08-20T00:00:00.000Z' }),
      amendment({ id: 'am_cccccccc', createdAt: '2026-08-19T00:00:00.000Z' }),
    ]);
    expect(order.map((record) => record.id)).toEqual([
      'am_cccccccc',
      'am_aaaaaaaa',
      'am_bbbbbbbb',
    ]);
    // The same input twice is the same order, so a screenshot is reproducible.
    expect(amendmentOrder(order).map((record) => record.id)).toEqual(
      order.map((record) => record.id),
    );
  });

  it('renders one card per amendment when the snapshot carries them', () => {
    const { container } = render(
      <ul>
        {amendmentOrder([amendment(), amendment({ id: 'am_11111111' })]).map((record) => (
          <li key={record.id}>
            <AmendmentCard amendment={record} />
          </li>
        ))}
      </ul>,
    );
    expect(container.querySelectorAll('.amendment-card')).toHaveLength(2);
    expect(container.querySelectorAll('.accept-control__button')).toHaveLength(2);
  });
});
