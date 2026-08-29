/**
 * The form, the result, and the one client boundary on this page.
 *
 * A single component holds the field, the request and the rendering because they are one
 * interaction: paste, wait a moment, read. Splitting them would mean lifting the result into a
 * parent that has no other reason to exist.
 *
 * ## A real form, deliberately
 *
 * `<form onSubmit>` rather than a button with a click handler, so Enter submits, the field is
 * labelled and announced, and a browser's own autofill and history work. That is the opposite of
 * the choice the Ledger makes, and correctly so: the Ledger claims at the DOM that it holds no
 * control which could spend anything, and this page's entire purpose is a control that does
 * something. Two applications, two guarantees, neither borrowed.
 *
 * ## What it will not render
 *
 * No verdict, no colour that reads as one, and no coverage figure. Every claim here has no
 * verdict because no run produced one, so there is nothing to be green or red about and any hue
 * would be this page inventing a judgement. The result is set in ink on paper with the counts
 * stated as counts, and `copy.ts` says in words that nothing has been verified.
 *
 * The claim text is rendered verbatim, untrimmed, in mono. It is the bytes the gate read out of
 * the reader's own file, and a page that tidied them could not be checked against the file.
 */

'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import type { GraphResponse } from '../app/api/graph/route.js';
import {
  CLIENT_TIMEOUT_MESSAGE,
  CLIENT_TIMEOUT_MS,
  EMPTY_BODY,
  EMPTY_HEADING,
  EXAMPLES,
  EXAMPLE_LABEL,
  FIELD_LABEL,
  FIELD_PLACEHOLDER,
  FIGURE_DOCS,
  FIGURE_PROMISES,
  FIGURE_REJECTED,
  FIGURE_TAGS,
  FIGURE_TESTS,
  NOTES_HEADING,
  NO_VERDICT_NOTE,
  OFFLINE_MESSAGE,
  READING_HEADING,
  READING_SLOW,
  READING_STEPS,
  REJECTIONS_BODY,
  REJECTIONS_HEADING,
  RESULT_HEADING,
  RETRY,
  SLOW_AFTER_MS,
  SUBMIT,
  SUBMIT_BUSY,
} from '../lib/copy.js';

/** The field's id, stated once so a label cannot drift off its control. */
export const FIELD_ID = 'kept-try-repo';

/** What the live region says while a read is in flight, and when it lands. */
export function statusSentence(state: State, result: GraphResponse | null): string {
  if (state === 'reading') return 'Reading the repository.';
  if (state === 'failed') return result?.message ?? 'That did not work.';
  if (state === 'done' && result?.counts !== undefined) {
    const { promises, documentsRead } = result.counts;
    return `Found ${String(promises)} claim${promises === 1 ? '' : 's'} in ${String(documentsRead)} document${documentsRead === 1 ? '' : 's'}.`;
  }
  return '';
}

type State = 'idle' | 'reading' | 'done' | 'failed';

export function RepoGraph() {
  const [value, setValue] = useState('');
  const [state, setState] = useState<State>('idle');
  const [result, setResult] = useState<GraphResponse | null>(null);
  /** The repository the last read was for, so the retry control knows what to ask again. */
  const [attempted, setAttempted] = useState('');
  const field = useRef<HTMLInputElement | null>(null);

  const read = useCallback(async (repo: string): Promise<void> => {
    setState('reading');
    setResult(null);
    setAttempted(repo);
    /**
     * A ceiling on the browser's own patience.
     *
     * The handler has a budget and the platform has a ceiling, but neither helps if the response
     * never arrives: a dropped connection mid-request leaves `fetch` pending indefinitely, and the
     * page would read forever with nothing to press. This is the state that made a timeout
     * necessary rather than tidy.
     */
    const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch('/api/graph', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo }),
        signal: timeout,
      });
      /* A platform error page is HTML, not JSON. Parsing it would throw and be reported as a
         connection problem, which is the wrong sentence: the request arrived and something
         upstream answered badly. */
      const body = (await res.json().catch(() => null)) as GraphResponse | null;
      if (body === null) {
        setResult({
          ok: false,
          message:
            `The server answered ${String(res.status)} without a readable body. That is this ` +
            `page's fault rather than your repository's, and trying again is worth a go.`,
        });
        setState('failed');
        return;
      }
      setResult(body);
      setState(body.ok ? 'done' : 'failed');
    } catch {
      /* Two causes, distinguished because the remedies differ: the browser gave up on a read that
         was taking too long, or the request never left at all. */
      setResult({ ok: false, message: timeout.aborted ? CLIENT_TIMEOUT_MESSAGE : OFFLINE_MESSAGE });
      setState('failed');
    }
  }, []);

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      void read(value);
    },
    [read, value],
  );

  const pick = useCallback(
    (slug: string) => (): void => {
      setValue(slug);
      field.current?.focus();
      void read(slug);
    },
    [read],
  );

  const retry = useCallback((): void => {
    void read(attempted === '' ? value : attempted);
  }, [attempted, read, value]);

  const busy = state === 'reading';

  return (
    <>
      <form className="try-form surface-raised" onSubmit={submit}>
        <label className="try-form__label" htmlFor={FIELD_ID}>
          {FIELD_LABEL}
        </label>
        <div className="try-form__row">
          <input
            autoCapitalize="off"
            autoComplete="off"
            className="try-form__input"
            id={FIELD_ID}
            name="repo"
            onChange={(event) => setValue(event.target.value)}
            placeholder={FIELD_PLACEHOLDER}
            ref={field}
            spellCheck={false}
            type="text"
            value={value}
          />
          <button className="try-form__submit" disabled={busy} type="submit">
            {busy ? SUBMIT_BUSY : SUBMIT}
          </button>
        </div>

        <div className="try-form__examples">
          <span className="try-form__examples-label">{EXAMPLE_LABEL}</span>
          {EXAMPLES.map((example) => (
            <button
              className="try-form__example"
              disabled={busy}
              key={example.slug}
              onClick={pick(example.slug)}
              title={example.why}
              type="button"
            >
              {example.slug}
            </button>
          ))}
        </div>
      </form>

      {/* Polite: a reader tabbing through the examples should not be interrupted by each one. */}
      <p aria-live="polite" className="try-status" role="status">
        {statusSentence(state, result)}
      </p>

      {busy ? <Reading /> : null}

      {state === 'failed' && result !== null ? (
        <div className="try-error">
          <p className="try-error__text">{result.message}</p>
          {/* Every failure here is worth one more attempt: a rate limit refills, a 5xx passes, a
              timeout hits a warm cache the second time. A reader should not have to re-paste. */}
          <button className="try-error__retry" onClick={retry} type="button">
            {RETRY}
          </button>
        </div>
      ) : null}

      {state === 'done' && result !== null && result.ok ? <Result result={result} /> : null}
    </>
  );
}

/**
 * What the page shows while it waits.
 *
 * Named steps and an elapsed count, not a progress bar. The handler answers once, at the end, so
 * the page genuinely does not know how far along a read is, and a bar that moves on a timer is a
 * claim about progress that nothing measured. Naming the four steps does the job a bar is meant to
 * do, which is to say that something is happening and roughly what.
 *
 * The elapsed seconds are the honest part. They tick, so the page is visibly alive, and they let a
 * reader decide for themselves whether twenty seconds is too long.
 */
function Reading() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 250);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.floor(elapsed / 1000);

  return (
    <section aria-busy="true" className="try-reading">
      <h2 className="try-reading__heading">
        {READING_HEADING}
        <span className="try-reading__elapsed">{`${String(seconds)}s`}</span>
      </h2>
      <ol className="try-reading__steps">
        {READING_STEPS.map((step) => (
          <li className="try-reading__step" key={step}>
            {step}
          </li>
        ))}
      </ol>
      {elapsed > SLOW_AFTER_MS ? <p className="try-reading__slow">{READING_SLOW}</p> : null}
    </section>
  );
}

function Result({ result }: { readonly result: GraphResponse }) {
  const counts = result.counts;
  const groups = result.groups ?? [];
  if (counts === undefined) return null;

  return (
    <section className="try-result">
      <h2 className="try-result__heading">{RESULT_HEADING}</h2>

      {result.repo === undefined ? null : (
        <p className="try-result__subject">
          <a className="try-result__link" href={result.repo.url} rel="noopener noreferrer" target="_blank">
            {result.repo.slug}
          </a>
          <span className="try-result__ref">{`branch ${result.repo.branch}`}</span>
        </p>
      )}

      <div className="try-figures">
        <Figure value={counts.promises} word={FIGURE_PROMISES} />
        <Figure value={counts.testDocuments} word={FIGURE_TESTS} />
        <Figure value={counts.tags} word={FIGURE_TAGS} />
        <Figure value={counts.documentsRead} word={FIGURE_DOCS} />
        {/* Only when there are some. See FIGURE_REJECTED for why zero is not worth a slot. */}
        {counts.rejected === 0 ? null : (
          <Figure value={counts.rejected} word={FIGURE_REJECTED} />
        )}
      </div>

      {/* Said where a reader is most likely to over-read the figures above. */}
      <p className="try-caveat">{NO_VERDICT_NOTE}</p>

      {(result.notes ?? []).length === 0 ? null : (
        <section className="try-block">
          <h3 className="try-block__heading">{NOTES_HEADING}</h3>
          <ul className="try-block__list">
            {(result.notes ?? []).map((note) => (
              <li className="try-block__item" key={note}>
                {note}
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.length === 0 ? (
        <div className="try-empty">
          <p className="try-empty__heading">{EMPTY_HEADING}</p>
          <p className="try-empty__body">{EMPTY_BODY}</p>
        </div>
      ) : (
        groups.map((group) => (
          <section className="try-group" key={group.file}>
            <h3 className="try-group__file">{group.file}</h3>
            <ul className="try-group__list">
              {group.promises.map((promise) => (
                <li className="try-promise" key={promise.id}>
                  <span className="try-promise__cite">{`${promise.file}:${String(promise.line)}`}</span>
                  {/* Verbatim and untrimmed: these are the bytes out of the reader's own file. */}
                  <p className="try-promise__claim">{promise.claim}</p>
                  <span className="try-promise__test">
                    {promise.testPath === null
                      ? 'no designed test named'
                      : `designed test ${promise.testPath}${promise.testId === null ? '' : ` ${promise.testId}`}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {(result.rejections ?? []).length === 0 ? null : (
        <section className="try-block">
          <h3 className="try-block__heading">{REJECTIONS_HEADING}</h3>
          <p className="try-block__body">{REJECTIONS_BODY}</p>
          <ul className="try-block__list">
            {(result.rejections ?? []).map((rejection, index) => (
              <li className="try-block__item" key={`${rejection.code}-${String(index)}`}>
                <span className="try-block__code">{rejection.code}</span>
                {rejection.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function Figure({ value, word }: { readonly value: number; readonly word: string }) {
  return (
    <span className="try-figure">
      <span className="try-figure__value">{value}</span>
      <span className="try-figure__word">{word}</span>
    </span>
  );
}
