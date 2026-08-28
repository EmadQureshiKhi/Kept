/**
 * The two Kiro hook files — schema conformance and prompt content guards
 * (design §11.1, §13.2, R11.1, R11.2, R11.3).
 *
 * These two JSON files are the *trigger* half of the closed loop: the thing that
 * makes KEPT react to a save rather than wait to be asked. Nothing else in the
 * repository validates them. Kiro reads them at load time and a malformed one is
 * simply an inert file — the loop would look wired up in the design document and
 * be silently dead on disk, which is the exact failure mode this suite exists to
 * make impossible.
 *
 * Three claims here are load-bearing rather than incidental:
 *
 *   1. **Both files parse and conform.** `enabled`, `name`, `description`,
 *      `version`, `when.type`, a non-empty `when.patterns`, `then.type` and a
 *      non-empty `then.prompt`. Both are `fileEdited` over patterns and both are
 *      `askAgent` rather than `runCommand`, deliberately: the agent runs the CLI
 *      *and then reads the handoff and reports*, which a bare command cannot do.
 *   2. **The docs prompt cannot carry a source id.** `kane-cli maintain reconcile`
 *      requires `--from` and `--source-id`, and §13.2.2 resolves the id at run
 *      time against the live store — the ladder's `ok: true` arm is the only place
 *      an id comes from. If the prompt ever told the agent to pass one, the agent
 *      would guess, and a guessed id is a reconciliation applied to the wrong
 *      document. So the literal identifier prefix is banned from the prompt
 *      outright, which is a stronger and much cheaper guard than any amount of
 *      prose asking the author to be careful.
 *   3. **The docs prompt cannot walk a stored plan.** `--plan` is the hook path
 *      and the only hook path (§13.2.3); the flag that applies a stored plan is a
 *      deliberate human command and is banned from the prompt by the same
 *      substring rule. Combining the two is also the single case `kept` itself
 *      exits non-zero, so a prompt that grew the flag would be both unsafe and
 *      the one invocation that fails loudly.
 *
 * This suite lives in `packages/kept-core/test/` rather than beside the hooks
 * because it needs a Node environment and a home inside `tsc -b`'s include list,
 * and this is the workspace's node-environment suite. `demo-script.test.ts` set
 * the precedent for a suite here whose subject is outside the package; the
 * location is about the runner, not the subject.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HANDOFF_HOOKS } from 'kept-core';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** Where Kiro looks. Committed, unlike everything under `.kept/`. */
const HOOK_DIRECTORY = '.kiro/hooks';

/**
 * Every event type the Kiro hook schema admits. Enumerated so a typo in
 * `when.type` fails here rather than producing a hook Kiro quietly never fires.
 */
const EVENT_TYPES: readonly string[] = [
  'fileEdited',
  'fileCreated',
  'fileDeleted',
  'userTriggered',
  'promptSubmit',
  'agentStop',
  'preToolUse',
  'postToolUse',
  'preTaskExecution',
  'postTaskExecution',
];

/** The two action types. `askAgent` carries a prompt, `runCommand` a command. */
const ACTION_TYPES: readonly string[] = ['askAgent', 'runCommand'];

interface HookFile {
  readonly slug: string;
  readonly path: string;
  readonly source: string;
  readonly parsed: Record<string, unknown>;
}

/** Read and parse one hook by its slug, failing with the file named. */
function hook(slug: string): HookFile {
  const path = `${HOOK_DIRECTORY}/${slug}.json`;
  const source = readFileSync(resolve(REPO_ROOT, path), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${String(error)}`);
  }
  expect(typeof parsed, `${path} must be a JSON object`).toBe('object');
  expect(parsed, `${path} must be a JSON object`).not.toBeNull();
  expect(Array.isArray(parsed), `${path} must be an object, not an array`).toBe(false);
  return { slug, path, source, parsed: parsed as Record<string, unknown> };
}

/** Read the `when` block as an object, failing with the file named. */
function whenOf(file: HookFile): Record<string, unknown> {
  const value = file.parsed.when;
  expect(typeof value, `${file.path} must declare a \`when\` object`).toBe('object');
  expect(value, `${file.path} must declare a \`when\` object`).not.toBeNull();
  return value as Record<string, unknown>;
}

/** Read the `then` block as an object, failing with the file named. */
function thenOf(file: HookFile): Record<string, unknown> {
  const value = file.parsed.then;
  expect(typeof value, `${file.path} must declare a \`then\` object`).toBe('object');
  expect(value, `${file.path} must declare a \`then\` object`).not.toBeNull();
  return value as Record<string, unknown>;
}

/** `when.patterns` as a string array. */
function patternsOf(file: HookFile): readonly string[] {
  const value = whenOf(file).patterns;
  expect(Array.isArray(value), `${file.path} must declare \`when.patterns\` as an array`).toBe(true);
  return value as readonly string[];
}

/** `then.prompt` as a string. */
function promptOf(file: HookFile): string {
  const value = thenOf(file).prompt;
  expect(typeof value, `${file.path} must declare \`then.prompt\` as a string`).toBe('string');
  return value as string;
}

const CODE_HOOK = hook('kept-code-verify');
const DOCS_HOOK = hook('kept-docs-reconcile');
const BOTH: readonly HookFile[] = [CODE_HOOK, DOCS_HOOK];

/**
 * `.kept/config.json` as committed, read as bytes (design §20.1).
 *
 * Read raw rather than through `loadConfig`, for two reasons. The loader lives in
 * `kept-cli` and this suite is in `kept-core`, so importing it would invert the
 * dependency direction the whole of §20 turns on. And the loader *fails closed*: an
 * absent `subject.docs` resolves to `['README.md']` with a diagnostic, which would make
 * the mirroring assertion below pass while describing a repository this is not. What
 * the hooks have to agree with is the file, not the fallback.
 */
function keptConfig(): {
  readonly corpus?: { readonly root?: string };
  readonly subject?: { readonly source?: readonly string[]; readonly docs?: readonly string[] };
} {
  const source = readFileSync(resolve(REPO_ROOT, '.kept/config.json'), 'utf8');
  return JSON.parse(source) as ReturnType<typeof keptConfig>;
}

const CONFIG = keptConfig();

/**
 * The tree one pattern watches: its `/**​/*.ext` or `/*.ext` tail removed, leaving the
 * configured glob it has to belong to. A literal file pattern like
 * `apps/fixture/README.md` has no tail and is its own stem, which is how it joins the
 * same comparison.
 */
function stemOf(pattern: string): string {
  return pattern.replace(/\/\*\*\/\*\.[A-Za-z0-9]+$/u, '/**').replace(/\/\*\.[A-Za-z0-9]+$/u, '');
}

describe('the hook files Kiro loads exist and are the two the handoff names', () => {
  it('names exactly the hooks the handoff contract knows about', () => {
    // `HANDOFF_HOOKS` is the trigger vocabulary of the handoff file (§11.2). A
    // third hook file, or a renamed one, would write a `trigger.hook` no reader
    // recognises — so the two lists are one list, checked in both directions.
    expect([...HANDOFF_HOOKS].sort()).toEqual(BOTH.map((file) => file.slug).sort());
  });

  it.each(BOTH.map((file) => [file.slug, file] as const))(
    '%s parses as a JSON object',
    (_slug, file) => {
      expect(file.source.length).toBeGreaterThan(0);
      expect(Object.keys(file.parsed).length).toBeGreaterThan(0);
    },
  );
});

describe('both hook files conform to the Kiro hook JSON schema', () => {
  it.each(BOTH.map((file) => [file.slug, file] as const))(
    '%s declares enabled, name, description and version',
    (_slug, file) => {
      expect(file.parsed.enabled, `${file.path} must be enabled`).toBe(true);

      expect(typeof file.parsed.name).toBe('string');
      expect((file.parsed.name as string).trim().length).toBeGreaterThan(0);

      expect(typeof file.parsed.description).toBe('string');
      expect((file.parsed.description as string).trim().length).toBeGreaterThan(0);

      expect(typeof file.parsed.version).toBe('string');
      expect((file.parsed.version as string).trim().length).toBeGreaterThan(0);
    },
  );

  it.each(BOTH.map((file) => [file.slug, file] as const))(
    '%s fires on fileEdited over a non-empty pattern list',
    (_slug, file) => {
      const when = whenOf(file);
      expect(EVENT_TYPES).toContain(when.type);
      // Both hooks are save-triggered. A creation- or prompt-triggered hook would
      // not close the loop: step five of §11.3 is *saving* the repair.
      expect(when.type).toBe('fileEdited');

      const patterns = patternsOf(file);
      expect(patterns.length).toBeGreaterThan(0);
      for (const pattern of patterns) {
        expect(typeof pattern).toBe('string');
        expect(pattern.trim()).toBe(pattern);
        expect(pattern.length).toBeGreaterThan(0);
        // Repository-relative POSIX, like every other path in the system.
        expect(pattern.startsWith('/')).toBe(false);
        expect(pattern).not.toContain('\\');
      }
      // No duplicate pattern: a doubled glob would fire one save twice.
      expect(new Set(patterns).size).toBe(patterns.length);
    },
  );

  it.each(BOTH.map((file) => [file.slug, file] as const))(
    '%s asks the agent rather than running a bare command',
    (_slug, file) => {
      const then = thenOf(file);
      expect(ACTION_TYPES).toContain(then.type);
      // `askAgent`, not `runCommand`, deliberately: the action is run the CLI,
      // *then* read `.kept/handoff.json` and act on the branch it names.
      expect(then.type).toBe('askAgent');
      expect(then.command, `${file.path} must not carry a command alongside a prompt`).toBeUndefined();

      const prompt = promptOf(file);
      expect(prompt.trim().length).toBeGreaterThan(0);
      // Long enough to actually carry the branch fence rather than a stub.
      expect(prompt.length).toBeGreaterThan(200);
      // The handoff is the contract; a prompt that never reads it is not a loop.
      expect(prompt).toContain('.kept/handoff.json');
    },
  );
});

describe('the hook pattern lists mirror subject.* and cannot drift from it (§20.1, R15.2)', () => {
  /**
   * The fourth load-bearing claim in this file, and the newest.
   *
   * Until §20.1 the two pattern lists were checked against `FIXTURE_SOURCE_GLOBS` and
   * `FIXTURE_DOC_GLOBS`, constants inside `handoff/handoff.ts`. Those constants are
   * gone: the paths are `subject.source` and `subject.docs` in `.kept/config.json`, and
   * the CLI resolves `nextAction.allowedPaths` and `nextAction.forbiddenPaths` from
   * them. That move is exactly the change that could leave the hooks watching a tree
   * the fence no longer covers, and the damage is quiet in both directions: a hook
   * watching a tree the config omits tells an agent to repair a file it is fenced out
   * of, and a config naming a tree no hook watches means a save there starts nothing at
   * all. So the two lists are one list, checked here against the file the CLI reads.
   */
  it('declares the config keys the hooks are a projection of', () => {
    // Not defaults. A `subject` key that resolved to the fallback would make every
    // clause below vacuously true about the wrong repository.
    expect(Array.isArray(CONFIG.subject?.source)).toBe(true);
    expect(Array.isArray(CONFIG.subject?.docs)).toBe(true);
    expect((CONFIG.subject?.source ?? []).length).toBeGreaterThan(0);
    expect((CONFIG.subject?.docs ?? []).length).toBeGreaterThan(0);
    expect(typeof CONFIG.corpus?.root).toBe('string');
  });

  it('watches exactly the trees subject.source declares', () => {
    const stems = [...new Set(patternsOf(CODE_HOOK).map(stemOf))].sort();
    expect(stems).toEqual([...(CONFIG.subject?.source ?? [])].sort());
  });

  it('watches exactly the documentation subject.docs declares', () => {
    const stems = [...new Set(patternsOf(DOCS_HOOK).map(stemOf))].sort();
    expect(stems).toEqual([...(CONFIG.subject?.docs ?? [])].sort());
  });

  it('watches neither the corpus root nor anything under it, on either hook', () => {
    // The corpus is forbidden on every branch (§8.1). A hook that fired on a
    // `*_test.md` save would start a verification of the very document that defines
    // the assertion, which is the loop's one prohibited repair path.
    const root = CONFIG.corpus?.root ?? '';
    expect(root.length).toBeGreaterThan(0);
    for (const file of BOTH) {
      for (const pattern of patternsOf(file)) {
        expect(pattern.startsWith(`${root}/`), `${file.path} watches the corpus`).toBe(false);
        expect(pattern).not.toBe(root);
      }
    }
  });

  it('watches no path under either package root, on either hook', () => {
    // KEPT's own code is never the repair target and must not be the trigger either.
    for (const file of BOTH) {
      for (const pattern of patternsOf(file)) {
        expect(pattern.startsWith('packages/'), `${file.path} watches the engine`).toBe(false);
      }
    }
  });
});

describe('the code hook prompt repairs inside the fence the handoff declares', () => {
  const prompt = promptOf(CODE_HOOK);

  it('runs the verify command and branches on the handoff', () => {
    expect(prompt).toContain('node bin/kept verify --changed');
    expect(prompt).toContain('nextAction.branch');
    expect(prompt).toContain('code-break');
    expect(prompt).toContain('test-drift');
    expect(prompt).toContain('docs-lie');
  });

  it('names both sides of the fence and the citation it repairs against', () => {
    expect(prompt).toContain('nextAction.allowedPaths');
    expect(prompt).toContain('nextAction.forbiddenPaths');
    expect(prompt).toContain('results[].citation.text');
  });

  it('treats the unproven outcomes as report-and-change-nothing', () => {
    expect(prompt).toContain('paused-resumable');
    expect(prompt).toContain('killed-by-timeout');
    expect(prompt).toContain('preflight-rejected');
    expect(prompt).toContain('diagnostics');
    // Every `kept` command exits zero except the one mutually-exclusive flag
    // pair (§13.1), so the prompt must not offer the exit code as the signal.
    expect(prompt.toLowerCase()).toContain('exit code is never the signal');
  });
});

describe('the docs hook prompt cannot invent a source id or apply a plan', () => {
  const prompt = promptOf(DOCS_HOOK);

  it('runs the reconcile command and says who resolves the source id', () => {
    expect(prompt).toContain('node bin/kept reconcile --changed');
    expect(prompt).toContain('--from');
    expect(prompt).toContain('--source-id');
    expect(prompt).toContain('never invent a source id');
  });

  it('contains no literal source-id prefix anywhere in the prompt', () => {
    // The guard of R11.3 in one line. `src_7f31c0a4` in §13.2.1 is an *example*
    // of a resolved id; a prompt carrying that shape would hand the agent a
    // constant to paste, and a pasted id reconciles the wrong document.
    expect(prompt.includes('src_'), 'the docs prompt must not carry a source-id literal').toBe(
      false,
    );
    // The whole file, not just the prompt — a description or a name could carry
    // one just as easily.
    expect(DOCS_HOOK.source.includes('src_')).toBe(false);
  });

  it('contains no apply flag anywhere in the prompt', () => {
    // `--plan` is the hook path and the only hook path (§13.2.3). Walking a
    // stored plan is `kept reconcile apply`, a human command, and pairing the two
    // flags is the single usage error `kept` exits non-zero on.
    expect(prompt.includes('--apply'), 'the docs prompt must not carry an apply flag').toBe(false);
    expect(DOCS_HOOK.source.includes('--apply')).toBe(false);
    // And it says so in words, so the agent is told rather than merely not shown.
    expect(prompt).toContain('Never run `kept reconcile apply`');
  });

  it('quotes the ingest remedy and changes nothing on an unresolved source', () => {
    expect(prompt).toContain('reconcile-source-unresolved');
    expect(prompt).toContain('kane-cli context ingest');
    expect(prompt.toLowerCase()).toContain('change nothing');
  });

  it('forbids editing documentation, tests or source on this branch', () => {
    expect(prompt).toContain('Do not edit documentation, tests or source');
    expect(prompt).toContain('undesigned');
  });
});
