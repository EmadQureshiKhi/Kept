import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AtomicRenamer, StateFileSystem } from 'kept-core';
import { createDiagnosticSink, promiseId, proposeAmendment } from 'kept-core';
import { describe, expect, it } from 'vitest';

import { EXIT_OK } from '../src/args.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { IMPLEMENTED_COMMANDS, main } from '../src/main.js';
import {
  LOOPBACK_HOSTS,
  WATCH_ACCEPT_PREFIX,
  WATCH_DIAGNOSTIC_CODES,
  WATCH_HOST,
  WATCH_LOCAL_ENV_VALUE,
  WATCH_LOCAL_ENV_VAR,
  WATCH_METHOD,
  WATCH_PORT,
  WATCH_REFUSALS,
  WATCH_START_REFUSALS,
  isLoopbackHost,
  namesAPath,
  readAcceptTarget,
  runWatch,
  type WatchAcceptHandler,
  type WatchAddress,
  type WatchAnswer,
  type WatchListener,
  type WatchListenerFactory,
} from '../src/commands/watch.js';

/**
 * `kept watch`: the loopback accept listener (task 21.8, design §8.5, §13.1, §14.2,
 * R7.5, R7.6).
 *
 * Every test here runs with **no socket**. The listener is a seam with a production
 * default, exactly as `doctor.ts` injects its URL probe, so the bind that is asserted
 * is the bind `runWatch` asked for rather than one a test managed to establish on a
 * machine that happened to have the port free. A test that binds a real port fails on
 * a machine where something else already holds 3199, and there is not one of those in
 * this repository.
 *
 * What is being asserted is not that a happy request works, though one does and it
 * writes a real line through the real accept path. It is the four properties the
 * feature is only safe because of:
 *
 *   1. the bind is loopback, and a listener that comes back on `0.0.0.0` is closed
 *      rather than served;
 *   2. nothing is bound at all without `NEXT_PUBLIC_KEPT_LOCAL=1`;
 *   3. the only thing the route accepts is an amendment id, so a request naming a
 *      *path* is refused and no filesystem write is reachable from it;
 *   4. one method, one route, and every other request is refused with a status.
 *
 * The fifth claim of task 21.8, that the production Ledger bundle contains no
 * reference to port 3199, is asserted here as its cause rather than its symptom:
 * nothing under `apps/` imports this module. Reading the built output belongs to
 * whoever owns the Ledger build, and shelling out to `next build` from a unit suite
 * would make this file the slowest in the repository for a weaker claim.
 */

const REPO = '/repo';
const AT = '2026-08-22T09:14:05.221Z';
const README = 'apps/fixture/README.md';

const DISCOUNT_CLAIM =
  '- The Cart screen applies a 10 percent discount automatically when the subtotal exceeds 50 dollars.';
const REPLACEMENT = '- The Cart screen shows the order total with no automatic discounts.';
const DISCOUNT_LINE = 6;

/** A small document whose line 6 is the claim to be amended. */
const README_TEXT = [
  '# Kepler Coffee',
  '',
  '## What Kepler Coffee promises',
  '',
  '- The Shop screen lists exactly six coffees.',
  DISCOUNT_CLAIM,
  '',
].join('\n');

// ---------------------------------------------------------------------------
// The seams
// ---------------------------------------------------------------------------

/** A filesystem that records every path written, so "wrote nothing" is checkable. */
function store(seed: Readonly<Record<string, string>> = {}): StateFileSystem & {
  readonly files: Map<string, string>;
  readonly writes: string[];
  readonly rename: AtomicRenamer;
} {
  const files = new Map(Object.entries(seed));
  const writes: string[] = [];
  return {
    files,
    writes,
    readFile: (path: string) => files.get(path) ?? null,
    ensureDir: () => undefined,
    writeFile: (path: string, contents: string) => {
      writes.push(path);
      files.set(path, contents);
    },
    rename: (from: string, to: string) => {
      const contents = files.get(from);
      if (contents === undefined) throw new Error(`no staging file at ${from}`);
      files.set(to, contents);
      files.delete(from);
    },
  };
}

interface FakeListener {
  /** Every bind the command asked for, in order. Never more than one. */
  readonly binds: WatchAddress[];
  /** The handler the listener was given, so identity can be asserted. */
  handler: WatchAcceptHandler | null;
  closes: number;
  readonly factory: WatchListenerFactory;
}

/**
 * A listener that binds nothing and remembers everything.
 *
 * `reports` is what the transport claims it bound, defaulting to the address it was
 * asked for. A test that wants the wildcard-bind path sets it to `0.0.0.0` and finds
 * out what `runWatch` does about it.
 */
function fakeListener(
  options: {
    readonly reports?: WatchAddress | null;
    readonly error?: string | null;
  } = {},
): FakeListener {
  const state: FakeListener = {
    binds: [],
    handler: null,
    closes: 0,
    factory: async (bind, accept): Promise<WatchListener> => {
      state.binds.push(bind);
      state.handler = accept;
      const failed = (options.error ?? null) !== null;
      return {
        address: failed ? null : (options.reports ?? bind),
        error: options.error ?? null,
        close: async (): Promise<void> => {
          state.closes += 1;
        },
      };
    },
  };
  return state;
}

/** A repository whose README carries the claim, with one amendment staged. */
function staged(): {
  readonly fileSystem: ReturnType<typeof store>;
  readonly id: string;
} {
  const fileSystem = store({ [`${REPO}/${README}`]: README_TEXT });
  const proposal = proposeAmendment({
    repoRoot: REPO,
    promiseId: promiseId(README, DISCOUNT_CLAIM),
    citation: { file: README, line: DISCOUNT_LINE, text: DISCOUNT_CLAIM },
    proposedText: REPLACEMENT,
    rationale: 'The router settled this claim as docs-lie.',
    strategy: 'failureYamlTriage',
    at: AT,
    fileSystem,
    diagnostics: createDiagnosticSink(),
  });
  if (!proposal.ok) throw new Error(`the fixture failed to stage an amendment`);
  return { fileSystem, id: proposal.amendment.id };
}

/** Start the listener with the gate on, and hand back the pieces a test drives. */
async function watching(
  options: {
    readonly fileSystem?: ReturnType<typeof store>;
    readonly listener?: FakeListener;
    readonly env?: Readonly<Record<string, string | undefined>>;
  } = {},
) {
  const fileSystem = options.fileSystem ?? store({ [`${REPO}/${README}`]: README_TEXT });
  const listener = options.listener ?? fakeListener();
  // The sink is held by the test rather than read back off the result: `entries` is a
  // copy taken when the result is built, and the diagnostics a *request* reports are
  // written after that.
  const sink = createDiagnosticSink();
  const handle = await runWatch({
    repoRoot: REPO,
    config: DEFAULT_CONFIG,
    env: options.env ?? { [WATCH_LOCAL_ENV_VAR]: WATCH_LOCAL_ENV_VALUE },
    listen: listener.factory,
    fileSystem,
    rename: fileSystem.rename,
    diagnostics: sink,
    now: () => AT,
    // No Kane boundary: the rebuild after an accept is a state of the world KEPT
    // reports on (R2.12), and nothing here is about Kane.
  });
  return { fileSystem, listener, handle, sink };
}

/** One request through the handler the listener was actually given. */
async function request(
  listener: FakeListener,
  method: string,
  url: string,
): Promise<WatchAnswer> {
  const handler = listener.handler;
  if (handler === null) throw new Error('nothing is listening, so no request can be made');
  return handler({ method, url });
}

function payloadOf(answer: WatchAnswer): Record<string, unknown> {
  return JSON.parse(answer.body) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 1. Loopback only
// ---------------------------------------------------------------------------

describe('the bind is loopback, and nothing else (§8.5)', () => {
  it('asks for 127.0.0.1 and the fixed port, and never a wildcard address', async () => {
    const { listener, handle } = await watching();

    expect(WATCH_HOST).toBe('127.0.0.1');
    expect(WATCH_HOST).not.toBe('0.0.0.0');
    expect(listener.binds).toEqual([{ host: '127.0.0.1', port: WATCH_PORT }]);
    // Stated twice on purpose: the constant and the bind are different facts, and a
    // future refactor that read a host off a flag would break the second and not the
    // first.
    expect(listener.binds[0]?.host).not.toBe('0.0.0.0');
    expect(listener.binds[0]?.host).not.toBe('::');
    expect(listener.binds).toHaveLength(1);

    expect(handle.result.listening).toBe(true);
    expect(handle.result.host).toBe('127.0.0.1');
    expect(handle.result.port).toBe(WATCH_PORT);
    expect(handle.result.exitCode).toBe(0);
    await handle.close();
    expect(listener.closes).toBe(1);
  });

  it('serves the handler it reports, so there is one accept path and not two', async () => {
    const { listener, handle } = await watching();
    // Identity, not equivalence: the function the socket reaches is the function the
    // handle exposes, so a test driving the handle is testing what production serves.
    expect(handle.accept).toBe(listener.handler);
    await handle.close();
  });

  it('closes a listener that comes back on 0.0.0.0 without answering one request', async () => {
    const listener = fakeListener({ reports: { host: '0.0.0.0', port: WATCH_PORT } });
    const { handle, fileSystem } = await watching({ listener });

    expect(handle.result.listening).toBe(false);
    expect(handle.result.refusal).toBe(WATCH_START_REFUSALS.notLoopback);
    expect(handle.result.host).toBeNull();
    expect(handle.result.port).toBeNull();
    expect(handle.accept).toBeNull();
    // It was shut down, rather than left up and reported on.
    expect(listener.closes).toBe(1);
    expect(handle.result.diagnostics.map((entry) => entry.code)).toContain(
      WATCH_DIAGNOSTIC_CODES.notLoopback,
    );
    expect(
      handle.result.diagnostics
        .filter((entry) => entry.code === WATCH_DIAGNOSTIC_CODES.notLoopback)
        .map((entry) => entry.severity),
    ).toEqual(['error']);
    expect(fileSystem.writes).toEqual([]);
    expect(handle.result.exitCode).toBe(0);
    // And a caller that closes it anyway gets no second close and no throw.
    await handle.close();
  });

  it('recognises loopback and refuses every host that is not', () => {
    for (const host of LOOPBACK_HOSTS) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ['0.0.0.0', '::', '10.0.0.4', '192.168.1.9', 'example.com', '']) {
      expect(isLoopbackHost(host), `${host} must not count as loopback`).toBe(false);
    }
    expect(isLoopbackHost(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The dev gate
// ---------------------------------------------------------------------------

describe('the dev gate: no listener without NEXT_PUBLIC_KEPT_LOCAL=1 (§8.5)', () => {
  it('binds nothing, names the variable, and exits 0', async () => {
    const listener = fakeListener();
    const { handle } = await watching({ listener, env: {} });

    expect(handle.result.listening).toBe(false);
    expect(handle.result.local).toBe(false);
    expect(handle.result.refusal).toBe(WATCH_START_REFUSALS.notLocal);
    expect(handle.result.envVar).toBe('NEXT_PUBLIC_KEPT_LOCAL');
    // The listener was never even asked for: not bound and idle, never bound.
    expect(listener.binds).toEqual([]);
    expect(handle.accept).toBeNull();
    expect(handle.result.exitCode).toBe(0);

    const message = handle.result.diagnostics
      .filter((entry) => entry.code === WATCH_DIAGNOSTIC_CODES.notLocal)
      .map((entry) => entry.message)
      .join('');
    expect(message).toContain(WATCH_LOCAL_ENV_VAR);
    expect(message).toContain('kept amend accept');
  });

  it('treats any value but 1 as absent', async () => {
    for (const value of ['0', 'true', 'yes', '', ' 1', '1 ']) {
      const listener = fakeListener();
      const { handle } = await watching({
        listener,
        env: { [WATCH_LOCAL_ENV_VAR]: value },
      });
      expect(handle.result.listening, `'${value}' must not open a port`).toBe(false);
      expect(listener.binds).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. One method, one route
// ---------------------------------------------------------------------------

describe('one method and one route, and every other request refused', () => {
  it('answers 405 with an Allow header for every method but POST', async () => {
    const { listener, handle, fileSystem } = await watching();
    const { id } = staged();

    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', '']) {
      const answer = await request(listener, method, `${WATCH_ACCEPT_PREFIX}${id}`);
      expect(answer.status, `${method} must be refused`).toBe(405);
      expect(answer.headers.allow).toBe(WATCH_METHOD);
      expect(payloadOf(answer).refusal).toBe(WATCH_REFUSALS.method);
    }
    // Not one write from eight requests at the one route that can write.
    expect(fileSystem.writes).toEqual([]);
    await handle.close();
  });

  it('answers 404 for every path but the accept route', async () => {
    const { listener, handle } = await watching();

    for (const url of [
      '/',
      '/accept',
      '/accept/',
      '/amendments/am_57fdcb99',
      '/reject/am_57fdcb99',
      '/accepted/am_57fdcb99',
      '',
    ]) {
      const answer = await request(listener, WATCH_METHOD, url);
      expect(answer.status, `${url} must be off-route`).toBe(404);
      expect(payloadOf(answer).refusal).toBe(WATCH_REFUSALS.route);
    }
    await handle.close();
  });
});

// ---------------------------------------------------------------------------
// 4. An amendment id, and nothing that could name a path
// ---------------------------------------------------------------------------

describe('the payload is an amendment id and nothing that could name a path', () => {
  /** Every hostile spelling worth naming, and which refusal each one earns. */
  const HOSTILE: readonly { readonly segment: string; readonly refusal: string }[] = [
    { segment: '../../etc/passwd', refusal: WATCH_REFUSALS.path },
    { segment: 'am_57fdcb99/../../../etc/passwd', refusal: WATCH_REFUSALS.path },
    { segment: '..', refusal: WATCH_REFUSALS.path },
    { segment: 'apps/fixture/README.md', refusal: WATCH_REFUSALS.path },
    { segment: '..%2F..%2Fetc%2Fpasswd', refusal: WATCH_REFUSALS.path },
    { segment: '%2e%2e%2fetc', refusal: WATCH_REFUSALS.path },
    { segment: 'am_*', refusal: WATCH_REFUSALS.path },
    // A `?` opens the query string, so what reaches the grammar is the seven hex
    // digits before it. Refused either way, and the reason names the real cause.
    { segment: 'am_57fdcb9?', refusal: WATCH_REFUSALS.grammar },
    { segment: '**/*.md', refusal: WATCH_REFUSALS.path },
    { segment: 'am_[0-9]', refusal: WATCH_REFUSALS.path },
    { segment: '~/.ssh/id_rsa', refusal: WATCH_REFUSALS.path },
    { segment: 'C:\\Windows\\System32', refusal: WATCH_REFUSALS.path },
    { segment: 'am_57fdcb99\u0000.md', refusal: WATCH_REFUSALS.path },
    { segment: 'README.md', refusal: WATCH_REFUSALS.grammar },
    { segment: 'am_57FDCB99', refusal: WATCH_REFUSALS.grammar },
    { segment: 'am_57fdcb9', refusal: WATCH_REFUSALS.grammar },
    { segment: 'am_57fdcb99x', refusal: WATCH_REFUSALS.grammar },
    { segment: 'am_57fdcb9g', refusal: WATCH_REFUSALS.grammar },
    { segment: 'AM_57fdcb99', refusal: WATCH_REFUSALS.grammar },
    { segment: 'am_57fdcb99 ', refusal: WATCH_REFUSALS.grammar },
  ];

  it('refuses each one with 400, and writes nothing at all', async () => {
    const { fileSystem, id } = staged();
    const before = fileSystem.files.get(`${REPO}/${README}`);
    const { listener, handle } = await watching({ fileSystem });
    const writesBefore = fileSystem.writes.length;

    for (const { segment, refusal } of HOSTILE) {
      const answer = await request(
        listener,
        WATCH_METHOD,
        `${WATCH_ACCEPT_PREFIX}${segment}`,
      );
      expect(answer.status, `${segment} must be refused`).toBe(400);
      const payload = payloadOf(answer);
      expect(payload.ok).toBe(false);
      expect(payload.refusal, `${segment} earns the wrong reason`).toBe(refusal);
      // No echo of the segment back to the caller, and no id invented for it.
      expect(payload.id).toBeUndefined();
    }

    // The document is untouched and the staged amendment is still pending: twenty
    // hostile requests were twenty reads of nothing.
    expect(fileSystem.files.get(`${REPO}/${README}`)).toBe(before);
    expect(fileSystem.writes).toHaveLength(writesBefore);
    expect(id).toMatch(/^am_[0-9a-f]{8}$/);
    await handle.close();
  });

  it('never decodes: a percent escape is refused rather than resolved', () => {
    // `%2F` is `/`. If anything here decoded before validating, this segment would
    // become a path and the grammar check would be looking at the wrong string.
    const target = readAcceptTarget(`${WATCH_ACCEPT_PREFIX}am_57fdcb99%2F..%2Fetc`);
    expect(target.id).toBeNull();
    expect(target.refusal).toBe(WATCH_REFUSALS.path);
    expect(target.segment).toBe('am_57fdcb99%2F..%2Fetc');
  });

  it('reads the id off the path and drops any query or fragment', () => {
    for (const suffix of ['', '?force=1', '#now', '?file=../../etc/passwd']) {
      const target = readAcceptTarget(`${WATCH_ACCEPT_PREFIX}am_57fdcb99${suffix}`);
      expect(target.id, `suffix '${suffix}' must not change the id`).toBe('am_57fdcb99');
      expect(target.refusal).toBeNull();
    }
  });

  it('agrees with the grammar that mints the id', () => {
    // The id is not written into this test: it is the one core produced for the real
    // promise and the real replacement, so the route cannot drift from the minting.
    const { id } = staged();
    const target = readAcceptTarget(`${WATCH_ACCEPT_PREFIX}${id}`);
    expect(target.id).toBe(id);
    expect(target.refusal).toBeNull();
  });

  it('names a path when it sees one, and only then', () => {
    for (const value of ['a/b', 'a\\b', '..', '*', '?', '[x]', '{a,b}', '%2f', 'a:b', '(x)']) {
      expect(namesAPath(value), `${value} names a path`).toBe(true);
    }
    for (const value of ['am_57fdcb99', 'am_00000000', 'plainword', 'am_57fdcb99x']) {
      expect(namesAPath(value), `${value} does not name a path`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. The accept path itself, which is `kept amend accept` and not a second one
// ---------------------------------------------------------------------------

describe('the accept path is the CLI’s own (§8.4, R7.6)', () => {
  it('replaces the cited line, leaves every other byte identical, and rebuilds', async () => {
    const { fileSystem, id } = staged();
    const before = (fileSystem.files.get(`${REPO}/${README}`) as string).split('\n');
    const { listener, handle, sink } = await watching({ fileSystem });

    const answer = await request(listener, WATCH_METHOD, `${WATCH_ACCEPT_PREFIX}${id}`);
    expect(answer.status).toBe(200);
    const payload = payloadOf(answer) as {
      readonly ok: boolean;
      readonly id: string;
      readonly outcome: string;
      readonly applied: boolean;
      readonly rebuilt: boolean;
      readonly successorPromiseId: string | null;
    };
    expect(payload.ok).toBe(true);
    expect(payload.id).toBe(id);
    expect(payload.outcome).toBe('applied');
    expect(payload.applied).toBe(true);
    // §8.4 step 7: an accepted amendment retires one promise and creates another, so
    // the graph and the snapshot are rewritten (R7.6).
    expect(payload.rebuilt).toBe(true);
    expect(payload.successorPromiseId).not.toBeNull();

    const after = (fileSystem.files.get(`${REPO}/${README}`) as string).split('\n');
    expect(after).toHaveLength(before.length);
    expect(after[DISCOUNT_LINE - 1]).toBe(REPLACEMENT);
    for (let index = 0; index < before.length; index += 1) {
      if (index === DISCOUNT_LINE - 1) continue;
      expect(after[index]).toBe(before[index]);
    }
    expect(sink.entries.map((entry) => entry.code)).toContain(
      WATCH_DIAGNOSTIC_CODES.accepted,
    );
    await handle.close();
  });

  it('answers 200 and writes no document byte when the cited line moved', async () => {
    const { fileSystem, id } = staged();
    const edited = (fileSystem.files.get(`${REPO}/${README}`) as string).replace(
      DISCOUNT_CLAIM,
      '- The Cart screen applies a 15 percent discount above 50 dollars.',
    );
    fileSystem.files.set(`${REPO}/${README}`, edited);
    const { listener, handle } = await watching({ fileSystem });

    const answer = await request(listener, WATCH_METHOD, `${WATCH_ACCEPT_PREFIX}${id}`);
    // The request was well formed and the interlock did its job, which is an outcome
    // to report rather than an error to signal (§14.2).
    expect(answer.status).toBe(200);
    const payload = payloadOf(answer);
    expect(payload.outcome).toBe('stale');
    expect(payload.applied).toBe(false);
    expect(payload.ok).toBe(false);
    expect(payload.rebuilt).toBe(false);
    expect(fileSystem.files.get(`${REPO}/${README}`)).toBe(edited);
    await handle.close();
  });

  it('reports an id nothing is staged under, and still writes no document', async () => {
    const { listener, handle, fileSystem } = await watching();
    const before = fileSystem.files.get(`${REPO}/${README}`);

    const answer = await request(listener, WATCH_METHOD, `${WATCH_ACCEPT_PREFIX}am_00000000`);
    expect(answer.status).toBe(200);
    expect(payloadOf(answer).applied).toBe(false);
    expect(fileSystem.files.get(`${REPO}/${README}`)).toBe(before);
    await handle.close();
  });

  it('serialises two accepts of the same amendment rather than interleaving them', async () => {
    const { fileSystem, id } = staged();
    const { listener, handle } = await watching({ fileSystem });

    const [first, second] = await Promise.all([
      request(listener, WATCH_METHOD, `${WATCH_ACCEPT_PREFIX}${id}`),
      request(listener, WATCH_METHOD, `${WATCH_ACCEPT_PREFIX}${id}`),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // One applies, and the second finds an amendment that is no longer pending. What
    // must not happen is two applications of one line, and the document says so.
    const outcomes = [payloadOf(first).outcome, payloadOf(second).outcome];
    expect(outcomes).toContain('applied');
    expect(outcomes.filter((outcome) => outcome === 'applied')).toHaveLength(1);
    const after = (fileSystem.files.get(`${REPO}/${README}`) as string).split('\n');
    expect(after.filter((line) => line === REPLACEMENT)).toHaveLength(1);
    await handle.close();
  });
});

// ---------------------------------------------------------------------------
// 6. Exit code zero for every state of the world (§14.2)
// ---------------------------------------------------------------------------

describe('exit code 0 in every case (§14.2)', () => {
  it('reports an occupied port as a fact about the machine', async () => {
    const listener = fakeListener({ error: 'listen EADDRINUSE: address already in use' });
    const { handle } = await watching({ listener });

    expect(handle.result.listening).toBe(false);
    expect(handle.result.refusal).toBe(WATCH_START_REFUSALS.addressInUse);
    expect(handle.result.error).toContain('EADDRINUSE');
    expect(handle.result.exitCode).toBe(0);
    expect(handle.result.diagnostics.map((entry) => entry.code)).toContain(
      WATCH_DIAGNOSTIC_CODES.addressInUse,
    );
    await handle.close();
  });

  it('reports any other bind failure without inventing a cause', async () => {
    const listener = fakeListener({ error: 'listen EACCES: permission denied' });
    const { handle } = await watching({ listener });

    expect(handle.result.refusal).toBe(WATCH_START_REFUSALS.listenFailed);
    expect(handle.result.exitCode).toBe(0);
    expect(handle.result.diagnostics.map((entry) => entry.code)).toContain(
      WATCH_DIAGNOSTIC_CODES.listenFailed,
    );
  });

  /**
   * Through the dispatcher, with the gate **off**.
   *
   * Deliberately only the gated path: `main` wires the production listener, so a run
   * with the gate on would bind a real port, and a suite that opens 3199 fails on any
   * machine already using it and leaves a socket holding the worker's event loop
   * open. The gate is what makes that avoidable rather than something to work around.
   */
  it('is 0 through the dispatcher, and reports why it bound nothing', async () => {
    const out: string[] = [];
    const exitCode = await main(['watch', '--json'], {
      write: (text: string) => out.push(text),
      writeError: () => undefined,
      cwd: REPO,
      // A copy, because `main` writes the member-debug variable into it.
      env: {},
      fileSystem: store(),
      now: () => new Date(AT),
      kane: false,
    });
    expect(exitCode).toBe(EXIT_OK);
    const payload = JSON.parse(out.join('')) as {
      readonly command: string;
      readonly implemented: boolean;
      readonly listening: boolean;
      readonly host: string | null;
      readonly port: number | null;
      readonly route: string;
      readonly refusal: string | null;
    };
    expect(payload.command).toBe('watch');
    expect(payload.implemented).toBe(true);
    expect(payload.listening).toBe(false);
    expect(payload.refusal).toBe(WATCH_START_REFUSALS.notLocal);
    expect(payload.host).toBeNull();
    expect(payload.port).toBeNull();
    expect(payload.route).toBe(`${WATCH_METHOD} ${WATCH_ACCEPT_PREFIX}:id`);
  });

  it('prints the loopback address and the one route in the text output', async () => {
    const out: string[] = [];
    const exitCode = await main(['watch'], {
      write: (text: string) => out.push(text),
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem: store(),
      now: () => new Date(AT),
      kane: false,
    });
    expect(exitCode).toBe(EXIT_OK);
    const text = out.join('');
    expect(text).toContain('kept watch');
    expect(text).toContain(WATCH_LOCAL_ENV_VAR);
    expect(text).toContain('kept amend accept');
    // Whatever else it says, it never advertises a wildcard bind.
    expect(text).not.toContain('0.0.0.0');
  });

  it('is a command the build implements, and the usage text says so', () => {
    expect(IMPLEMENTED_COMMANDS).toContain('watch');
  });
});

// ---------------------------------------------------------------------------
// 7. The Ledger is untouched: nothing under apps/ can reach this module
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SKIP_DIRECTORIES = new Set(['node_modules', '.next', 'dist', 'out', '.turbo', 'coverage']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Test directories are excluded, exactly as `check-readonly.mjs` excludes
 * `apps/ledger/test/` and for the same reason: `read-only-scan.test.ts` *constructs*
 * the import strings it detects, so a scan that read it could only be kept green by
 * weakening itself. Nothing under a test directory is in the Next build, so nothing
 * about the deployed guarantee turns on it. The exclusion is asserted below rather
 * than assumed.
 */
const EXCLUDED_SEGMENT = '/test/';

/** Every shipped source file under `apps/`, repository-relative POSIX. */
function appSourceFiles(): readonly string[] {
  const absoluteRoot = resolve(REPO_ROOT, 'apps');
  const stats = statSync(absoluteRoot, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) {
    throw new Error('apps/ does not exist, so this clause would be vacuous');
  }
  const found: string[] = [];
  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) stack.push(child);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        found.push(relative(REPO_ROOT, child).split('\\').join('/'));
      }
    }
  }
  return found.sort();
}

describe('the listener lives in the CLI, and no app can reach it', () => {
  const ALL = appSourceFiles();
  const FILES = ALL.filter((path) => !path.includes(EXCLUDED_SEGMENT));

  it('found shipped files under apps/, so the clause is not vacuous', () => {
    expect(FILES.length).toBeGreaterThan(10);
    expect(FILES.some((path) => path.startsWith('apps/ledger/'))).toBe(true);
  });

  it('excludes test directories, and that is the only thing it excludes', () => {
    const excluded = ALL.filter((path) => path.includes(EXCLUDED_SEGMENT));
    // Narrow and known: the read-only scan's own wrapper is in there, it names the
    // CLI on purpose, and it is not part of any build.
    expect(excluded).toContain('apps/ledger/test/read-only-scan.test.ts');
    for (const path of excluded) expect(path).toContain(EXCLUDED_SEGMENT);
  });

  it('has no file under apps/ that imports this module by any spelling', () => {
    const offenders = FILES.filter((path) => {
      const source = readFileSync(resolve(REPO_ROOT, path), 'utf8');
      return (
        /(?:from|import|require)\s*\(?\s*['"][^'"]*commands\/watch[^'"]*['"]/.test(source) ||
        /(?:from|import|require)\s*\(?\s*['"]@corgod\/kept-cli(?:\/[^'"]*)?['"]/.test(source)
      );
    });
    expect(
      offenders,
      `${offenders.join(', ')} imports the CLI. The accept listener is in the CLI precisely so ` +
        `the Ledger's route tree stays free of a write path (design §8.5, R8.4), and an import ` +
        `would put one back inside the Next graph.`,
    ).toEqual([]);
  });

  it('leaves the port a CLI fact: no app source names it in a code position', () => {
    // The stronger claim, that the built bundle carries no reference to 3199, is the
    // Ledger build's to assert. This is its cause: no source under `apps/` mentions
    // the port at all, so no bundler can carry it into the output.
    const offenders = FILES.filter((path) =>
      /(?<![\w.])3_?199(?![\w.])/.test(readFileSync(resolve(REPO_ROOT, path), 'utf8')),
    );
    expect(
      offenders,
      `${offenders.join(', ')} names port ${WATCH_PORT}. The deployed Ledger must be ` +
        `byte-identical with and without this feature (task 21.8).`,
    ).toEqual([]);
  });
});
