import { describe, expect, it } from 'vitest';

import {
  COMMAND_FAMILIES,
  contractFor,
  familyForArgv,
  isCommandFamily,
  type CommandFamily,
  type FamilyContract,
  type TerminalType,
} from 'kept-core';

/**
 * The four family-dependent facts, restated here independently of the source so
 * that a change to `CONTRACTS` has to be a deliberate change to this table too
 * (design §4.1, A10, A14).
 */
const EXPECTED = {
  ExecutionRun: {
    terminalType: 'run_end',
    ndjson: 'agent-flag',
    exit3: 'timeout-or-cancelled',
    evidence: 'session-dir',
    commands: [['run'], ['testmd', 'run']],
  },
  ExecutionTestrun: {
    terminalType: 'testrun_done',
    ndjson: 'piped-stdout',
    exit3: 'timeout-or-cancelled',
    evidence: 'cwd-testmuai',
    commands: [['testrun', 'run']],
  },
  Assurance: {
    terminalType: 'done',
    ndjson: 'mode-agent',
    exit3: 'paused-resumable',
    evidence: 'none',
    commands: [
      ['context', 'extract'],
      // `context list` is deliberately absent. It has no `--mode` flag (its own
      // `--help`), its `--json` output is one plain object per line rather than
      // the `{type,v,verb}` envelope, and it never emits `done` — so it carries
      // none of the four facts this table holds. Listing it here made the invoker
      // append `--mode agent`, which Kane rejects at exit 1 with an empty stdout.
      ['design', 'tests'],
      ['maintain', 'reconcile'],
      ['maintain', 'evolve'],
      ['cover'],
      ['cover', 'gaps'],
    ],
  },
} as const;

describe('CommandFamily vocabulary', () => {
  it('has exactly the three families Kane 0.8.4 exposes', () => {
    expect([...COMMAND_FAMILIES]).toEqual(['ExecutionRun', 'ExecutionTestrun', 'Assurance']);
  });

  it('guards the vocabulary at a boundary', () => {
    for (const family of COMMAND_FAMILIES) expect(isCommandFamily(family)).toBe(true);
    for (const bogus of ['Execution', 'assurance', '', 'toString', null, undefined, 3, {}]) {
      expect(isCommandFamily(bogus)).toBe(false);
    }
  });
});

describe('contractFor — the only way to obtain a contract', () => {
  it('is total over every family, and the table covers all three exhaustively', () => {
    const covered = COMMAND_FAMILIES.map((family) => contractFor(family).family);
    expect(covered).toEqual([...COMMAND_FAMILIES]);
    expect(Object.keys(EXPECTED).sort()).toEqual([...COMMAND_FAMILIES].sort());
  });

  it.each([...COMMAND_FAMILIES])('encodes all four facts once for %s', (family) => {
    const contract = contractFor(family);
    const expected = EXPECTED[family];

    expect(contract.terminalType).toBe(expected.terminalType);
    expect(contract.ndjson).toBe(expected.ndjson);
    expect(contract.exit3).toBe(expected.exit3);
    expect(contract.evidence).toBe(expected.evidence);
    expect(contract.commands.map((c) => [...c])).toEqual(expected.commands.map((c) => [...c]));
  });

  it('returns the one shared frozen instance per family', () => {
    const first = contractFor('Assurance');
    expect(contractFor('Assurance')).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.commands)).toBe(true);
    expect(first.commands.every((command) => Object.isFrozen(command))).toBe(true);
  });

  it('never returns `failure` semantics for Assurance exit 3 — a pause is resumable', () => {
    expect(contractFor('Assurance').exit3).toBe('paused-resumable');
    expect(contractFor('ExecutionRun').exit3).toBe('timeout-or-cancelled');
    expect(contractFor('ExecutionTestrun').exit3).toBe('timeout-or-cancelled');
  });

  it('throws for a family outside the vocabulary — a programming error, not a state of the world', () => {
    expect(() => contractFor('ExecutionRunn' as CommandFamily)).toThrow(TypeError);
  });
});

describe('TerminalType<F> narrows to a literal, not a union', () => {
  it('narrows per family at compile time', () => {
    // These annotations are the assertion: `tsc -b` type-checks this file, so a
    // widened `terminalType` fails the build rather than a test.
    const run: 'run_end' = contractFor('ExecutionRun').terminalType;
    const testrun: 'testrun_done' = contractFor('ExecutionTestrun').terminalType;
    const assurance: 'done' = contractFor('Assurance').terminalType;
    expect([run, testrun, assurance]).toEqual(['run_end', 'testrun_done', 'done']);

    const alsoRunEnd: TerminalType<'ExecutionRun'> = 'run_end';
    expect(alsoRunEnd).toBe('run_end');
  });

  it('rejects the wrong literal for a family', () => {
    // @ts-expect-error — ExecutionRun terminates `run_end`, never `done`
    const wrong: 'done' = contractFor('ExecutionRun').terminalType;
    expect(wrong).toBe('run_end');
  });
});

describe('FamilyContract has no public constructor', () => {
  /** Stands in for `parseStream(contract, lines)` — the real gate (design §4.2). */
  const needsContract = <F extends CommandFamily>(contract: FamilyContract<F>): F => contract.family;

  it('accepts a contract obtained from contractFor', () => {
    expect(needsContract(contractFor('ExecutionTestrun'))).toBe('ExecutionTestrun');
  });

  it('rejects a structurally identical object literal', () => {
    const impostor = {
      family: 'ExecutionRun',
      terminalType: 'run_end',
      ndjson: 'agent-flag',
      exit3: 'timeout-or-cancelled',
      evidence: 'session-dir',
      commands: [['run']],
    } as const;

    // @ts-expect-error — the module-private brand is unsatisfiable from outside
    expect(() => needsContract(impostor)).not.toThrow();
  });

  it('rejects a bare family string where a contract is expected', () => {
    // @ts-expect-error — a family name is not a contract; parsing needs the contract
    expect(needsContract('ExecutionRun')).toBeUndefined();
  });
});

describe('familyForArgv — the reverse lookup', () => {
  it('resolves every command in the table back to its own family', () => {
    for (const family of COMMAND_FAMILIES) {
      for (const command of contractFor(family).commands) {
        expect(familyForArgv([...command])).toBe(family);
      }
    }
  });

  it.each([
    [['run', 'check the cart subtotal'], 'ExecutionRun'],
    [['testmd', 'run', 'tests/cart_subtotal_test.md'], 'ExecutionRun'],
    [['testrun', 'run', '--from-context', 'T-1,T-2', '--on-failure', 'continue'], 'ExecutionTestrun'],
    [['testrun', 'run', '--dry-run'], 'ExecutionTestrun'],
    [['context', 'extract'], 'Assurance'],
    [['design', 'tests', '--use-case', 'UC-1'], 'Assurance'],
    [['maintain', 'reconcile', '--from', 'README.md', '--source-id', 'S-1', '--plan'], 'Assurance'],
    [['maintain', 'evolve', 'UC-1'], 'Assurance'],
    [['cover', '--json'], 'Assurance'],
    [['cover', 'gaps', 'UC-1'], 'Assurance'],
  ] as const)('classifies %j', (argv, family) => {
    expect(familyForArgv([...argv])).toBe(family);
  });

  it('resolves multi-word verbs before single-word ones', () => {
    // `testrun run` must not fall through to ExecutionRun's `run`, and
    // `cover gaps` must not be read as bare `cover` with a stray argument.
    expect(familyForArgv(['testrun', 'run'])).toBe('ExecutionTestrun');
    expect(familyForArgv(['run'])).toBe('ExecutionRun');
    expect(familyForArgv(['cover', 'gaps'])).toBe('Assurance');
    expect(familyForArgv(['testmd', 'run'])).toBe('ExecutionRun');
  });

  it('never mistakes a flag value for a verb', () => {
    expect(familyForArgv(['testrun', 'run', '--match', 'run'])).toBe('ExecutionTestrun');
    expect(familyForArgv(['cover', '--from', 'cover'])).toBe('Assurance');
  });

  it('tolerates a leading binary token', () => {
    expect(familyForArgv(['kane-cli', 'cover', '--json'])).toBe('Assurance');
    expect(familyForArgv(['/opt/homebrew/bin/kane-cli', 'testrun', 'run'])).toBe('ExecutionTestrun');
  });

  it('returns null — never a default family — for argv it cannot classify', () => {
    const unclassifiable: readonly string[][] = [
      [],
      ['--version'], // `kept doctor`
      ['--agent'],
      ['context', 'ingest', 'apps/fixture/README.md', '--mode', 'ci'], // never invoked with a family
      // Nor is this one: `context list --json` is a plain JSON-lines listing with
      // no `--mode` flag and no terminal event, so it goes through `invokePlain`.
      ['context', 'list', '--type', 'source', '--json'],
      ['evidence', 'serve', '.testmuai/evidence/pack'],
      ['generate'],
      ['doctor'],
      ['balance'],
      ['covers'],
      ['Cover'], // case-sensitive: a wrong-case verb is a mistake, not a synonym
      ['testrun'], // `testrun` alone has no terminal contract
      ['maintain'],
      ['context'],
      [''],
      ['   '],
    ];

    for (const argv of unclassifiable) expect(familyForArgv(argv)).toBeNull();
  });

  it('is defensive at the boundary rather than throwing', () => {
    expect(familyForArgv(undefined as unknown as string[])).toBeNull();
    expect(familyForArgv(['cover', undefined as unknown as string])).toBe('Assurance');
    expect(familyForArgv([undefined as unknown as string, 'cover'])).toBeNull();
  });
});

describe('the argv index is unambiguous', () => {
  const all = COMMAND_FAMILIES.flatMap((family) =>
    contractFor(family).commands.map((command) => ({ family, key: command.join(' ') })),
  );

  it('lists no command twice', () => {
    expect(new Set(all.map((entry) => entry.key)).size).toBe(all.length);
  });

  it('has no command that is a verb-prefix of another family’s command', () => {
    for (const a of all) {
      for (const b of all) {
        if (a.family === b.family || a.key === b.key) continue;
        expect(b.key.startsWith(`${a.key} `)).toBe(false);
      }
    }
  });
});
