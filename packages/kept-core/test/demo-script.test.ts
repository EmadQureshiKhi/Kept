/**
 * `npm run demo` — the judge path, in unit form (design §15.1, R13.1–R13.3).
 *
 * `scripts/demo.mjs` cannot be tested by running it: `next dev` never exits, so
 * a test that started it would hang the suite. What it can do is export its
 * decisions — the ports, the argv, the line framing, the Kane guard — and let
 * them be asserted with no server anywhere. That is why the script's `main()` is
 * gated on being the entry point, and this file's first assertion is that
 * importing it starts nothing.
 *
 * Three claims here are load-bearing rather than incidental:
 *
 *   1. **The fixture port matches the designed test corpus.** All eight
 *      `tests/*_test.md` files navigate to `http://localhost:3100`. If the demo
 *      moved the fixture, every designed Kane test would target a dead socket
 *      and the whole verification story would go quiet without a single test
 *      going red. So the port is read back out of the corpus and compared.
 *   2. **Zero Kane invocations is mechanical, not asserted by reading.** R13.2
 *      is a claim about credits, and the script routes every spawn through
 *      `assertNoKaneInvocation`. Both directions of that guard are tested.
 *   3. **Zero dependencies is checked at the import list.** The runtime budget
 *      of design §2.2 is closed, so the script's every import must be a Node
 *      builtin. A `concurrently` added later fails this file.
 *
 * This suite lives in `packages/kept-core/test/` rather than beside the script
 * because it needs a Node environment and a home inside `tsc -b`'s include list,
 * and this is the workspace's node-environment suite. Nothing here touches
 * `kept-core` itself; the location is about the runner, not the subject.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SERVICES,
  assertNoKaneInvocation,
  banner,
  createPrefixer,
  labelWidth,
  nextArgv,
  resolveNextBinary,
  serviceUrl,
  type DemoService,
} from '../../../scripts/demo.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCRIPT_PATH = resolve(REPO_ROOT, 'scripts/demo.mjs');
const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, 'utf8');

/** The Ledger on 3000, the fixture on 3100 — both by name, so a swap is loud. */
function service(label: string): DemoService {
  const found = SERVICES.find((candidate) => candidate.label === label);
  expect(found, `no service labelled "${label}" — has the demo dropped an app?`).toBeDefined();
  return found as DemoService;
}

describe('the demo command boots exactly two applications', () => {
  it('starts nothing on import, so this suite can exist at all', () => {
    expect(SCRIPT_SOURCE).toContain('if (invokedDirectly) main();');
    expect(SERVICES.length).toBe(2);
    expect(SERVICES.map((entry) => entry.label)).toEqual(['ledger', 'fixture']);
  });

  it('puts the Ledger on the port the README and the deployment advertise', () => {
    expect(service('ledger').port).toBe(3000);
    expect(service('ledger').directory).toBe('apps/ledger');
    expect(serviceUrl(service('ledger'))).toBe('http://localhost:3000');
  });

  it('puts the fixture on the port every designed test navigates to', () => {
    const fixture = service('fixture');
    expect(fixture.directory).toBe('apps/fixture');

    const corpus = readdirSync(resolve(REPO_ROOT, 'tests')).filter((name) =>
      name.endsWith('_test.md'),
    );
    expect(corpus.length, 'the designed test corpus is empty; nothing to agree with').toBeGreaterThan(
      0,
    );

    // Split by what the document cites, not by what it happens to contain.
    //
    // Until task 26.1 every corpus document verified a claim in the fixture's README,
    // so "names the fixture's port" and "names a port the demo serves" were the same
    // sentence. They are not any more: three documents verify claims in *this
    // repository's* README (§23.1, R19.1), and two of those claims are about the
    // Ledger and the demo command rather than about Kepler Coffee, so they navigate to
    // 3000. Requiring 3100 of them would be requiring a test to target the wrong
    // application. What the clause is actually for survives intact either way: a
    // designed test must name a socket `scripts/demo.mjs` brings up, or it targets
    // nothing while staying green.
    const demoOrigins = SERVICES.map((entry) => serviceUrl(entry));
    let fixtureCited = 0;
    for (const name of corpus) {
      const text = readFileSync(resolve(REPO_ROOT, 'tests', name), 'utf8');
      const citesFixture = /@verifies\s+apps\/fixture\//.test(text);
      if (citesFixture) {
        fixtureCited += 1;
        expect(
          text,
          `${name} verifies a fixture claim and does not navigate to the fixture's demo ` +
            `port. The corpus and scripts/demo.mjs must name the same socket, or every ` +
            `designed test targets nothing while staying green.`,
        ).toContain(`http://localhost:${fixture.port}`);
        continue;
      }
      expect(
        demoOrigins.some((origin) => text.includes(origin)),
        `${name} navigates to no origin the demo command serves (${demoOrigins.join(', ')}), ` +
          `so it targets nothing while staying green.`,
      ).toBe(true);
    }
    // The fixture corpus is still the bulk of it, so the clause above is not vacuous.
    expect(fixtureCited).toBeGreaterThanOrEqual(8);
  });

  it('runs next dev with the port and nothing else', () => {
    expect(nextArgv(service('ledger'))).toEqual(['dev', '-p', '3000']);
    expect(nextArgv(service('fixture'))).toEqual(['dev', '-p', '3100']);
  });

  it('resolves the workspace-root Next entry point, and says so when it cannot', () => {
    expect(resolveNextBinary()).toBe(resolve(REPO_ROOT, 'node_modules/next/dist/bin/next'));
    expect(() => resolveNextBinary(resolve(REPO_ROOT, 'scripts'))).toThrow(/npm ci/);
  });
});

describe('the demo command invokes Kane zero times (R13.2)', () => {
  it('refuses a spawn that names a Kane binary, in any position', () => {
    for (const argv of [
      ['kane-cli', 'run', 'tests/home_cta_test.md'],
      ['/opt/homebrew/bin/kane-cli', '--agent'],
      ['kane', 'testrun'],
      ['/usr/local/bin/kane'],
    ]) {
      expect(
        () => assertNoKaneInvocation(process.execPath, argv),
        `the guard let through: ${argv.join(' ')}`,
      ).toThrow(/zero times/);
    }
    expect(() => assertNoKaneInvocation('kane-cli', [])).toThrow(/zero times/);
  });

  it('permits the two spawns the demo actually performs', () => {
    const binary = resolveNextBinary();
    for (const entry of SERVICES) {
      expect(() =>
        assertNoKaneInvocation(process.execPath, [binary, ...nextArgv(entry)]),
      ).not.toThrow();
    }
  });

  it('does not mistake a path that merely contains the letters for the binary', () => {
    expect(() =>
      assertNoKaneInvocation(process.execPath, [
        '/work/kane-evidence/next/dist/bin/next',
        'dev',
        '-p',
        '3000',
      ]),
    ).not.toThrow();
  });

  it('imports Node builtins only, so the runtime budget stays closed', () => {
    const specifiers = [...SCRIPT_SOURCE.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map(
      (match) => match[1] ?? '',
    );
    expect(specifiers.length, 'no import found at all — did the script move?').toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(
        specifier.startsWith('node:'),
        `scripts/demo.mjs imports "${specifier}". The demo has zero dependencies by ` +
          `design (§2.2): no concurrently, no colour library, no process manager.`,
      ).toBe(true);
    }
  });
});

describe('output is forwarded under a label, one whole line at a time', () => {
  function collect(label: string, width?: number): { lines: string[]; prefixer: ReturnType<typeof createPrefixer> } {
    const lines: string[] = [];
    return { lines, prefixer: createPrefixer(label, (line) => lines.push(line), width) };
  }

  it('holds a partial line until its newline arrives', () => {
    const { lines, prefixer } = collect('ledger');
    prefixer.write('ready in 1');
    expect(lines).toEqual([]);
    prefixer.write('.2s\nLocal: http');
    expect(lines).toEqual(['[ledger] ready in 1.2s\n']);
    prefixer.write('://localhost:3000\n');
    expect(lines).toEqual(['[ledger] ready in 1.2s\n', '[ledger] Local: http://localhost:3000\n']);
  });

  it('emits several lines from one chunk and nothing from a bare newline tail', () => {
    const { lines, prefixer } = collect('fixture');
    prefixer.write('one\ntwo\n');
    prefixer.end();
    expect(lines).toEqual(['[fixture] one\n', '[fixture] two\n']);
  });

  it('flushes an unterminated last line when the stream closes', () => {
    const { lines, prefixer } = collect('ledger');
    prefixer.write('crashed without a newline');
    prefixer.end();
    expect(lines).toEqual(['[ledger] crashed without a newline\n']);
    prefixer.end();
    expect(lines.length).toBe(1);
  });

  it('does not print an empty column for a CRLF stream', () => {
    const { lines, prefixer } = collect('ledger');
    prefixer.write('windows\r\nnext\r\n');
    expect(lines).toEqual(['[ledger] windows\n', '[ledger] next\n']);
  });

  it('pads both labels to one column width', () => {
    const width = labelWidth();
    expect(width).toBe('fixture'.length);
    const { lines, prefixer } = collect('ledger', width);
    prefixer.write('aligned\n');
    expect(lines).toEqual(['[ledger ] aligned\n']);
  });
});

describe('both URLs are printed before either server is ready', () => {
  const printed = banner();

  it('names each application and its localhost URL', () => {
    for (const entry of SERVICES) {
      expect(printed).toContain(serviceUrl(entry));
      expect(printed).toContain(entry.description);
    }
  });

  it('names no host beyond localhost (R13.3)', () => {
    const hosts = [...printed.matchAll(/https?:\/\/([^\s/]+)/g)].map((match) => match[1] ?? '');
    expect(hosts.length).toBe(SERVICES.length);
    for (const host of hosts) {
      expect(host.split(':')[0]).toBe('localhost');
    }
  });

  it('tells the reader how to stop, and where the live loop lives instead', () => {
    expect(printed).toContain('Ctrl-C');
    expect(printed).toContain('npm run loop');
  });
});
