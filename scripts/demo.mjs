#!/usr/bin/env node
/**
 * `npm run demo` — the judge path (design §15.1, R13.1–R13.3).
 *
 * Boots both Next applications and forwards their output under a label, so the
 * thirty seconds a judge has are spent reading two URLs rather than two
 * terminals. It starts no other process, reads no credential, and opens no
 * socket beyond the two localhost listeners Next itself opens.
 *
 * Four constraints shape every decision below.
 *
 * 1. **Zero dependencies.** The runtime budget is closed at the nine packages of
 *    design §2.2, and neither `concurrently` nor a colour library is among them.
 *    The prefixing, the line buffering, the label padding and the shutdown are
 *    hand-rolled against `node:child_process` and nothing else.
 * 2. **Zero Kane invocations (R13.2).** The demo consumes no credits because it
 *    starts no Kane process. That is not left to inspection: every spawn this
 *    file performs goes through `assertNoKaneInvocation`, which throws on an
 *    argv naming a Kane binary. A future edit that reached for `kane-cli` here
 *    would fail loudly at the spawn rather than quietly on the judge's bill.
 * 3. **The ports are load-bearing.** The Ledger answers on 3000 because that is
 *    the URL the README and the deployed build advertise; the fixture answers on
 *    3100 because every designed Kane test in `tests/` navigates there. Swapping
 *    them does not inconvenience a reader, it invalidates the test corpus.
 * 4. **`apps/ledger` has no `package.json`, deliberately.** It inherits the
 *    root manifest's `"type": "module"` and is deployed with the monorepo root
 *    as its install directory (design §15.2), so there is no `npm run dev -w …`
 *    to lean on for it. Both applications are therefore started the same way:
 *    the workspace-root `next` binary, executed by this process's own Node with
 *    the application directory as its working directory. That spelling also
 *    dodges the shebang and executable-bit questions a direct `.bin/next` spawn
 *    would raise, and it needs no shell, so nothing is word-split or globbed.
 *
 * The module is importable: `main()` runs only when this file is the entry
 * point, and the pieces below are exported so `packages/kept-core/test/demo-script.test.ts`
 * can assert the ports, the argv, the line framing and the Kane guard without
 * starting a server that never exits.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The workspace root: this file lives in `scripts/`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The two applications, in the order a judge meets them.
 *
 * The Ledger is first because it is the deliverable; the fixture is the thing
 * the Ledger makes claims about. Both entries carry the port as a number so a
 * test can compare it to the corpus rather than to a formatted string.
 */
export const SERVICES = [
  {
    label: 'ledger',
    directory: 'apps/ledger',
    port: 3000,
    description: 'the promise ledger — every figure from the committed snapshot',
  },
  {
    label: 'fixture',
    directory: 'apps/fixture',
    port: 3100,
    description: 'Kepler Coffee — the application under test',
  },
];

/** Argv for one service. `next dev -p <port>`, nothing else. */
export function nextArgv(service) {
  return ['dev', '-p', String(service.port)];
}

/** `http://localhost:<port>` — the only host this command ever names (R13.3). */
export function serviceUrl(service) {
  return `http://localhost:${service.port}`;
}

/**
 * Names of a Kane binary, in the spellings `kept-core`'s invoker resolves.
 *
 * Matched against whole argv elements rather than as a substring, so a path that
 * merely contains the letters — a directory called `kane-evidence`, say — is not
 * mistaken for the executable.
 */
const KANE_BINARIES = new Set(['kane', 'kane-cli', 'kane.cmd', 'kane-cli.cmd']);

function namesKaneBinary(value) {
  if (typeof value !== 'string') return false;
  const basename = value.split(/[\\/]/).pop() ?? '';
  return KANE_BINARIES.has(basename.toLowerCase());
}

/**
 * The R13.2 guard: throws unless the spawn about to happen is Kane-free.
 *
 * Checks the command and every argument, because `kane-cli` can arrive as the
 * executable, as the first argument to a Node shim, or as a subcommand handed to
 * a wrapper. The demo path has no legitimate reason to name it in any of those
 * positions.
 */
export function assertNoKaneInvocation(command, argv) {
  const offender = [command, ...argv].find(namesKaneBinary);
  if (offender !== undefined) {
    throw new Error(
      `npm run demo must invoke Kane zero times (R13.2) and consume zero credits, ` +
        `but a spawn named "${offender}". The live loop is npm run loop, documented ` +
        `with its prerequisites; the demo path reads the committed snapshot.`,
    );
  }
}

/**
 * The workspace-root `next` entry point, as a file for Node to execute.
 *
 * `node_modules/.bin/next` is a symlink to the same file; the real path is used
 * so nothing depends on the link, on the executable bit, or on a shell being
 * present to read the shebang.
 */
export function resolveNextBinary(root = REPO_ROOT) {
  const binary = resolve(root, 'node_modules/next/dist/bin/next');
  if (!existsSync(binary)) {
    throw new Error(
      `Could not find Next at ${binary}. Run npm ci at the repository root first — ` +
        `the demo installs nothing, on purpose.`,
    );
  }
  return binary;
}

/** Label column width, so both prefixes line up whatever the names are. */
export function labelWidth(services = SERVICES) {
  return services.reduce((widest, service) => Math.max(widest, service.label.length), 0);
}

/**
 * A stateful line framer.
 *
 * A child's stdout arrives in chunks that split wherever the pipe buffer
 * happened to fill, which is not where the lines end. Writing each chunk with a
 * prefix would put a label in the middle of a sentence, so partial lines are
 * held until their newline arrives and `end()` flushes whatever is left when the
 * stream closes. Carriage returns are dropped from line ends so a CRLF stream
 * does not print an empty column, and a trailing empty segment produces no
 * output rather than a bare prefix.
 *
 * `sink` receives complete, newline-terminated strings.
 */
export function createPrefixer(label, sink, width = label.length) {
  const prefix = `[${label.padEnd(width)}] `;
  let pending = '';
  return {
    write(chunk) {
      pending += chunk;
      const segments = pending.split('\n');
      pending = segments.pop() ?? '';
      for (const segment of segments) {
        sink(`${prefix}${segment.replace(/\r$/, '')}\n`);
      }
    },
    end() {
      if (pending === '') return;
      sink(`${prefix}${pending.replace(/\r$/, '')}\n`);
      pending = '';
    },
  };
}

/**
 * The banner, printed before the servers are ready.
 *
 * Both URLs are stated up front and unconditionally: Next prints its own ready
 * line eventually, but a judge should not have to wait for it to know where to
 * look. The Kane and credential claims are printed too, because the absence of a
 * step is the feature here and an absent step is invisible.
 */
export function banner(services = SERVICES) {
  const width = labelWidth(services);
  const lines = ['', 'KEPT demo — two local servers, no Kane, no credentials, no network.', ''];
  for (const service of services) {
    lines.push(`  ${service.label.padEnd(width)}  ${serviceUrl(service)}  ${service.description}`);
  }
  lines.push('', '  Ctrl-C stops both. The live Kane loop is a separate command: npm run loop.', '');
  return lines.join('\n');
}

/* ────────────────────────────── the runtime half ───────────────────────────── */

function startService(service, width) {
  const binary = resolveNextBinary();
  const argv = [binary, ...nextArgv(service)];
  assertNoKaneInvocation(process.execPath, argv);

  const child = spawn(process.execPath, argv, {
    cwd: resolve(REPO_ROOT, service.directory),
    /* No shell, so nothing is re-parsed. stdin is ignored: neither server reads
       it, and leaving it inherited would let one of them swallow the Ctrl-C. */
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  const out = createPrefixer(service.label, (line) => process.stdout.write(line), width);
  const err = createPrefixer(service.label, (line) => process.stderr.write(line), width);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => out.write(chunk));
  child.stderr.on('data', (chunk) => err.write(chunk));
  child.on('close', () => {
    out.end();
    err.end();
  });
  return child;
}

function main() {
  const width = labelWidth();
  process.stdout.write(`${banner()}\n`);

  const children = SERVICES.map((service) => ({ service, child: startService(service, width) }));
  let shuttingDown = false;

  /**
   * One shutdown path for every reason to stop: Ctrl-C, a TERM, or either
   * server exiting on its own — a taken port most likely, and half a demo is
   * more confusing than none. Children get SIGINT rather than SIGKILL so Next
   * removes its own sockets, and the flag makes the path idempotent, since a
   * second Ctrl-C while the first is in flight would otherwise re-enter it.
   */
  const shutdown = (reason, code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\n${reason}\n`);
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGINT');
    }
    process.exitCode = code;
  };

  process.on('SIGINT', () => shutdown('Stopping both servers.', 0));
  process.on('SIGTERM', () => shutdown('Stopping both servers.', 0));

  for (const { service, child } of children) {
    child.on('error', (error) => {
      shutdown(`${service.label} failed to start: ${error.message}`, 1);
    });
    child.on('exit', (code, signal) => {
      if (shuttingDown) return;
      const how = signal === null ? `exit code ${code}` : `signal ${signal}`;
      shutdown(
        `${service.label} stopped on its own (${how}) — is ${serviceUrl(service)} already in use? ` +
          `Stopping the other server too.`,
        code === 0 ? 0 : 1,
      );
    });
  }
}

/**
 * Run only as a command. Imported — by the unit test, or by anything else — this
 * module starts nothing, which is what makes the pieces above testable at all.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) main();
