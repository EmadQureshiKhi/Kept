/**
 * `kept watch`: a loopback accept listener that adds no route to the Ledger
 * (design §8.5, §13.1, §14.2, R7.5, R7.6).
 *
 * ## Why this file is in the CLI and not in the Next app
 *
 * R7.5 wants an accept control on a pending amendment. R8.4 forbids the Ledger any
 * route that creates, updates or deletes persisted data. The resolution of §8.5 is
 * not a compromise between the two: the control is a real button in the Ledger that
 * copies `kept amend accept <id>` to the clipboard, and the *write* lives here, in
 * the developer's own CLI process, behind a listener bound to loopback. So the
 * one-click convenience costs the Ledger nothing at all. Its route tree is
 * identical with this feature and without it, which is why `check-readonly.mjs`
 * still passes over `apps/ledger/**` unchanged and why that scan is the honest
 * proof rather than a promise in a comment.
 *
 * Nothing under `apps/` imports this module, and nothing may: an import would put a
 * subprocess-capable write path inside the Next graph, which is the single property
 * the whole arrangement exists to keep.
 *
 * ## The four properties this listener is held to
 *
 * **Loopback only, and asserted rather than intended.** {@link WATCH_HOST} is the
 * only host this command will run on, it is not configurable, and it is not read
 * from a request, a flag or an environment variable. After the listener reports the
 * address it actually bound, {@link runWatch} compares it against
 * {@link isLoopbackHost} and **closes the listener** when it is anything else. A
 * listener on `0.0.0.0` is a mutation endpoint reachable from the network, so
 * "trusting the bind" is not good enough: a wildcard bind that somehow happened is
 * shut down and reported rather than served.
 *
 * **Dev-gated.** Without `NEXT_PUBLIC_KEPT_LOCAL=1` in the environment nothing is
 * bound at all. Not bound and idle: never bound. The refusal names the variable so
 * a reader knows why the button did nothing.
 *
 * **An amendment id, and nothing that could name a path.** The id arrives as one
 * URL segment and is checked against `@kept/core`'s own {@link isAmendmentId}, the
 * same grammar that mints it, so this file cannot drift into accepting a spelling
 * core would refuse. Before that, the segment is scanned for path separators, glob
 * metacharacters, `..`, percent escapes and null bytes, so a request that names a
 * *path* is refused with a reason that says so rather than with a generic parse
 * error. Nothing is percent-decoded, ever: `%2F` fails the grammar and that is the
 * end of it. The request body is drained and never read, so there is no second
 * place a filename could arrive from.
 *
 * **One method, one route.** `POST /accept/:id` and nothing else. Every other
 * method is `405` with an `Allow` header; every other path is `404`. There is no
 * handler to widen, because the route is a string comparison rather than a table.
 *
 * ## Exit code, and what is a state of the world
 *
 * {@link WatchResult.exitCode} is the literal `0` (§14.2). A port somebody else is
 * already using, a missing gate variable, a malformed request: all three are facts
 * about the machine the command was run on, and none of them is KEPT failing. The
 * same rule holds inside the listener: a stale amendment answers `200` carrying the
 * outcome, because the request was well formed and the interlock did its job.
 *
 * ## What performs the write
 *
 * `runAmend` with `subcommand: 'accept'`, which is the identical path
 * `kept amend accept <id>` takes: the sha256 interlock, the one mutated line, the
 * atomic rename, the rebuild §8.4 step 7 requires and the snapshot rewrite (R7.6).
 * There is no second implementation of acceptance in this file and there must never
 * be one, because two write paths would eventually disagree about the interlock.
 * Accepts are serialised through one promise chain so two clicks cannot interleave
 * two rebuilds over the same tree.
 */

import { createServer } from 'node:http';

import type {
  AtomicRenamer,
  CollectingDiagnosticSink,
  Diagnostic,
  KaneInvoker,
  StateFileSystem,
} from '@kept/core';
import { createDiagnosticSink, isAmendmentId } from '@kept/core';

import type { KeptConfig } from '../config.js';
import { runAmend } from './amend.js';

// ---------------------------------------------------------------------------
// The listener's whole surface, as constants
// ---------------------------------------------------------------------------

/**
 * The only host `kept watch` binds (§8.5).
 *
 * Not a default and not an option. There is no request, flag or environment
 * variable that can move it, and {@link runWatch} refuses to serve a listener whose
 * reported address is anything else.
 */
export const WATCH_HOST = '127.0.0.1';

/** The port §8.5 names. Fixed, so the Ledger's control knows where to knock. */
export const WATCH_PORT = 3199;

/** The gate. Its presence with this value is the only way anything is bound. */
export const WATCH_LOCAL_ENV_VAR = 'NEXT_PUBLIC_KEPT_LOCAL';

/** The one value the gate accepts. Anything else is treated as absent. */
export const WATCH_LOCAL_ENV_VALUE = '1';

/** The one method. */
export const WATCH_METHOD = 'POST';

/** The one route's prefix. The rest of the path is the amendment id. */
export const WATCH_ACCEPT_PREFIX = '/accept/';

/** The route as a reader sees it, for diagnostics and for the text output. */
export const WATCH_ROUTE = `${WATCH_METHOD} ${WATCH_ACCEPT_PREFIX}:id`;

/** Hosts that are the local machine and only the local machine. */
export const LOOPBACK_HOSTS: readonly string[] = Object.freeze([
  WATCH_HOST,
  '::1',
  '::ffff:127.0.0.1',
]);

/**
 * Is this address the local machine, and nothing else?
 *
 * `0.0.0.0` and `::` are the two spellings that matter: both mean every interface,
 * which is the one thing this listener must never be. Every other host is refused
 * too, because a listener that is not on loopback is not the listener §8.5
 * describes, whatever it is on.
 */
export function isLoopbackHost(host: string | null): boolean {
  return host !== null && LOOPBACK_HOSTS.includes(host);
}

/** Diagnostic codes this command reports. Stable; a test keys off them. */
export const WATCH_DIAGNOSTIC_CODES = Object.freeze({
  /** The listener is up, with the address it actually bound. */
  listening: 'watch-listening',
  /** No `NEXT_PUBLIC_KEPT_LOCAL=1`, so nothing was bound (§8.5). */
  notLocal: 'watch-not-local',
  /** Something else holds the port. A state of the world (§14.2). */
  addressInUse: 'watch-address-in-use',
  /** The bind failed for any other reason the transport reported. */
  listenFailed: 'watch-listen-failed',
  /** The listener reported a non-loopback address and was closed again. */
  notLoopback: 'watch-not-loopback',
  /** One accept ran, whatever its outcome. */
  accepted: 'watch-accepted',
  /** One request was refused: wrong method, wrong route, or not an id. */
  refused: 'watch-refused',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const WATCH_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(WATCH_DIAGNOSTIC_CODES),
);

// ---------------------------------------------------------------------------
// The request, the answer, and why a request is refused
// ---------------------------------------------------------------------------

/** Why one request was refused. Exactly these four. */
export const WATCH_REFUSALS = Object.freeze({
  /** Any method but {@link WATCH_METHOD}. */
  method: 'method-not-allowed',
  /** Any path but {@link WATCH_ACCEPT_PREFIX} plus one segment. */
  route: 'no-such-route',
  /** The segment carries a separator, a glob character, `..`, `%` or a null byte. */
  path: 'payload-names-a-path',
  /** The segment is clean and is still not an amendment id. */
  grammar: 'not-an-amendment-id',
} as const);

/** One refusal reason. */
export type WatchRefusal = (typeof WATCH_REFUSALS)[keyof typeof WATCH_REFUSALS];

/**
 * Characters that cannot appear in an amendment id and can appear in an attack.
 *
 * The grammar check below would reject every one of them anyway. They are scanned
 * for separately so the refusal can *say* a path was named, which is the difference
 * between a log line a reader learns something from and one they do not. Path
 * separators, the glob metacharacters, `..`, a percent escape (the encoded spelling
 * of a separator, which is never decoded here), a colon and a null byte.
 */
export const WATCH_PATHLIKE_PATTERN = /[/\\*?\[\]{}()!~%:\0]|\.\./;

/** Does this segment carry something that could name a path? */
export function namesAPath(segment: string): boolean {
  return WATCH_PATHLIKE_PATTERN.test(segment);
}

/** One request, reduced to the two things the accept path is allowed to read. */
export interface WatchIncoming {
  /** The HTTP method, verbatim. */
  readonly method: string;
  /** The request target, verbatim, query and fragment included. */
  readonly url: string;
}

/** The status codes this listener can answer with. Exactly these four. */
export type WatchStatus = 200 | 400 | 404 | 405;

/** One answer. Always JSON, always one of {@link WatchStatus}. */
export interface WatchAnswer {
  readonly status: WatchStatus;
  /** Response headers beyond the content type. `Allow` on a `405`, and nothing else. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** What one request target resolved to. Total: every string produces one. */
export interface WatchTarget {
  /** The path with any query and fragment removed. */
  readonly path: string;
  /** The segment after the prefix, verbatim and never decoded. Null off-route. */
  readonly segment: string | null;
  /** The validated amendment id, or null when the request was refused. */
  readonly id: string | null;
  /** Null when, and only when, {@link WatchTarget.id} is non-null. */
  readonly refusal: WatchRefusal | null;
}

/**
 * Resolve one request target to an amendment id, or to the reason it is not one.
 *
 * Exported because this is the injection surface of the whole feature, and a
 * function is testable in a way an inline branch inside a request handler is not.
 *
 * Nothing here decodes. The grammar admits `am_` and eight lowercase hex digits, so
 * every percent escape, every separator and every traversal fails it; the
 * {@link namesAPath} scan runs first only to give the refusal a better name.
 */
export function readAcceptTarget(url: string): WatchTarget {
  const path = url.split('?')[0]?.split('#')[0] ?? '';
  if (!path.startsWith(WATCH_ACCEPT_PREFIX)) {
    return { path, segment: null, id: null, refusal: WATCH_REFUSALS.route };
  }
  const segment = path.slice(WATCH_ACCEPT_PREFIX.length);
  if (segment.length === 0) {
    return { path, segment, id: null, refusal: WATCH_REFUSALS.route };
  }
  if (namesAPath(segment)) {
    return { path, segment, id: null, refusal: WATCH_REFUSALS.path };
  }
  // Core's own grammar, so this file cannot admit a spelling `readAmendment` would
  // then fail to find, and cannot fall behind if the grammar ever changes.
  if (!isAmendmentId(segment)) {
    return { path, segment, id: null, refusal: WATCH_REFUSALS.grammar };
  }
  return { path, segment, id: segment, refusal: null };
}

/** The sentence a refused request is answered with. */
export function refusalMessage(refusal: WatchRefusal): string {
  switch (refusal) {
    case WATCH_REFUSALS.method:
      return `${WATCH_ROUTE} is the only request this listener answers.`;
    case WATCH_REFUSALS.route:
      return `${WATCH_ROUTE} is the only route this listener has.`;
    case WATCH_REFUSALS.path:
      return (
        `The accept path takes an amendment id and nothing that could name a file. ` +
        `Nothing was read and nothing was written.`
      );
    default:
      return (
        `An amendment id is \`am_\` followed by eight lowercase hex digits. ` +
        `Nothing was read and nothing was written.`
      );
  }
}

// ---------------------------------------------------------------------------
// The listener seam
// ---------------------------------------------------------------------------

/** A host and port pair. */
export interface WatchAddress {
  readonly host: string;
  readonly port: number;
}

/** The handler a listener serves. One request in, one answer out, never a throw. */
export type WatchAcceptHandler = (incoming: WatchIncoming) => Promise<WatchAnswer>;

/** A bound, or unbound, listener. Absence is data: `address` is null on failure. */
export interface WatchListener {
  /** The address actually bound, as the transport reports it. Null on failure. */
  readonly address: WatchAddress | null;
  /** The transport's own words when nothing was bound. Null on success. */
  readonly error: string | null;
  close(): Promise<void>;
}

/**
 * The listener boundary, injected exactly as `doctor.ts` injects its URL probe.
 *
 * A test that binds a real port is a test that fails on a machine where something
 * else already holds it, and there is not one of those in this repository. So the
 * whole command runs with no socket: the fake receives the bind it was asked for and
 * the handler it was given, and the test drives the handler directly.
 */
export type WatchListenerFactory = (
  bind: WatchAddress,
  accept: WatchAcceptHandler,
) => Promise<WatchListener>;

/** `EADDRINUSE`, as the transport spells it. */
const ADDRESS_IN_USE = 'EADDRINUSE';

/**
 * The production listener: `node:http`, loopback, no new dependency.
 *
 * Three details are load-bearing. The bind is `{ host, port }` from the caller and
 * never a bare port, because `listen(port)` alone binds every interface. The address
 * is read back off the server rather than echoed from the request, so
 * {@link runWatch} checks what was actually bound. And the request body is drained
 * with `resume()` and never read, so the socket closes cleanly and there is no
 * second channel a filename could arrive through.
 */
export const nodeLoopbackListener: WatchListenerFactory = async (bind, accept) => {
  const server = createServer((incoming, response) => {
    // Drain and discard. The id is in the path; the body is not an input.
    incoming.resume();
    void accept({ method: incoming.method ?? '', url: incoming.url ?? '' }).then(
      (answer) => {
        response.writeHead(answer.status, {
          'content-type': 'application/json',
          ...answer.headers,
        });
        response.end(answer.body);
      },
      // The handler below is total, so this is unreachable by construction. It is
      // still answered rather than left hanging: a dropped connection is the least
      // legible failure a button can produce.
      () => {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(`${JSON.stringify({ ok: false })}\n`);
      },
    );
  });

  const error = await new Promise<string | null>((resolve) => {
    const onError = (failure: Error): void => {
      resolve(failure.message);
    };
    server.once('error', onError);
    server.listen({ host: bind.host, port: bind.port }, () => {
      server.removeListener('error', onError);
      resolve(null);
    });
  });

  const close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  };

  if (error !== null) {
    await close().catch(() => undefined);
    return { address: null, error, close: async () => undefined };
  }

  const bound = server.address();
  const address =
    bound === null || typeof bound === 'string'
      ? null
      : { host: bound.address, port: bound.port };
  return { address, error: null, close };
};

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/** Why nothing is listening. Null when something is. */
export const WATCH_START_REFUSALS = Object.freeze({
  /** The gate variable is absent or is not `1` (§8.5). */
  notLocal: 'not-local',
  /** Something else holds the port. */
  addressInUse: 'address-in-use',
  /** The bind failed for some other reason the transport reported. */
  listenFailed: 'listen-failed',
  /** A listener came back bound somewhere other than loopback, and was closed. */
  notLoopback: 'not-loopback',
} as const);

/** One reason nothing is listening. */
export type WatchStartRefusal =
  (typeof WATCH_START_REFUSALS)[keyof typeof WATCH_START_REFUSALS];

/** What {@link runWatch} did. */
export interface WatchResult {
  /** True when something is bound and serving. */
  readonly listening: boolean;
  /** The host actually bound, as the transport reported it. Null when unbound. */
  readonly host: string | null;
  /** The port actually bound. Null when unbound. */
  readonly port: number | null;
  /** The one route, so a caller can print what it is rather than guess. */
  readonly route: string;
  /** Whether the gate was set to `1`. False means nothing was ever bound. */
  readonly local: boolean;
  /** The gate's name, so a refusal message and a reader agree on it. */
  readonly envVar: string;
  /** Why nothing is listening. Null when {@link WatchResult.listening} is true. */
  readonly refusal: WatchStartRefusal | null;
  /** The transport's own words, when it had any. */
  readonly error: string | null;
  /**
   * Always `0`, as a type (§14.2). An occupied port, an absent gate variable and a
   * malformed request are states of the world, not failures of KEPT.
   */
  readonly exitCode: 0;
  readonly diagnostics: readonly Diagnostic[];
}

/** {@link runWatch}'s input. Every seam has a production default. */
export interface WatchRequest {
  /** Absolute repository root. `process.cwd()` is never substituted downstream. */
  readonly repoRoot: string;
  /** The config in force, handed to the accept path unchanged. */
  readonly config: KeptConfig;
  /** The environment the gate is read from. Never `process.env` by default. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The listener boundary. Defaults to {@link nodeLoopbackListener}. */
  readonly listen?: WatchListenerFactory | undefined;
  /** Reads and writes for the accept path. Defaults to `node:fs`. */
  readonly fileSystem?: StateFileSystem | undefined;
  /** The atomic rename acceptance finishes with (§8.4 step 5). */
  readonly rename?: AtomicRenamer | undefined;
  /** The Kane boundary the rebuild after an accept uses. Absence is supported. */
  readonly invoker?: KaneInvoker | undefined;
  readonly diagnostics?: CollectingDiagnosticSink | undefined;
  /**
   * The clock each accept is stamped with. A function rather than a fixed instant,
   * because a listener outlives the moment it started and an `appliedAt` copied
   * from start-up would be a small, plausible lie.
   */
  readonly now?: (() => string) | undefined;
}

/** A running, or refused, listener. */
export interface WatchHandle {
  readonly result: WatchResult;
  /**
   * The handler the listener was given, or null when nothing is listening.
   *
   * Exposed so a caller can drive the accept path with no socket, and so a test can
   * assert that what the listener serves is this exact function rather than a
   * reimplementation of it.
   */
  readonly accept: WatchAcceptHandler | null;
  /** Shut the listener down. Safe to call when nothing was ever bound. */
  close(): Promise<void>;
}

/**
 * Start the loopback accept listener.
 *
 * Never throws for a state of the world: a missing gate variable, an occupied port,
 * a transport that refuses the bind, a listener that comes back on the wrong
 * interface. Each is a refusal with a reason, each leaves nothing bound, and
 * {@link WatchResult.exitCode} is `0` in all of them.
 */
export async function runWatch(request: WatchRequest): Promise<WatchHandle> {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const now = request.now ?? ((): string => new Date().toISOString());

  const refused = (
    refusal: WatchStartRefusal,
    error: string | null,
    local: boolean,
  ): WatchHandle => ({
    result: {
      listening: false,
      host: null,
      port: null,
      route: WATCH_ROUTE,
      local,
      envVar: WATCH_LOCAL_ENV_VAR,
      refusal,
      error,
      exitCode: 0,
      diagnostics: sink.entries,
    },
    accept: null,
    close: async (): Promise<void> => undefined,
  });

  // ── The gate (§8.5). Without it, nothing is bound. Not idle: never bound. ──
  const local = request.env[WATCH_LOCAL_ENV_VAR] === WATCH_LOCAL_ENV_VALUE;
  if (!local) {
    sink.report({
      code: WATCH_DIAGNOSTIC_CODES.notLocal,
      severity: 'warn',
      message:
        `kept watch binds nothing without ${WATCH_LOCAL_ENV_VAR}=${WATCH_LOCAL_ENV_VALUE} in ` +
        `the environment, so no listener was started and no port was opened. The accept ` +
        `control in the Ledger copies \`kept amend accept <id>\` either way, which is the ` +
        `path that always works and the one the deployed build ships (design §8.5).`,
    });
    return refused(WATCH_START_REFUSALS.notLocal, null, false);
  }

  const accept = acceptHandler({
    repoRoot: request.repoRoot,
    config: request.config,
    sink,
    now,
    ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
    ...(request.rename === undefined ? {} : { rename: request.rename }),
    ...(request.invoker === undefined ? {} : { invoker: request.invoker }),
  });

  // The bind is this command's constants and nothing else. There is no parameter,
  // flag or environment variable that reaches it, which is what makes the loopback
  // guarantee a property of the code rather than of how it is called.
  const listen = request.listen ?? nodeLoopbackListener;
  const listener = await listen({ host: WATCH_HOST, port: WATCH_PORT }, accept);

  if (listener.address === null) {
    const inUse = (listener.error ?? '').includes(ADDRESS_IN_USE);
    sink.report({
      code: inUse
        ? WATCH_DIAGNOSTIC_CODES.addressInUse
        : WATCH_DIAGNOSTIC_CODES.listenFailed,
      severity: 'warn',
      message:
        `kept watch could not bind ${WATCH_HOST}:${WATCH_PORT}` +
        `${listener.error === null ? '' : ` (${listener.error})`}` +
        `. ${
          inUse
            ? 'Something else already holds that port, which is a fact about this machine ' +
              'rather than a failure of KEPT'
            : 'Nothing is listening'
        }: exit code 0, and \`kept amend accept <id>\` is unaffected (§14.2).`,
    });
    return refused(
      inUse ? WATCH_START_REFUSALS.addressInUse : WATCH_START_REFUSALS.listenFailed,
      listener.error,
      true,
    );
  }

  // ── The loopback assertion (§8.5). A wildcard bind is closed, not served. ──
  if (!isLoopbackHost(listener.address.host)) {
    await listener.close().catch(() => undefined);
    sink.report({
      code: WATCH_DIAGNOSTIC_CODES.notLoopback,
      severity: 'error',
      message:
        `kept watch asked for ${WATCH_HOST}:${WATCH_PORT} and the listener reported ` +
        `${listener.address.host}:${listener.address.port}, which is not loopback. It was ` +
        `closed again without answering a single request: a listener on any other interface ` +
        `is a write path reachable from the network, and that is the one thing this design ` +
        `exists to prevent (design §8.5, R8.4).`,
    });
    return refused(WATCH_START_REFUSALS.notLoopback, listener.error, true);
  }

  sink.report({
    code: WATCH_DIAGNOSTIC_CODES.listening,
    severity: 'info',
    message:
      `kept watch is listening on ${listener.address.host}:${listener.address.port}, serving ` +
      `${WATCH_ROUTE} and nothing else. It performs the same accept path as ` +
      `\`kept amend accept <id>\`, it adds no route to the Ledger, and it is unreachable from ` +
      `anywhere but this machine.`,
  });

  return {
    result: {
      listening: true,
      host: listener.address.host,
      port: listener.address.port,
      route: WATCH_ROUTE,
      local: true,
      envVar: WATCH_LOCAL_ENV_VAR,
      refusal: null,
      error: null,
      exitCode: 0,
      diagnostics: sink.entries,
    },
    accept,
    close: () => listener.close(),
  };
}

// ---------------------------------------------------------------------------
// The one handler
// ---------------------------------------------------------------------------

interface AcceptContext {
  readonly repoRoot: string;
  readonly config: KeptConfig;
  readonly sink: CollectingDiagnosticSink;
  readonly now: () => string;
  readonly fileSystem?: StateFileSystem | undefined;
  readonly rename?: AtomicRenamer | undefined;
  readonly invoker?: KaneInvoker | undefined;
}

/** One answer, serialised the one way this listener serialises anything. */
function answer(
  status: WatchStatus,
  payload: Readonly<Record<string, unknown>>,
  headers: Readonly<Record<string, string>> = {},
): WatchAnswer {
  return { status, headers, body: `${JSON.stringify(payload, null, 2)}\n` };
}

/**
 * Build the handler.
 *
 * Total: every method, every path and every segment produces an answer, and the
 * accept path itself is `runAmend`, which does not throw for a state of the world
 * either. Accepts are serialised through one chain, so two clicks on the same
 * amendment cannot interleave two rebuilds over one tree.
 */
function acceptHandler(context: AcceptContext): WatchAcceptHandler {
  let queue: Promise<unknown> = Promise.resolve();

  const refuse = (
    refusal: WatchRefusal,
    incoming: WatchIncoming,
    status: WatchStatus,
    headers: Readonly<Record<string, string>> = {},
  ): WatchAnswer => {
    context.sink.report({
      code: WATCH_DIAGNOSTIC_CODES.refused,
      severity: 'warn',
      message:
        `kept watch refused ${incoming.method} ${incoming.url} with ${status} ` +
        `(${refusal}). ${refusalMessage(refusal)}`,
    });
    return answer(status, { ok: false, refusal, message: refusalMessage(refusal) }, headers);
  };

  return async (incoming) => {
    // One method. Checked first, so a GET to the right route is a 405 rather than a
    // report about the id it happened to carry.
    if (incoming.method !== WATCH_METHOD) {
      return refuse(WATCH_REFUSALS.method, incoming, 405, { allow: WATCH_METHOD });
    }

    const target = readAcceptTarget(incoming.url);
    if (target.id === null) {
      const refusal = target.refusal ?? WATCH_REFUSALS.route;
      return refuse(refusal, incoming, refusal === WATCH_REFUSALS.route ? 404 : 400);
    }
    const id = target.id;

    const run = queue.then(() =>
      runAmend({
        repoRoot: context.repoRoot,
        config: context.config,
        subcommand: 'accept',
        id,
        diagnostics: context.sink,
        at: context.now(),
        ...(context.fileSystem === undefined ? {} : { fileSystem: context.fileSystem }),
        ...(context.rename === undefined ? {} : { rename: context.rename }),
        ...(context.invoker === undefined ? {} : { invoker: context.invoker }),
      }),
    );
    // The chain survives a rejection, so one failed accept cannot wedge the queue.
    queue = run.catch(() => undefined);
    const result = await run;

    const accepted = result.accepted;
    context.sink.report({
      code: WATCH_DIAGNOSTIC_CODES.accepted,
      severity: 'info',
      message:
        `kept watch accepted ${id} through the same path as \`kept amend accept ${id}\`: ` +
        `outcome ${accepted?.outcome ?? 'unreported'}, ` +
        `${accepted?.applied === true ? 'one line written' : 'no document byte written'}, ` +
        `graph ${result.rebuilt ? 'rebuilt' : 'unchanged'} (§8.4 step 7, R7.6).`,
    });

    // 200 even for `stale`: the request was well formed and the interlock did its
    // job, which is an outcome to report rather than an error to signal (§14.2).
    return answer(200, {
      ok: accepted?.applied === true,
      id,
      outcome: accepted?.outcome ?? null,
      applied: accepted?.applied ?? false,
      successorPromiseId: accepted?.successorPromiseId ?? null,
      rebuilt: result.rebuilt,
      snapshot:
        result.snapshot === null
          ? null
          : { path: result.snapshot.path, written: result.snapshot.written },
    });
  };
}
