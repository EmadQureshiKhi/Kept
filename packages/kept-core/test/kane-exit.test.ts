import { describe, expect, it } from 'vitest';

import {
  COMMAND_FAMILIES,
  EXIT_FORCE_INTERRUPTED,
  EXIT_KANE_NOT_FOUND,
  EXIT_MEANINGS,
  EXIT_PAUSED_OR_TIMEOUT,
  EXIT_PREFLIGHT_REJECTED,
  EXIT_SUCCESS,
  WRITE_PERMITTING_EXIT_MEANINGS,
  contractFor,
  exitMeaning,
  isExitMeaning,
  permitsVerdictWrite,
  type CommandFamily,
  type ExitMeaning,
} from 'kept-core';

/**
 * Design §4.5's table, restated independently of the source so that changing
 * `exitMeaning` has to be a deliberate change to this table too (A14, R3.15).
 */
const TABLE: readonly (readonly [number | null, ExitMeaning, ExitMeaning, ExitMeaning])[] = [
  //  code, ExecutionRun,           ExecutionTestrun,      Assurance
  [0, 'success', 'success', 'success'],
  [1, 'failure', 'failure', 'failure'],
  [2, 'failure', 'preflight-rejected', 'failure'],
  [3, 'timeout-or-cancelled', 'timeout-or-cancelled', 'paused-resumable'],
  [4, 'failure', 'failure', 'failure'],
  [127, 'kane-not-found', 'kane-not-found', 'kane-not-found'],
  [130, 'force-interrupted', 'force-interrupted', 'force-interrupted'],
  [143, 'failure', 'failure', 'failure'],
  [255, 'failure', 'failure', 'failure'],
  [-1, 'failure', 'failure', 'failure'],
  [null, 'force-interrupted', 'force-interrupted', 'force-interrupted'],
];

const columnFor = (family: CommandFamily): 1 | 2 | 3 =>
  family === 'ExecutionRun' ? 1 : family === 'ExecutionTestrun' ? 2 : 3;

describe('exitMeaning — design §4.5 table', () => {
  it.each([...COMMAND_FAMILIES])('maps every named code for %s', (family) => {
    const column = columnFor(family);
    for (const row of TABLE) {
      expect(exitMeaning(family, row[0], false)).toBe(row[column]);
    }
  });

  it('reads exit 3 from the family contract rather than re-deriving it', () => {
    for (const family of COMMAND_FAMILIES) {
      expect(exitMeaning(family, EXIT_PAUSED_OR_TIMEOUT, false)).toBe(contractFor(family).exit3);
    }
  });

  it('never lets an Assurance pause read as a failure or a timeout', () => {
    // The one misreading that would overwrite good verdicts with red ones.
    const paused = exitMeaning('Assurance', EXIT_PAUSED_OR_TIMEOUT, false);
    expect(paused).toBe('paused-resumable');
    expect(paused).not.toBe('failure');
    expect(paused).not.toBe('timeout-or-cancelled');
    expect(permitsVerdictWrite(paused)).toBe(false);
  });

  it('treats testrun exit 2 as a preflight rejection and nobody else’s 2 as one', () => {
    expect(exitMeaning('ExecutionTestrun', EXIT_PREFLIGHT_REJECTED, false)).toBe(
      'preflight-rejected',
    );
    expect(exitMeaning('ExecutionRun', EXIT_PREFLIGHT_REJECTED, false)).toBe('failure');
    // Design §5.3.1: the verified `cover` refusal envelope. The *reason* lives in
    // `done.status: 'refused'`, not in the exit code, so the exit reads `failure`
    // and task 2.16 pins the resulting `assurance-status:refused` degradedReason.
    expect(exitMeaning('Assurance', EXIT_PREFLIGHT_REJECTED, false)).toBe('failure');
  });

  it('reads 127 as a missing binary for every family', () => {
    for (const family of COMMAND_FAMILIES) {
      expect(exitMeaning(family, EXIT_KANE_NOT_FOUND, false)).toBe('kane-not-found');
    }
  });

  it('reads 130 as force-interrupted for every family, Assurance included (R11.11)', () => {
    for (const family of COMMAND_FAMILIES) {
      expect(exitMeaning(family, EXIT_FORCE_INTERRUPTED, false)).toBe('force-interrupted');
    }
  });

  it('calls only 0 a success', () => {
    for (const family of COMMAND_FAMILIES) {
      expect(exitMeaning(family, EXIT_SUCCESS, false)).toBe('success');
      expect(exitMeaning(family, -0, false)).toBe('success');
      for (const code of [1, 2, 3, 126, 127, 130, 255, -1]) {
        expect(exitMeaning(family, code, false)).not.toBe('success');
      }
    }
  });
});

describe('exitMeaning — precedence decisions', () => {
  it('lets `killed` outrank every exit code', () => {
    for (const family of COMMAND_FAMILIES) {
      for (const code of [null, 0, 2, 3, 127, 130, 143, -1]) {
        expect(exitMeaning(family, code, true)).toBe('killed-by-timeout');
      }
    }
  });

  it('lets `killed` outrank 127, because a killed process was found and spawned', () => {
    // `kane-not-found` is decided on PATH resolution before any spawn (design
    // §4.7 step 1), where `killed` is false by construction. A killed process
    // reporting 127 is a wrapper's status under termination, not a missing binary.
    expect(exitMeaning('Assurance', EXIT_KANE_NOT_FOUND, true)).toBe('killed-by-timeout');
    expect(exitMeaning('Assurance', EXIT_KANE_NOT_FOUND, false)).toBe('kane-not-found');
  });

  it('lets `killed` outrank a successful exit code', () => {
    // A process killed at the timeout has not succeeded, however it managed to
    // exit while dying — R11.8 requires prior verdicts to survive.
    expect(exitMeaning('ExecutionTestrun', EXIT_SUCCESS, true)).toBe('killed-by-timeout');
    expect(permitsVerdictWrite(exitMeaning('ExecutionTestrun', EXIT_SUCCESS, true))).toBe(false);
  });

  it('reads a null code as force-interrupted rather than as failure', () => {
    // Signalled, not exited. `failure` would be write-permitting, so an OOM or
    // SIGSEGV kill could move verdicts on a partial stream.
    for (const family of COMMAND_FAMILIES) {
      const meaning = exitMeaning(family, null, false);
      expect(meaning).toBe('force-interrupted');
      expect(permitsVerdictWrite(meaning)).toBe(false);
    }
  });

  it('never throws and never answers outside the vocabulary for a hostile code', () => {
    const hostile: readonly (number | null)[] = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      2.5,
      2.999_999,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
      -1_073_741_819, // a Windows-style negative status
    ];
    for (const family of COMMAND_FAMILIES) {
      for (const code of hostile) {
        const meaning = exitMeaning(family, code, false);
        expect(isExitMeaning(meaning)).toBe(true);
        // No arithmetic on the code: 2.999… must not round into a named meaning.
        expect(meaning).toBe('failure');
      }
    }
  });

  it('is defensive about a non-boolean `killed` at the boundary', () => {
    expect(exitMeaning('Assurance', 3, undefined as unknown as boolean)).toBe('paused-resumable');
    expect(exitMeaning('Assurance', 3, true)).toBe('killed-by-timeout');
  });
});

describe('the ExitMeaning vocabulary and the write-permitting set', () => {
  it('has exactly the eight members design §4.5 fixes', () => {
    expect([...EXIT_MEANINGS]).toEqual([
      'success',
      'failure',
      'timeout-or-cancelled',
      'paused-resumable',
      'force-interrupted',
      'preflight-rejected',
      'kane-not-found',
      'killed-by-timeout',
    ]);
    expect(new Set(EXIT_MEANINGS).size).toBe(EXIT_MEANINGS.length);
  });

  it('permits a verdict write for success and failure only', () => {
    expect([...WRITE_PERMITTING_EXIT_MEANINGS].sort()).toEqual(['failure', 'success']);
    expect(WRITE_PERMITTING_EXIT_MEANINGS.size).toBe(2);
    for (const meaning of EXIT_MEANINGS) {
      expect(permitsVerdictWrite(meaning)).toBe(meaning === 'success' || meaning === 'failure');
    }
  });

  it('guards the vocabulary at a boundary', () => {
    for (const meaning of EXIT_MEANINGS) expect(isExitMeaning(meaning)).toBe(true);
    for (const bogus of ['Success', 'paused', '', 'toString', null, undefined, 3, {}]) {
      expect(isExitMeaning(bogus)).toBe(false);
    }
  });

  it('exposes the writable set as a frozen ReadonlySet and the vocabulary frozen', () => {
    // `ReadonlySet` is the compile-time guard; the membership assertion above is
    // the runtime one. `Object.freeze` on a Set seals its properties, not its
    // internal entries, so it is belt-and-braces rather than the real fence.
    expect(Object.isFrozen(WRITE_PERMITTING_EXIT_MEANINGS)).toBe(true);
    expect(Object.isFrozen(EXIT_MEANINGS)).toBe(true);
  });
});
