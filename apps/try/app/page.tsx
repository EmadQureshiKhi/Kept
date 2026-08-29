/**
 * `/` — the whole of this application.
 *
 * One page: a field, the claims a repository states, and the command that does the half this page
 * cannot. There is no second route, because there is no second thing to say.
 *
 * The page is a server component and stays one. `RepoGraph` is the single client boundary, and it
 * holds the field, the request and the result. Every sentence on the page comes from `lib/copy.ts`
 * rather than from the components, for the reason that file explains: the honesty of this page is
 * its wording, and wording spread across six components is wording nobody reviews as a whole.
 *
 * ## The structure is an argument, in order
 *
 * What this does, then what it does not, then the field, then the result, then how to do the rest.
 * The order matters more than it looks: a reader who meets the field first will paste before
 * reading, see a list of their own claims, and reasonably assume the list means those claims hold.
 * So the standfirst says what has not happened before anything invites them to press a button, and
 * the caveat is repeated beside the figures where the over-reading actually occurs.
 *
 * The install section is last and is not an upsell. A reader who has just seen their own
 * documentation graphed has exactly one question, and the honest answer is a command rather than a
 * signup: verification needs their application running, a browser, and their own Kane credentials,
 * none of which a web page has.
 */

import type { Metadata } from 'next';

import { RepoGraph } from '../components/RepoGraph.js';
import {
  CLI_BODY,
  CLI_HEADING,
  CLI_STEPS,
  CREDENTIALS_BODY,
  CREDENTIALS_HEADING,
  LINKS,
  STANDFIRST,
  TAGLINE,
  TITLE,
} from '../lib/copy.js';

export const metadata: Metadata = {
  title: TITLE,
  description: TAGLINE,
};

export default function TryPage() {
  return (
    <div className="try-page">
      <header className="try-header">
        <h1 className="try-title">{TITLE}</h1>
        <p className="try-standfirst">{STANDFIRST}</p>
      </header>

      <RepoGraph />

      <section className="try-cli">
        <h2 className="try-cli__heading">{CLI_HEADING}</h2>
        <p className="try-cli__body">{CLI_BODY}</p>

        <ol className="try-steps">
          {CLI_STEPS.map((step) => (
            <li className="try-step" key={step.command}>
              {/* The command is text in a `code` element, not a control. Nothing on this page runs
                  anything on the reader's machine, and a copy button would imply otherwise. */}
              <code className="try-step__command">{step.command}</code>
              <span className="try-step__what">{step.what}</span>
            </li>
          ))}
        </ol>

        <div className="try-credentials">
          <h3 className="try-credentials__heading">{CREDENTIALS_HEADING}</h3>
          <p className="try-credentials__body">{CREDENTIALS_BODY}</p>
        </div>

        <nav aria-label="Elsewhere" className="try-links">
          {LINKS.map((link) => (
            <a className="try-links__link" href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </section>
    </div>
  );
}
