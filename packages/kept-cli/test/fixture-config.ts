/**
 * This repository's own `Kept_Config`, for the suites that verify it (design §20.1).
 *
 * Before §20.1 the corpus root, the subject globs and the repair fences were literals
 * inside `kept-core`, so a test could pass `DEFAULT_CONFIG` and still get the fixture's
 * paths back. They are configuration now, `DEFAULT_CONFIG` fails *closed* per §20.4,
 * with an empty `subject.source`, `['README.md']` for the docs and no fence allowed, and
 * a suite that verifies the fixture has to say so.
 *
 * **The values are read out of `.kept/config.json`, not copied from it.** They used to be
 * hand-written here with a note that some other suite would catch any drift. No suite
 * did: `hook-pattern-partition.prop.test.ts` and `config-portability.prop.test.ts` read
 * the committed file, but neither of them compares it against this module, so when task
 * 26.1 added `README.md` to `subject.docs` the copy here silently went one entry short
 * and every unit suite kept injecting a config this repository does not have. Reading the
 * file removes that whole class of failure: there is one authority on which trees hold
 * the claims and which hold the source, and it is the same bytes the CLI resolves
 * `nextAction.allowedPaths` and `forbiddenPaths` from.
 *
 * Read as raw JSON rather than through `loadConfig`, for the same reason
 * `hook-schema.test.ts` does. `loadConfig` is one of the things under test in this
 * package, so a fixture that went through it could not distinguish a repository whose
 * config says one thing from a loader that reports another, and it would substitute
 * §20.4's closed defaults for a file it could not parse instead of failing. Every field
 * below is therefore validated here and throws by name if it is missing, so a config
 * edit that breaks the shape stops these suites with the reason rather than quietly
 * handing them a default.
 *
 * The fixture paths still end up spelled inside this package, in the file they are read
 * from. §20.2's scan permits that under `packages/*​/test/**`, because a fixture naming a
 * path is a fixture and a test that cannot name the tree it exercises cannot exercise it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG, type KeptConfig } from '../src/config.js';

/** The committed configuration, as bytes on disk. */
const CONFIG_PATH = fileURLToPath(new URL('../../../.kept/config.json', import.meta.url));

interface CommittedDocument {
  readonly corpus?: { readonly root?: unknown };
  readonly subject?: {
    readonly source?: unknown;
    readonly docs?: unknown;
    readonly baseUrl?: unknown;
  };
}

const COMMITTED = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as CommittedDocument;

/** One glob list off `subject`, non-empty and all strings, or an error naming the key. */
function committedGlobs(key: 'source' | 'docs'): readonly string[] {
  const value = COMMITTED.subject?.[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((glob) => typeof glob !== 'string' || glob.length === 0)
  ) {
    throw new Error(
      `.kept/config.json declares no usable subject.${key}, so the suites that inject this ` +
        `config would be exercising §20.4's closed default instead of this repository. ` +
        `Fix the config rather than reinstating a literal here.`,
    );
  }
  return Object.freeze([...(value as readonly string[])]);
}

/** The source trees `subject.source` declares, and the `code-break` fence allows. */
export const FIXTURE_SOURCE_GLOBS: readonly string[] = committedGlobs('source');

/**
 * The documentation surfaces `subject.docs` declares.
 *
 * There are three of them since task 26.1: the fixture's README, the fixture's `docs/`
 * tree, and this repository's own root `README.md`, which became a promise source in its
 * own right (§23.1, R19.1). The count is not spelled here on purpose, because it moved
 * once already and the whole point of reading the file is that it may move again.
 */
export const FIXTURE_DOC_GLOBS: readonly string[] = committedGlobs('docs');

/** `corpus.root`: the directory the baseline provider scans for `@verifies` tags. */
const FIXTURE_CORPUS_ROOT = ((): string => {
  const root = COMMITTED.corpus?.root;
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('.kept/config.json declares no corpus.root, so there is no corpus to scan.');
  }
  return root;
})();

/** `subject.baseUrl`: the origin the reachability probe uses, or null if unconfigured. */
const FIXTURE_BASE_URL = ((): string | null => {
  const baseUrl = COMMITTED.subject?.baseUrl;
  if (baseUrl === undefined || baseUrl === null) return null;
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error('.kept/config.json declares a subject.baseUrl that is not a usable origin.');
  }
  return baseUrl;
})();

/**
 * The config the fixture suites run against.
 *
 * `code-break` is granted exactly `subject.source`, which is what makes
 * `derivedForbidden` reduce to the corpus root, the documentation and the package
 * roots, and what keeps the intersection guard of §20.3 quiet: none of the source trees
 * can reach the corpus or any documentation glob.
 *
 * The four portability keys come off disk; everything else stays on `DEFAULT_CONFIG`.
 * `timeouts` in particular is deliberately the default rather than the committed one,
 * because a suite that waits five minutes for an injected fake is a suite nobody runs,
 * and the budgets are exercised by the suites that pass them in explicitly.
 */
export const FIXTURE_CONFIG: KeptConfig = Object.freeze({
  ...DEFAULT_CONFIG,
  corpus: Object.freeze({ root: FIXTURE_CORPUS_ROOT }),
  subject: Object.freeze({
    source: FIXTURE_SOURCE_GLOBS,
    docs: FIXTURE_DOC_GLOBS,
    baseUrl: FIXTURE_BASE_URL,
  }),
  fences: Object.freeze({
    'code-break': Object.freeze({ allow: FIXTURE_SOURCE_GLOBS }),
    'test-drift': Object.freeze({ allow: Object.freeze([] as readonly string[]) }),
    'docs-lie': Object.freeze({ allow: Object.freeze([] as readonly string[]) }),
  }),
});
