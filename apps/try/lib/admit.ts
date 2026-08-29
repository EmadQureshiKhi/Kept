/**
 * The admission half of KEPT, run over documents fetched from a stranger's repository.
 *
 * KEPT has two phases and only one of them needs a browser. **Admission** reads documents, finds
 * the claims they state, and cites each to a file and a line. **Verification** drives a real
 * browser against a running origin through Kane and decides whether each claim is kept. A web
 * page can do the first and cannot do the second, and this module is the first.
 *
 * ## It is the same gate, not a reimplementation of it
 *
 * That distinction is the entire point of this page. `collectBaseline` takes its filesystem and
 * its citation source as parameters — `inMemoryBaselineFileSystem` and a `CitationSource` are
 * published for exactly this — so the code that finds a claim here is the same code the CLI
 * runs on a working copy. Nothing about the parsing, the `@verifies` grammar, the citation
 * bounds checking or the rejection reasons is re-derived. If it were, this page would be a
 * plausible imitation of KEPT rather than KEPT with its filesystem swapped, and the graph it
 * drew could disagree with the one the CLI draws on the same repository.
 *
 * `kept-core` is taken from npm rather than from the workspace, which is a second thing worth
 * proving: the published package really is enough to build a consumer on.
 *
 * ## Every promise comes back `undesigned`, and that is honest
 *
 * A verdict is a statement that a terminal event from a real run proved or broke a claim. No run
 * happened here, so there is no verdict, and the graph says `undesigned` rather than guessing.
 * That is the same discipline the coverage rail follows when it withholds a figure instead of
 * estimating one, and it is why the page's copy has to say clearly that nothing has been
 * verified. A page that implied otherwise would be the exact overstatement this project exists
 * to refuse.
 *
 * ## Pure, apart from being handed bytes
 *
 * Nothing here fetches. It takes a map of path to text and returns a graph, so the whole of the
 * interesting logic is testable without a network, and the fetching lives in `github.ts` where
 * it can be reasoned about on its own.
 */

import {
  admitPromises,
  collectBaseline,
  createDiagnosticSink,
  inMemoryBaselineFileSystem,
  type CitationSource,
  type Diagnostic,
  type PromiseRecord,
} from 'kept-core';

/** One claim found in a stranger's repository, flattened for the page to render. */
export interface FoundPromise {
  readonly id: string;
  readonly claim: string;
  readonly file: string;
  readonly line: number;
  /** The cited line, verbatim. Never trimmed: it is the bytes the claim was read from. */
  readonly text: string;
  /** The `*_test.md` document whose `@verifies` tag found it. */
  readonly testPath: string | null;
  readonly testId: string | null;
}

/** What a read of one repository produced. */
export interface AdmissionReport {
  readonly promises: readonly FoundPromise[];
  /** Every `*_test.md` the walk found, repository-relative, sorted. */
  readonly testDocuments: readonly string[];
  /** Well-formed `@verifies` tags accepted, which is not the same as promises admitted. */
  readonly tagCount: number;
  /** Documents the walk offered but could not read or decode. */
  readonly skipped: readonly string[];
  /** Every observation both phases made, including the reason each claim was refused. */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * How many candidates the gate refused.
   *
   * Reported separately from `promises.length` because the difference between them is the most
   * useful number on the page for a reader whose documentation is not being picked up: eleven tags
   * and four promises means seven citations do not resolve.
   */
  readonly rejectedCount: number;
}

/**
 * A citation source over the same map the walk reads.
 *
 * Handing the *same* bytes to the walk and to the admission gate is what guarantees the claim
 * text and the admitted citation text came from one read. `kept-core` documents that in so many
 * words on `BaselineContext.citations`, and it is the reason this is one map rather than two.
 */
export function mapCitationSource(files: ReadonlyMap<string, string>): CitationSource {
  return {
    read(file: string): string | null {
      return files.get(file) ?? null;
    },
  };
}

/** The `path:line` a promise was read from, in the one spelling the page uses. */
export function citationLabel(promise: FoundPromise): string {
  return `${promise.file}:${String(promise.line)}`;
}

/**
 * Run the gate over fetched documents.
 *
 * `repoRoot` is a label rather than a location: nothing here touches a disk, but
 * `collectBaseline` requires the field and refuses to substitute `process.cwd()`, which is the
 * right refusal for a function that normally reads files. A slug is passed so any diagnostic
 * that mentions the root names the repository the reader asked about.
 *
 * Never throws. `collectBaseline` expresses failure in its result rather than by rejecting, and
 * a repository with no documents at all is a legitimate answer: zero promises, and a page that
 * says so.
 */
export async function admitRepository(
  files: ReadonlyMap<string, string>,
  repoRoot: string,
): Promise<AdmissionReport> {
  /* One sink across both phases, so the page shows the walk's observations and the gate's refusals
     in the order they happened rather than as two unrelated lists. */
  const diagnostics = createDiagnosticSink();
  const citations = mapCitationSource(files);

  /**
   * Phase one: walk the documents and collect *candidates*.
   *
   * A candidate is a claim a `@verifies` tag pointed at, before anything has checked that the
   * citation resolves. The provider deliberately stops there, because admission is the graph's
   * business rather than a provider's, and this two-step is the same one `kept build` performs.
   */
  const collected = await collectBaseline({
    repoRoot,
    fs: inMemoryBaselineFileSystem(files),
    citations,
    diagnostics,
    /* No corpus root: the walk starts at the repository root, which is the only correct default
       for a repository whose configuration this page has not read. `kept-core` says as much on
       `BaselineContext.corpusRoot` — narrowing to `tests` would be a guess about somebody
       else's layout. */
  });

  /**
   * Phase two: the citation gate.
   *
   * `admitPromises` is the single funnel into a graph. It reads each cited line through the *same*
   * `CitationSource` the walk used, which is what makes the admitted citation text and the claim
   * text come from one read, and it refuses a candidate whose file is missing, whose line is out of
   * range, or whose claim normalises to nothing. Each refusal costs exactly one diagnostic, so the
   * count of refusals is a number this page can state rather than infer.
   */
  const batch = admitPromises({
    candidates: collected.candidates,
    source: citations,
    diagnostics,
  });

  return {
    promises: batch.admitted.map(flatten),
    testDocuments: collected.files,
    tagCount: collected.tagCount,
    skipped: collected.skipped,
    /* `entries` rather than a drain call: the sink exposes a copy of everything reported so far,
       and reading it twice is not a different answer. */
    diagnostics: diagnostics.entries,
    rejectedCount: batch.rejected.length,
  };
}

function flatten(record: PromiseRecord): FoundPromise {
  return {
    id: record.id,
    claim: record.claim,
    file: record.citation.file,
    line: record.citation.line,
    text: record.citation.text,
    testPath: record.designedTest?.path ?? null,
    testId: record.designedTest?.testId ?? null,
  };
}

/**
 * The promises grouped by the document they were read from, in path order.
 *
 * Grouping by cited document rather than by test document, because the question a reader has is
 * "what does my documentation claim", and the answer reads best as one list per file. Within a
 * file the order is by line, so the list matches the file.
 */
export function byDocument(
  promises: readonly FoundPromise[],
): readonly { readonly file: string; readonly promises: readonly FoundPromise[] }[] {
  const groups = new Map<string, FoundPromise[]>();
  for (const promise of promises) {
    groups.set(promise.file, [...(groups.get(promise.file) ?? []), promise]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([file, found]) => ({
      file,
      promises: [...found].sort((left, right) => left.line - right.line),
    }));
}
