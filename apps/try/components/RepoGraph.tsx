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

import { useCallback, useRef, useState, type FormEvent } from 'react';

import type { GraphResponse } from '../app/api/graph/route.js';
import {
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
  REJECTIONS_BODY,
  REJECTIONS_HEADING,
  RESULT_HEADING,
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
  const field = useRef<HTMLInputElement | null>(null);

  const read = useCallback(async (repo: string): Promise<void> => {
    setState('reading');
    setResult(null);
    try {
      const res = await fetch('/api/graph', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo }),
      });
      const body = (await res.json()) as GraphResponse;
      setResult(body);
      setState(body.ok ? 'done' : 'failed');
    } catch {
      /* A network failure on the reader's side, not the server's. Said plainly rather than
         reported as a fault in the repository they asked about. */
      setResult({
        ok: false,
        message: 'The request did not reach this page. Check your connection and try again.',
      });
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

      {state === 'failed' && result !== null ? (
        <div className="try-error">
          <p className="try-error__text">{result.message}</p>
        </div>
      ) : null}

      {state === 'done' && result !== null && result.ok ? <Result result={result} /> : null}
    </>
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
