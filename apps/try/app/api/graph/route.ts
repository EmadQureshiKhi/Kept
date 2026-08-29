/**
 * `POST /api/graph` — read a public repository and return the claims it states.
 *
 * This is the one handler in this application, and it is worth being explicit about why it may
 * exist here when the Ledger forbids one. `apps/ledger` publishes a committed snapshot and
 * claims, in its own README and enforced by `scripts/check-readonly.mjs` over eleven rules, that
 * the deployed artefact holds no non-GET handler. That claim is a promise in KEPT's own graph. So
 * this page is a **separate application and a separate deployment**: the Ledger keeps its
 * guarantee byte for byte, and the thing that needs a handler lives somewhere the guarantee was
 * never made.
 *
 * ## What it does and does not do
 *
 * It reads markdown over HTTP and runs KEPT's admission gate over the text. It does not clone,
 * install, build or boot anything, and it **never invokes Kane**, so it spends no credits: not
 * the reader's, because they have none here, and not the author's. Every promise it returns is
 * `undesigned`, because no run happened and a verdict without a run would be invented.
 *
 * ## No credential, no persistence, no session
 *
 * There is no token, so nobody has to trust this deployment with a scope and there is nothing
 * here to leak. There is no database: the response is computed and discarded. There is no login,
 * which is a decision rather than an omission — auth would add a session and a store to defend
 * against abuse that a size cap and a time budget defend against more cheaply, and it would put
 * a signup between a judge and the demonstration.
 *
 * ## Failure is a sentence
 *
 * Every path returns JSON with a `message` a reader can act on, including the ones that are
 * GitHub's fault. Nothing throws out of here: a stack trace tells a stranger about this server
 * and tells them nothing about their repository.
 */

import { admitRepository, byDocument, type FoundPromise } from '../../../lib/admit.js';
import { readRepository } from '../../../lib/github.js';
import { parseRepoInput, repoSlug, repoUrl } from '../../../lib/repo.js';

/**
 * Node, not edge. `kept-core` is a Node library and the admission gate reads `node:path`; the
 * edge runtime has no such module. Stated rather than defaulted, so nobody moves it by accident.
 */
export const runtime = 'nodejs';

/** Never cached at the route level: the cache key is the commit, and that is handled below. */
export const dynamic = 'force-dynamic';

/**
 * Longer than the platform's default, and longer than `READ_BUDGET_MS`.
 *
 * Vercel gives a function ten seconds unless it is told otherwise, and reading a large
 * repository's tree takes several of those on its own. A function killed at its ceiling returns
 * the platform's own error page, which tells a reader nothing; the read budget is set below this
 * number so the *page* is what runs out of time and the *page* is what explains itself. The gap
 * between the two is the room the gate needs to run and the answer needs to serialise.
 */
export const maxDuration = 60;

/** The shape the page renders. One type, so the client and the server cannot drift. */
export interface GraphResponse {
  readonly ok: boolean;
  readonly message?: string;
  readonly repo?: {
    readonly slug: string;
    readonly url: string;
    readonly branch: string;
    readonly sha: string;
  };
  readonly counts?: {
    readonly promises: number;
    readonly testDocuments: number;
    readonly tags: number;
    /**
     * Candidates the gate refused.
     *
     * Reported next to `promises` rather than left to be subtracted, because the gap between a
     * repository's tag count and its promise count is the one number that tells a reader whose
     * documentation is not being picked up that their citations do not resolve.
     */
    readonly rejected: number;
    readonly documentsRead: number;
    readonly documentsOffered: number;
  };
  readonly groups?: readonly {
    readonly file: string;
    readonly promises: readonly FoundPromise[];
  }[];
  /** Bounds reached while reading, and the gate's own observations. Shown, never hidden. */
  readonly notes?: readonly string[];
  readonly rejections?: readonly { readonly code: string; readonly message: string }[];
}

function json(body: GraphResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      /* Cached on the commit, so a repository that gets attention is read once. A miss is a few
         seconds; a hit is instant and spends none of GitHub's hourly budget. */
      'cache-control': status === 200 ? 'public, max-age=0, s-maxage=3600' : 'no-store',
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  let input = '';
  try {
    const body = (await request.json()) as { repo?: unknown };
    input = typeof body.repo === 'string' ? body.repo : '';
  } catch {
    return json({ ok: false, message: 'Send a JSON body of the shape { "repo": "owner/name" }.' }, 400);
  }

  const parsed = parseRepoInput(input);
  if (!parsed.ok) return json({ ok: false, message: parsed.message }, 400);

  const read = await readRepository(parsed.ref);
  if (!read.ok) return json({ ok: false, message: read.message }, read.status === 404 ? 404 : 502);

  const report = await admitRepository(read.files, repoSlug(parsed.ref));

  /* The gate reports one diagnostic per refused claim, and refusals are the most interesting
     thing on the page for a reader whose documentation is not being picked up. Surfaced rather
     than counted: "three claims were rejected" is useless without the reason. */
  const rejections = report.diagnostics
    .filter((entry) => entry.severity !== 'info')
    .slice(0, 50)
    .map((entry) => ({ code: entry.code, message: entry.message }));

  return json(
    {
      ok: true,
      repo: {
        slug: repoSlug(parsed.ref),
        url: repoUrl(parsed.ref),
        branch: read.branch,
        sha: read.sha,
      },
      counts: {
        promises: report.promises.length,
        testDocuments: report.testDocuments.length,
        tags: report.tagCount,
        rejected: report.rejectedCount,
        documentsRead: read.files.size,
        documentsOffered: read.offered,
      },
      groups: byDocument(report.promises),
      notes: read.notes,
      rejections,
    },
    200,
  );
}

/**
 * A GET says what this endpoint is for rather than 405-ing at a curious reader.
 *
 * Deliberately not a redirect to the page: somebody who found this URL wants to know what it
 * does, and a sentence answers that where a 302 does not.
 */
export function GET(): Response {
  return json(
    {
      ok: false,
      message:
        'POST { "repo": "owner/name" } to read a public repository and get back the claims its ' +
        'documentation states. Nothing is verified here and no Kane run happens: verification ' +
        'needs your application running and your own credentials, which is what the CLI is for.',
    },
    200,
  );
}
