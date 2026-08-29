/**
 * Every sentence this page says, in one file.
 *
 * The copy lives apart from the components for the reason the Ledger keeps its own copy in
 * `page.tsx` rather than in the pieces it renders: the honesty of this page *is* its wording, and
 * wording spread across six components is wording nobody reviews as a whole.
 *
 * The one thing this page must not do is imply it verified anything. It reads documentation and
 * finds claims. It runs no browser, invokes Kane zero times and spends no credits, so every
 * promise it produces has no verdict. Saying that once, quietly, at the top would not be enough:
 * a reader who lands on a list of their own claims will assume the list means something about
 * whether they hold. So it is said in the standfirst, again beside the figures, and again at the
 * end next to the install line, which is the honest cost of a page that does half a job well.
 */

/** The tab, and the masthead. */
export const TITLE = 'Try KEPT on your repository';

export const TAGLINE = 'Paste a public repository and see the promises its documentation makes.';

/**
 * The standfirst: what happens, and immediately what does not.
 *
 * The second sentence is load-bearing. Without it this reads as a verification service, and the
 * whole product is built on refusing to claim more than a run proved.
 */
export const STANDFIRST =
  'KEPT reads the documents in a repository, finds the claims they state about the product, and ' +
  'cites each one to a file and a line. That is what this page does, in a few seconds, over ' +
  'HTTP, with no account and no token. It stops there: nothing below has been verified, because ' +
  'verifying a promise means driving a real browser against your running application, and this ' +
  'page has neither.';

/** The field. */
export const FIELD_LABEL = 'public GitHub repository';
export const FIELD_PLACEHOLDER = 'github.com/owner/repository';
export const SUBMIT = 'find the promises';
export const SUBMIT_BUSY = 'reading…';

/** Something to press for a reader who has nothing to hand. */
export const EXAMPLE_LABEL = 'or try one';
export const EXAMPLES: readonly { readonly slug: string; readonly why: string }[] = Object.freeze([
  { slug: 'EmadQureshiKhi/Kept', why: 'this project, which states claims about itself' },
  { slug: 'vercel/next.js', why: 'a large documentation tree' },
  { slug: 'sindresorhus/ky', why: 'a small, tidy README' },
]);

/** The heading over the result, and the words for each figure. */
export const RESULT_HEADING = 'what the documentation claims';
export const FIGURE_PROMISES = 'claims found';
export const FIGURE_TESTS = 'designed tests';
export const FIGURE_TAGS = 'verifies tags';
export const FIGURE_DOCS = 'documents read';

/**
 * Shown only when it is not zero.
 *
 * A permanent "0 declined" would be four characters of noise on every good repository. When it is
 * non-zero it is the most useful figure on the page, because it is the difference between the tag
 * count and the claim count and therefore the answer to "why is my documentation not showing up".
 */
export const FIGURE_REJECTED = 'claims declined';

/**
 * Said beside the figures, where a reader is most likely to over-read them.
 *
 * This is the sentence that keeps the page honest at the exact moment it looks like a verdict.
 */
export const NO_VERDICT_NOTE =
  'None of these has a verdict. A verdict comes from a terminal event in a real verification ' +
  'run, no run happened here, and a verdict without a run would be something this page made up.';

/** When a repository states nothing KEPT recognises. */
export const EMPTY_HEADING = 'no claims found, which is a real answer';

export const EMPTY_BODY =
  'KEPT finds a claim by reading a `*_test.md` document that carries an `@verifies` tag pointing ' +
  'at a file and a line. This repository has none, so there is nothing to graph yet rather than ' +
  'nothing to graph ever. The CLI writes the first one for you: `kept init` scaffolds a designed ' +
  'test, and `kept build` reads your own documents and finds the claims in them.';

/** The heading over the gate's refusals, and why they are shown at all. */
export const REJECTIONS_HEADING = 'claims KEPT declined, and why';

export const REJECTIONS_BODY =
  'A tag can point at a file that does not exist, or at a line past the end of one, or at a ' +
  'claim that normalises to nothing. Each is refused with a reason rather than dropped, because ' +
  'a claim silently missing from a graph is worse than one visibly rejected.';

/** The heading over bounds this page hit while reading. */
export const NOTES_HEADING = 'what this page could not read';

/* ── the whole point of the page: the CLI does the other half ────────────────── */

export const CLI_HEADING = 'to verify any of this, run it yourself';

/**
 * Why the CLI is not an upsell here but the actual answer.
 *
 * A reader who has just seen their own claims listed has exactly one next question, and the
 * honest answer is a command rather than a signup. It names the credential requirement plainly,
 * because Kane is the reader's own account and their own spend.
 */
export const CLI_BODY =
  'The half this page cannot do needs three things it does not have: your application running ' +
  'at a URL, a browser to drive against it, and your own Kane credentials, which is whose ' +
  'account the run is billed to. All three live on your machine, so the verification half is a ' +
  'command rather than a website. It reads the same documents this page just read, using the ' +
  'same admission gate, and then goes further: it binds each claim to a designed test, runs ' +
  'them, and writes a verdict backed by sealed evidence.';

/** The commands, in the order they are run. */
export const CLI_STEPS: readonly { readonly command: string; readonly what: string }[] =
  Object.freeze([
    {
      command: 'npm install -g @corgod/kept-cli',
      what: 'the command line tool, published on npm',
    },
    {
      command: 'kept init',
      what: 'writes .kept/config.json and scaffolds one designed test. Invokes Kane zero times',
    },
    {
      command: 'kept build',
      what: 'reads your documents and finds the claims in them, which is what this page did',
    },
    {
      command: 'kept verify --all',
      what: 'drives your application through Kane and writes a verdict per claim. Spends credits',
    },
    {
      command: 'kept snapshot',
      what: 'writes the ledger a site like this one is rendered from',
    },
  ]);

/** Named plainly, because a surprise bill is the worst thing a tool can do to somebody. */
export const CREDENTIALS_HEADING = 'bring your own Kane credentials';

export const CREDENTIALS_BODY =
  'Everything up to and including `kept build` runs with no network and no credentials at all. ' +
  '`kept verify` is the step that invokes Kane, and Kane runs against your own account: install ' +
  'and authenticate `kane-cli` first, and every run after that is billed to you. `kept doctor` ' +
  'reports whether it can find the binary before you spend anything.';

/** Where to read the rest. */
export const LINKS: readonly { readonly href: string; readonly label: string }[] = Object.freeze([
  { href: 'https://withkept.vercel.app', label: 'the ledger this produces' },
  { href: 'https://www.npmjs.com/package/@corgod/kept-cli', label: '@corgod/kept-cli on npm' },
  { href: 'https://www.npmjs.com/package/kept-core', label: 'kept-core on npm' },
  { href: 'https://github.com/EmadQureshiKhi/Kept', label: 'the repository' },
]);

/** The colophon line. */
export const FOOTER_NOTE =
  'This page reads public repositories over HTTP. It stores nothing, sets no cookie, holds no ' +
  'token and invokes Kane zero times.';
