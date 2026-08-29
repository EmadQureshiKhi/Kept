/**
 * The guided answer to "why is this red?". Design §8.1, §8.3, §10.2, §10.9, R7.3, R8.2, R8.3.
 *
 * This product's strongest argument is a chain of five facts, and until now a reader had to know
 * to click four separate things in the right order to follow it: open the promise, read the
 * citation, find the evidence pack, notice the repair annotation, then navigate to another route
 * to see the amendment. Every one of those facts was already on the site. None of them was a
 * sequence.
 *
 * This module turns the chain into one, as arithmetic over the committed snapshot:
 *
 *   1. **the claim** the documentation states, quoted byte for byte from the file and line;
 *   2. **the test** designed to prove it, which is what makes it a promise rather than a boast;
 *   3. **the evidence** a run sealed, so the failure is a committed artefact and not a report;
 *   4. **the branch the router chose**, in the verification tool's own words, which is the step
 *      no other tool has: it does not say "a test failed", it says *which of the three things is
 *      wrong*;
 *   5. **the replacement proposed**, unapplied, with the command that would apply it.
 *
 * ## It builds steps out of what exists, and never a step out of nothing
 *
 * A promise with no designed test, no evidence, no repair annotation or no amendment gets fewer
 * steps rather than a step reading "none". A walkthrough that padded itself to five would teach a
 * reader that a step can be empty, and then the empty ones stop being read. So the length of the
 * sequence is itself a fact about the promise.
 *
 * ## Each step carries its own instant, and that is not decoration
 *
 * The committed snapshot holds a `code-break` verdict from 26 August and a documentation
 * amendment proposed on 21 August, both about the same line of the same file. Shown back to back
 * with no dates they read as the router contradicting itself: step four says the code is wrong
 * and step five offers to edit the documentation. They are two moments, not one decision, and
 * {@link walkthroughSteps} says so in {@link WalkthroughStep.caveat} rather than leaving a reader
 * to notice the contradiction and distrust both.
 *
 * That is the whole reason this is a pure module with its own tests. The sequence is an argument,
 * and an argument with a hole in it is worse than four separate pages.
 *
 * ## One rendered shape
 *
 * Every step is the same record: a heading, a sentence saying what the step is for, an optional
 * verbatim quote, an optional image, a list of `term`/`value` facts, an optional link out, and an
 * optional caveat. So `Walkthrough.tsx` renders one thing five times and decides nothing, which
 * is what keeps the copy reviewable in one file and the component free of the argument.
 *
 * Pure and DOM-free, so it is checked under the repository's no-DOM `lib` program.
 */

import type { LedgerSnapshot, SnapshotAmendment, SnapshotPromise } from 'kept-core';

import { viewableArtifacts } from './evidenceView.js';

/** The five links of the chain, in the order a sceptic asks about them. */
export type WalkthroughStepKind = 'claim' | 'test' | 'evidence' | 'router' | 'amendment';

/** One `term`/`value` row of a step's fact list. */
export interface WalkthroughFact {
  readonly term: string;
  readonly value: string;
}

/** One step of the sequence, in the one shape the renderer knows. */
export interface WalkthroughStep {
  readonly kind: WalkthroughStepKind;
  /** The step's own short name, shown in the rail and in the heading. */
  readonly heading: string;
  /** One sentence saying what this step is for, and why it is in the chain. */
  readonly lede: string;
  /** Bytes to show verbatim in a recessed well, or null. Never trimmed. */
  readonly quote: string | null;
  /** A public path to a committed image, or null. */
  readonly image: string | null;
  /** The checkable facts, in mono. */
  readonly facts: readonly WalkthroughFact[];
  /** Where a reader goes to see this step's own surface in full, or null. */
  readonly link: { readonly href: string; readonly words: string } | null;
  /** The instant this fact was recorded, or null when the record carries none. */
  readonly at: string | null;
  /** Something the reader has to be told or the step misleads them. Usually null. */
  readonly caveat: string | null;
}

/** The words each step is named by. Exported so the rail and the tests read one spelling. */
export const STEP_HEADINGS: Readonly<Record<WalkthroughStepKind, string>> = {
  claim: 'the claim',
  test: 'the designed test',
  evidence: 'the evidence',
  router: 'the decision',
  amendment: 'the proposal',
};

/** The sentence each step opens with. The argument lives here, so it lives in one file. */
export const STEP_LEDES: Readonly<Record<WalkthroughStepKind, string>> = {
  claim:
    'A promise enters this ledger by being cited to a file and a line. This is the sentence the ' +
    'documentation states, quoted off disk byte for byte, so it can be checked against the file ' +
    'rather than taken on trust.',
  test:
    'A claim nobody wrote a test for is an assertion, not a promise. This is the test document ' +
    'bound to the claim above, and the identifier the assurance graph knows it by.',
  evidence:
    'The run that reached its terminal event sealed an evidence pack, and the pack is committed ' +
    'to this repository. So the artefact below is the same artefact on every machine, and it is ' +
    'what the run recorded rather than what it reported.',
  router:
    'Three things can be wrong when a promise is not kept: the code, the test, or the ' +
    'documentation. Every other tool stops at "a test failed". This is the branch KEPT settled ' +
    'on, in the verification tool\u2019s own words, with the confidence it reported.',
  amendment:
    'Nothing here has been applied. This branch is never silent, so KEPT proposes and a human ' +
    'accepts: below is the exact replacement recorded for the cited line, and acceptance is a ' +
    'command run against the repository rather than a button on this page.',
};

/** What the last step says when the sequence found nothing wrong to explain. */
export const NOTHING_TO_EXPLAIN =
  'This promise is kept, so there is no failure to walk through. The chain below is the same ' +
  'chain a broken promise has, ending at the run that proved it rather than at a repair.';

/** The word the trigger carries. A question, because that is what a reader is asking. */
export const WALKTHROUGH_TRIGGER = 'why is this red?';

/** The trigger's word when the promise is not red, so the button never asks a false question. */
export const WALKTHROUGH_TRIGGER_KEPT = 'walk through this promise';

/** The trigger's accessible name, which has to name the promise as well as the action. */
export function walkthroughTriggerLabel(promise: SnapshotPromise): string {
  return `Walk through the verification chain for promise ${promise.id}`;
}

/** `true` when a promise has enough of a chain to be worth walking. */
export function hasWalkthrough(snapshot: LedgerSnapshot, promiseId: string): boolean {
  return walkthroughSteps(snapshot, promiseId).length > 1;
}

/**
 * The amendment recorded against a promise, or null.
 *
 * Matched on `promiseId` rather than on the citation, because two claims can share a line and an
 * amendment names the promise it retires. Pending first, so a reader is shown the decision that
 * is still waiting on them rather than a record of one already settled.
 */
export function amendmentFor(
  snapshot: LedgerSnapshot,
  promiseId: string,
): SnapshotAmendment | null {
  const matching = snapshot.amendments.filter((entry) => entry.promiseId === promiseId);
  return matching.find((entry) => entry.status === 'pending') ?? matching[0] ?? null;
}

/**
 * The sentence that keeps steps four and five from reading as a contradiction.
 *
 * The committed snapshot carries a `code-break` verdict from 26 August and a documentation
 * amendment proposed on 21 August, about the same line. Step four says the code is wrong and step
 * five offers to edit the documentation, and back to back with no dates that is a tool arguing
 * with itself. It is two moments. Returning null when the amendment came *after* the verdict is
 * deliberate: then the two really are one decision and a caveat would invent a problem.
 */
export function orderCaveat(decidedAt: string | null, proposedAt: string): string | null {
  if (decidedAt === null || proposedAt >= decidedAt) return null;
  return (
    `These are two moments rather than one decision. This replacement was proposed at ` +
    `${proposedAt}, and the verdict in the previous step was recorded later, at ${decidedAt}. So ` +
    `the documentation amendment is the older record: it was proposed against an earlier run, and ` +
    `the most recent run concluded the code is at fault. Both are on file, neither has been ` +
    `applied, and a human decides which is right.`
  );
}

/** `path:line`, the one spelling of a citation. */
function citationLabel(citation: { readonly file: string; readonly line: number }): string {
  return `${citation.file}:${String(citation.line)}`;
}

/**
 * The chain for one promise, in order, with no step invented.
 *
 * An empty array means the snapshot carries no such promise. One step means the claim exists and
 * nothing else does, which is a true and uninteresting thing to say, so {@link hasWalkthrough}
 * requires more than one before offering the sequence at all.
 */
export function walkthroughSteps(
  snapshot: LedgerSnapshot,
  promiseId: string,
): readonly WalkthroughStep[] {
  const promise = snapshot.promises.find((entry) => entry.id === promiseId) ?? null;
  if (promise === null) return [];

  const steps: WalkthroughStep[] = [];

  /* 1. The claim, quoted off disk. `citation.text` is what the admission gate read (R1.3), so it
        is rendered untrimmed: leading and trailing space are part of the document. */
  steps.push({
    kind: 'claim',
    heading: STEP_HEADINGS.claim,
    lede: STEP_LEDES.claim,
    quote: promise.citation.text,
    image: null,
    facts: [
      { term: 'promise', value: promise.id },
      { term: 'cited', value: citationLabel(promise.citation) },
      { term: 'verdict', value: promise.verdict },
    ],
    link: null,
    at: null,
    caveat: null,
  });

  /* 2. The designed test. Omitted rather than stated as absent: a promise with no test is suite
        debt the coverage rail already counts, and a step saying "none" is a step nobody reads. */
  if (promise.designedTest !== null) {
    const facts: WalkthroughFact[] = [{ term: 'document', value: promise.designedTest.path }];
    if (promise.designedTest.testId !== null) {
      facts.push({ term: 'test_id', value: promise.designedTest.testId });
    }
    steps.push({
      kind: 'test',
      heading: STEP_HEADINGS.test,
      lede: STEP_LEDES.test,
      quote: null,
      image: null,
      facts,
      link: null,
      at: null,
      caveat: null,
    });
  }

  /* 3. The evidence. The first viewable capture is shown, because a reader asking why a promise is
        red wants to see the failure rather than read a manifest of it. The count says how much
        else is in the pack, and the panel behind this sequence lists all of it. */
  const pack =
    promise.evidencePackId === null
      ? null
      : snapshot.evidence.find((entry) => entry.id === promise.evidencePackId) ?? null;
  if (pack !== null) {
    const viewable = viewableArtifacts(pack.artifacts);
    steps.push({
      kind: 'evidence',
      heading: STEP_HEADINGS.evidence,
      lede: STEP_LEDES.evidence,
      quote: null,
      image: viewable[0]?.publicPath ?? null,
      facts: [
        { term: 'pack', value: pack.id },
        { term: 'artefacts', value: String(pack.artifacts.length) },
        { term: 'sealed', value: pack.sealedAt ?? 'not reported' },
      ],
      link: null,
      at: pack.sealedAt,
      caveat: null,
    });
  }

  /* 4. The router's decision, quoted. `rationale` carries Kane's own sentence about what it saw,
        which is the one piece of prose on the site this repository did not write. */
  const repair = promise.repair;
  const decidedAt = promise.verdictSource?.at ?? null;
  if (repair !== null) {
    const facts: WalkthroughFact[] = [{ term: 'branch', value: repair.branch }];
    if (repair.severity !== null) facts.push({ term: 'severity', value: repair.severity });
    if (repair.category !== null) facts.push({ term: 'category', value: repair.category });
    if (repair.confidence !== null) {
      facts.push({ term: 'confidence', value: String(repair.confidence) });
    }
    if (repair.strategy !== null) facts.push({ term: 'strategy', value: repair.strategy });
    if (decidedAt !== null) facts.push({ term: 'decided', value: decidedAt });
    steps.push({
      kind: 'router',
      heading: STEP_HEADINGS.router,
      lede: STEP_LEDES.router,
      quote: repair.rationale,
      image: null,
      facts,
      link: null,
      at: decidedAt,
      caveat: null,
    });
  }

  /* 5. The proposal, if one is on file, with the two-moments caveat when it predates the verdict
        above. The link goes to the card on its own route, because that is where the sha256
        interlock and the accept command live and this sequence does not restate them. */
  const amendment = amendmentFor(snapshot, promiseId);
  if (amendment !== null) {
    steps.push({
      kind: 'amendment',
      heading: STEP_HEADINGS.amendment,
      lede: STEP_LEDES.amendment,
      quote: amendment.proposedText,
      image: null,
      facts: [
        { term: 'amendment', value: amendment.id },
        { term: 'status', value: amendment.status },
        { term: 'replaces', value: citationLabel(amendment.citation) },
        { term: 'proposed', value: amendment.createdAt },
      ],
      link: { href: `/amendments#${amendment.id}`, words: 'open the amendment in full' },
      at: amendment.createdAt,
      caveat: orderCaveat(decidedAt, amendment.createdAt),
    });
  }

  return Object.freeze(steps);
}

/** `3 of 5`, counted from one because a reader does. */
export function stepCounter(index: number, total: number): string {
  return `${String(index + 1)} of ${String(total)}`;
}

/** Where a step lands, clamped at both ends rather than wrapping. */
export function stepAt(index: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(index + delta, 0), total - 1);
}
