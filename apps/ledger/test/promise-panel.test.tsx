/**
 * `PromisePanel`, rendered — task 9.6, design §10.2, §10.5, §10.7, §10.10, R8.2,
 * R8.3, R10.7.
 *
 * The panel is the surface that makes a claim checkable, so this suite is organised
 * the way a sceptic reads it: the claim in full, the cited line **verbatim**, the
 * designed test, the verdict's source, the repair annotation, and the evidence
 * artefacts as plain links.
 *
 * Two assertions here carry more weight than the rest.
 *
 * **The quote is bytes.** `citation.text` is the line the admission gate read off disk
 * (R1.3), and the panel renders it with no trimming and no normalisation. So the test
 * feeds it leading space, trailing space, an inner run of spaces and a tab, and
 * requires all of them back. A ledger that tidied the line it quotes could not be
 * checked against the file, and that verbatim quality is the product's whole
 * credibility claim — which makes it worth a character-exact assertion rather than a
 * `toContain`.
 *
 * **Absence is stated, never omitted.** The committed snapshot is mixed now: seven of
 * its thirteen promises are `proven` with a run behind them, one is `red`, and the five
 * cited to this repository's own README are `stale` with no verdict source and no
 * evidence pack at all. So both the populated and the empty paths are live on the same
 * page, and the last block of this file walks every committed promise and requires
 * whichever one applies. The empty paths are asserted against the words in
 * `PANEL_WORDS` rather than against structure, because an empty section that stopped
 * explaining itself would still satisfy a structural assertion and would silently
 * become the blank §10.10 forbids.
 */

import { cleanup, render } from '@testing-library/react';
import type { SnapshotEvidence, SnapshotPromise } from 'kept-core';
import { SnapshotEvidenceSchema, SnapshotPromiseSchema } from 'kept-core';
import { afterEach, describe, expect, it } from 'vitest';

import { PANEL_WORDS, PromisePanel } from '../components/PromisePanel.js';
import { citationLabel, designedTestLabel } from '../lib/citation.js';
import { snapshot } from '../lib/snapshot.js';

afterEach(cleanup);

const CLAIM = 'The Settings screen keeps the selected currency after a full page reload.';

function makePromise(overrides: Partial<SnapshotPromise> = {}): SnapshotPromise {
  return SnapshotPromiseSchema.parse({
    id: 'p_177308118beb',
    claim: CLAIM,
    citation: { file: 'apps/fixture/README.md', line: 19, text: `- ${CLAIM}` },
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

function makeEvidence(overrides: Partial<SnapshotEvidence> = {}): SnapshotEvidence {
  return SnapshotEvidenceSchema.parse({
    id: 'ev_9f21c4a0',
    kind: 'testrun',
    sealedAt: '2026-08-20T16:17:09.800Z',
    publicPath: '/evidence/ev_9f21c4a0/',
    artifacts: [
      {
        kind: 'annotated',
        name: 'annotated.png',
        publicPath: '/evidence/ev_9f21c4a0/annotated.png',
        bytes: 40_112,
      },
      {
        kind: 'failure-yaml',
        name: 'failure.yaml',
        publicPath: '/evidence/ev_9f21c4a0/failure.yaml',
        bytes: 1_204,
      },
    ],
    ...overrides,
  });
}

describe('PromisePanel — what was promised, and where it is written', () => {
  it('names the promise, the claim in full and the citation', () => {
    const promise = makePromise();
    const { container, unmount } = render(<PromisePanel promise={promise} />);
    try {
      const panel = container.querySelector(`[data-promise-panel="${promise.id}"]`);
      expect(panel).not.toBeNull();
      expect(panel?.querySelector('.promise-panel__id')?.textContent).toBe(promise.id);
      expect(panel?.querySelector('.promise-panel__claim')?.textContent).toBe(promise.claim);
      expect(panel?.querySelector('.verdict-tag')?.textContent).toBe(promise.verdict);
      expect(container.textContent).toContain(citationLabel(promise.citation));
    } finally {
      unmount();
    }
  });

  it('is labelled by its claim, so the panel announces its subject', () => {
    const promise = makePromise();
    const { container, unmount } = render(<PromisePanel promise={promise} />);
    try {
      const panel = container.querySelector('.promise-panel');
      const labelledBy = panel?.getAttribute('aria-labelledby');
      expect(labelledBy).toBe(`${promise.id}-claim`);
      expect(
        container.ownerDocument.getElementById(labelledBy ?? '')?.textContent,
        'aria-labelledby points at nothing, so the panel has no accessible name',
      ).toBe(promise.claim);
    } finally {
      unmount();
    }
  });

  it('quotes the cited line byte for byte, inside the well (§10.5, R1.3)', () => {
    /* leading space, an inner run, a tab and a trailing space — all of them survive */
    const text = '  - The Settings screen  keeps\tthe selected currency. ';
    const promise = makePromise({
      citation: { file: 'apps/fixture/README.md', line: 19, text },
    });
    const { container, unmount } = render(<PromisePanel promise={promise} />);
    try {
      const well = container.querySelector('.promise-panel__well');
      expect(well?.classList.contains('surface-well'), 'the quote is not cut into the panel').toBe(
        true,
      );

      const quote = well?.querySelector('.promise-panel__quote');
      expect(
        quote?.textContent,
        'the quote was normalised; a reformatted citation cannot be checked against the file',
      ).toBe(text);
      expect(quote?.getAttribute('cite')).toBe(promise.citation.file);
    } finally {
      unmount();
    }
  });

  it('sits at elevation 2, the level §10.5 reserves for the panel', () => {
    const { container, unmount } = render(<PromisePanel promise={makePromise()} />);
    try {
      expect(container.querySelector('.promise-panel')?.classList.contains('surface-raised-2')).toBe(
        true,
      );
    } finally {
      unmount();
    }
  });

  it('is a panel and not a dialog, so the graph beside it stays operable (§10.8)', () => {
    const { container, unmount } = render(<PromisePanel promise={makePromise()} />);
    try {
      const panel = container.querySelector('.promise-panel');
      expect(panel?.tagName).toBe('ASIDE');
      expect(panel?.getAttribute('role')).toBeNull();
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe('PromisePanel — what would prove it, and what the last run said', () => {
  it('spells the designed test the way lib/citation.ts does', () => {
    const promise = makePromise();
    const { container, unmount } = render(<PromisePanel promise={promise} />);
    try {
      expect(container.textContent).toContain(designedTestLabel(promise.designedTest) ?? '');
      expect(container.textContent).toContain('tests/settings_currency_test.md');
      expect(container.textContent).toContain('T-6');
    } finally {
      unmount();
    }
  });

  it('reports the terminal event behind a verdict when there is one', () => {
    const promise = makePromise({
      verdict: 'red',
      verdictSource: {
        runId: 'tr_20260820T184011Z',
        terminalEventType: 'testrun_done',
        at: '2026-08-20T18:40:11.000Z',
        memberStatus: 'failed',
        resultCode: 740,
        reasonCode: 'failure.product_bug',
      },
      credits: 12,
    });
    const { container, unmount } = render(<PromisePanel promise={promise} />);
    try {
      const text = container.textContent ?? '';
      for (const fact of [
        'tr_20260820T184011Z',
        'testrun_done',
        '2026-08-20T18:40:11.000Z',
        'failed',
        '740',
        'failure.product_bug',
        '12',
      ]) {
        expect(text, `the panel does not report ${fact}`).toContain(fact);
      }
      expect(text).not.toContain(PANEL_WORDS.noVerdictSource);
    } finally {
      unmount();
    }
  });

  it('annotates the repair when the branch was decided, and omits the section otherwise', () => {
    const withRepair = render(
      <PromisePanel
        promise={makePromise({
          verdict: 'red',
          repair: {
            branch: 'docs-lie',
            strategy: 'failureYamlTriage',
            severity: 'medium',
            category: 'documentation',
            confidence: 0.82,
            evidenceRef: 'evidence/ev_9f21c4a0/failure.yaml',
            rationale: 'The README states a behaviour the product never had, so the document moves.',
          },
        })}
      />,
    );
    const text = withRepair.container.textContent ?? '';
    expect(text).toContain(PANEL_WORDS.repair);
    expect(text).toContain('docs-lie');
    expect(text).toContain('failureYamlTriage');
    expect(text).toContain('0.82');
    expect(text).toContain('The README states a behaviour the product never had');
    withRepair.unmount();

    const without = render(<PromisePanel promise={makePromise({ repair: null })} />);
    expect(
      without.container.textContent,
      'a promise with no repair branch must not grow an empty repair heading',
    ).not.toContain(PANEL_WORDS.repair);
    without.unmount();
  });
});

describe('PromisePanel — evidence, and the three ways there can be none (§10.10)', () => {
  it('links every artefact the pack carries, by its public path', () => {
    const evidence = makeEvidence();
    const { container, unmount } = render(
      <PromisePanel
        evidence={evidence}
        promise={makePromise({ evidencePackId: evidence.id })}
      />,
    );
    try {
      expect(container.textContent).toContain(evidence.id);
      const links = [...container.querySelectorAll<HTMLAnchorElement>('.promise-panel__artifact')];
      expect(links).toHaveLength(evidence.artifacts.length);
      for (const artifact of evidence.artifacts) {
        const link = links.find((candidate) => candidate.textContent === artifact.name);
        expect(link, `no link for ${artifact.name}`).toBeDefined();
        expect(link?.getAttribute('href')).toBe(artifact.publicPath);
        expect(container.textContent).toContain(artifact.kind);
      }
      expect(container.textContent).not.toContain(PANEL_WORDS.noEvidence);
    } finally {
      unmount();
    }
  });

  it('says in words that no pack has been sealed, rather than showing an empty heading', () => {
    const { container, unmount } = render(
      <PromisePanel evidence={null} promise={makePromise({ evidencePackId: null })} />,
    );
    try {
      expect(container.textContent).toContain(PANEL_WORDS.noEvidence);
      expect(container.querySelectorAll('.promise-panel__artifact')).toHaveLength(0);
    } finally {
      unmount();
    }
  });

  it('tells a pack with no artefacts apart from a pack that does not exist', () => {
    const evidence = makeEvidence({ artifacts: [] });
    const { container, unmount } = render(
      <PromisePanel evidence={evidence} promise={makePromise({ evidencePackId: evidence.id })} />,
    );
    try {
      const text = container.textContent ?? '';
      expect(text).toContain(evidence.id);
      expect(text).toContain(PANEL_WORDS.noArtifacts);
      expect(
        text,
        '"no pack" and "an empty pack" are different facts and must not read the same',
      ).not.toContain(PANEL_WORDS.noEvidence);
    } finally {
      unmount();
    }
  });

  it('states suite debt in words when no test was designed (R5.8)', () => {
    const { container, unmount } = render(
      <PromisePanel promise={makePromise({ verdict: 'undesigned', designedTest: null })} />,
    );
    try {
      expect(container.textContent).toContain(PANEL_WORDS.noDesignedTest);
    } finally {
      unmount();
    }
  });
});

describe('PromisePanel — the way out (§10.8)', () => {
  it('offers a close button whose accessible name says what it closes', () => {
    const promise = makePromise();
    let closed = 0;
    const { container, unmount } = render(
      <PromisePanel onClose={() => (closed += 1)} promise={promise} />,
    );
    try {
      const close = container.querySelector<HTMLButtonElement>('.promise-panel__close');
      expect(close).not.toBeNull();
      expect(close?.getAttribute('type')).toBe('button');
      expect(close?.getAttribute('aria-label')).toBe(`Close detail for promise ${promise.id}`);
      close?.click();
      expect(closed).toBe(1);
    } finally {
      unmount();
    }
  });

  it('renders no close control when the caller owns closing another way', () => {
    const { container, unmount } = render(<PromisePanel promise={makePromise()} />);
    try {
      expect(container.querySelector('.promise-panel__close')).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe('PromisePanel — against the committed snapshot, verdicts and all', () => {
  it('renders every promise with the run that verified it, and says why nothing is sealed', () => {
    // The snapshot has verdicts *and* curated evidence now, and the two cases have
    // to render differently: a promise whose pack was curated shows real artefact
    // links, and one whose pack was not shows the sentence explaining the absence.
    // Which promises fall on which side moves with what the last verification
    // sealed, so the panel is asserted against each promise's own state rather than
    // against a snapshot that is assumed to be empty.
    for (const promise of snapshot.promises) {
      const pack =
        promise.evidencePackId === null
          ? null
          : (snapshot.evidence.find((entry) => entry.id === promise.evidencePackId) ?? null);
      const { container, unmount } = render(<PromisePanel evidence={pack} promise={promise} />);
      try {
        const text = container.textContent ?? '';
        expect(text).toContain(promise.claim);
        expect(text).toContain(promise.citation.text);
        expect(text).toContain(promise.verdict);
        if (pack === null) {
          // No pack: the panel says so in words rather than rendering nothing.
          expect(text).toContain(PANEL_WORDS.noEvidence);
        } else {
          // A pack: every artefact it lists is linked, and the explanation is gone.
          expect(text).not.toContain(PANEL_WORDS.noEvidence);
          const hrefs = [...container.querySelectorAll('a[href]')].map((a) =>
            a.getAttribute('href'),
          );
          expect(hrefs.length).toBeGreaterThan(0);
          for (const artifact of pack.artifacts) {
            expect(hrefs).toContain(artifact.publicPath);
          }
        }

        const source = promise.verdictSource;
        if (source === null) {
          // A promise no run has touched. Since task 26.1 the committed snapshot
          // carries five of them: the claims cited to this repository's own README,
          // designed by a corpus document Kane has never been paid to author, so they
          // are `stale` with nothing to attribute. The panel says that in words rather
          // than rendering an empty provenance block, which is the whole reason
          // `PANEL_WORDS.noVerdictSource` exists.
          expect(promise.verdict).toBe('stale');
          expect(text).toContain(PANEL_WORDS.noVerdictSource);
          continue;
        }
        expect(text).not.toContain(PANEL_WORDS.noVerdictSource);
        expect(text).toContain(source.runId);
        expect(text).toContain(source.terminalEventType);
        expect(text).toContain(source.at);
        if (source.memberStatus !== null) expect(text).toContain(source.memberStatus);
      } finally {
        unmount();
      }
    }
  });
});
