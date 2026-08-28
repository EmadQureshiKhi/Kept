import { join, resolve } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  COMMAND_FAMILIES,
  contractFor,
  listArtifacts,
  resolveEvidenceDir,
  type CommandFamily,
  type EvidenceFileSystem,
} from 'kept-core';

/**
 * Feature: kept, Property 14: Evidence-pack locations are resolved from the
 * family, never from the event (design §Correctness Properties, §4.6, A12,
 * R3.19, R4.13, R6.11).
 *
 * *For any* session directory and working directory, the resolved evidence
 * location is `session_dir/evidence` for the Execution_Run family and
 * `<cwd>/.testmuai/evidence` for the Execution_Testrun family, is null when the
 * family cannot resolve one or the session directory is absent, and is never
 * derived from any field of the terminal event.
 *
 * The last clause is the one that matters, and it is a negative, so it is
 * encoded as **independence** rather than as an assertion about one example.
 * Kane 0.8.4 prints the pack hint on stderr only and `run_dir` is legacy and no
 * longer created, so reaching for `run_dir`, `evidence_path` or `evidence_dir`
 * on a terminal event reads a field that is absent or stale — and the failure
 * mode is silent: a pack that is never found looks exactly like a run that
 * produced none. Three encodings close that off here:
 *
 * 1. **Request independence** — arbitrary tempting fields, carrying entirely
 *    plausible `/trap/...` paths, are spread into the resolver's argument and the
 *    answer is unchanged. This is the sharp one, because the argument *is* an
 *    object and an implementation reading `args.run_dir` would type-check.
 * 2. **Call-site independence** — a model of the real call site resolves from a
 *    generated event; an event carrying only tempting fields resolves to exactly
 *    what the empty event resolves to.
 * 3. **Filesystem independence** — every path the module touches is recorded
 *    through an injected filesystem, and no touched path mentions a trap value.
 *    That is design §4.6's "zero filesystem calls that mention `run_dir`" stated
 *    over generated inputs.
 *
 * **Validates: Requirements 3.19, 4.13, 6.11**
 */

/** Design §Testing Strategy floor is 100 runs; stated explicitly so it cannot regress to a default. */
const NUM_RUNS = 500;

/** All three families, every run. 2.11 should absorb this as `arbFamily`. */
const arbFamily: fc.Arbitrary<CommandFamily> = fc.constantFrom(...COMMAND_FAMILIES);

/** One path segment: nothing that `path.join` would collapse or re-root. */
const arbSegment: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), {
    minLength: 1,
    maxLength: 10,
  })
  .map((chars) => chars.join(''));

/**
 * An absolute directory under a fixed `/base` root. 2.11 should absorb this as
 * `arbAbsoluteDir`. The root is fixed so the trap generator below can be made
 * disjoint from it by construction — that disjointness is what lets the
 * filesystem clause assert "no touched path mentions a trap value" mechanically.
 */
const arbAbsoluteDir: fc.Arbitrary<string> = fc
  .array(arbSegment, { minLength: 1, maxLength: 4 })
  .map((segments) => `/${['base', ...segments].join('/')}`);

/** A path a naive implementation might lift off an event. Disjoint from `/base`. */
const arbTrapPath: fc.Arbitrary<string> = fc
  .array(arbSegment, { minLength: 1, maxLength: 3 })
  .map((segments) => `/${['trap', ...segments, 'evidence'].join('/')}`);

/** Every way `run_end` can fail to carry a session directory. */
const arbAbsentSessionDir: fc.Arbitrary<string | null | undefined> = fc.constantFrom<
  string | null | undefined
>(undefined, null, '', '   ');

/**
 * The fields that must never be read. `run_dir` and `runDirLegacy` are the
 * legacy pair; the rest are plausible names an implementer would invent. 2.11
 * should absorb this as `arbLegacyPathFields`.
 */
const arbTrapFields: fc.Arbitrary<Record<string, string | undefined>> = fc.record(
  {
    run_dir: arbTrapPath,
    runDirLegacy: arbTrapPath,
    evidence_path: arbTrapPath,
    evidence_dir: arbTrapPath,
    evidencePath: arbTrapPath,
    packDir: arbTrapPath,
  },
  { requiredKeys: [] },
);

/**
 * A model of the real call site: it maps `run_end.session_dir` — a *session*
 * directory, the caller's one legitimate read — onto the resolver's argument, and
 * consults nothing else. Every other field of the event is inert by construction,
 * which is the shape the production code is required to have.
 */
function resolveFromEvent(
  family: CommandFamily,
  event: Record<string, unknown>,
  cwd: string,
): string | null {
  const sessionDir = typeof event['session_dir'] === 'string' ? event['session_dir'] : null;
  return resolveEvidenceDir({ family, sessionDir, cwd });
}

/** An injected filesystem that records every path it is asked about. */
function recordingFs(): { readonly fs: EvidenceFileSystem; readonly touched: string[] } {
  const touched: string[] = [];
  return {
    touched,
    fs: {
      readDirectory(dir: string): readonly [] {
        touched.push(dir);
        return [];
      },
      stat(path: string): null {
        touched.push(path);
        return null;
      },
    },
  };
}

describe('Feature: kept, Property 14: Evidence-pack locations are resolved from the family, never from the event', () => {
  it('resolves ExecutionRun to <session_dir>/evidence', () => {
    fc.assert(
      fc.property(arbAbsoluteDir, arbAbsoluteDir, (sessionDir, cwd) => {
        expect(resolveEvidenceDir({ family: 'ExecutionRun', sessionDir, cwd })).toBe(
          join(sessionDir, 'evidence'),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolves ExecutionTestrun to <cwd>/.testmuai/evidence, whatever the session dir', () => {
    fc.assert(
      fc.property(
        arbAbsoluteDir,
        fc.oneof(arbAbsoluteDir, arbAbsentSessionDir),
        (cwd, sessionDir) => {
          expect(resolveEvidenceDir({ family: 'ExecutionTestrun', sessionDir, cwd })).toBe(
            join(resolve(cwd), '.testmuai', 'evidence'),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('is null for a family that seals no pack, and null when the session dir is absent', () => {
    fc.assert(
      fc.property(
        arbAbsoluteDir,
        fc.oneof(arbAbsoluteDir, arbAbsentSessionDir),
        (cwd, sessionDir) => {
          // Assurance seals nothing — a paused `cover` has no pack to point at.
          expect(resolveEvidenceDir({ family: 'Assurance', sessionDir, cwd })).toBeNull();

          const absent = typeof sessionDir !== 'string' || sessionDir.trim().length === 0;
          const answer = resolveEvidenceDir({ family: 'ExecutionRun', sessionDir, cwd });
          expect(answer === null).toBe(absent);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('reads the location from the family contract, so the fact stays encoded once', () => {
    fc.assert(
      fc.property(arbFamily, arbAbsoluteDir, arbAbsoluteDir, (family, sessionDir, cwd) => {
        const answer = resolveEvidenceDir({ family, sessionDir, cwd });
        switch (contractFor(family).evidence) {
          case 'session-dir':
            expect(answer).toBe(join(sessionDir, 'evidence'));
            break;
          case 'cwd-testmuai':
            expect(answer).toBe(join(resolve(cwd), '.testmuai', 'evidence'));
            break;
          case 'none':
            expect(answer).toBeNull();
            break;
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never lets a tempting event field change the resolved directory', () => {
    fc.assert(
      fc.property(
        arbFamily,
        fc.oneof(arbAbsoluteDir, arbAbsentSessionDir),
        arbAbsoluteDir,
        arbTrapFields,
        (family, sessionDir, cwd, trap) => {
          const clean = resolveEvidenceDir({ family, sessionDir, cwd });
          // The argument is an object, so `args.run_dir` would type-check and
          // silently win. Merging the traps in is the assertion that it does not.
          const tempted = resolveEvidenceDir(Object.assign({ family, sessionDir, cwd }, trap));
          expect(tempted).toBe(clean);
          // And a resolved path never contains a trap value, whatever the traps said.
          if (clean !== null) expect(clean.includes('/trap/')).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolves the same from an event carrying only tempting fields as from an empty one', () => {
    fc.assert(
      fc.property(arbFamily, arbAbsoluteDir, arbTrapFields, (family, cwd, trap) => {
        const fromTrapOnly = resolveFromEvent(family, trap, cwd);
        const fromEmpty = resolveFromEvent(family, {}, cwd);
        expect(fromTrapOnly).toBe(fromEmpty);
        // An ExecutionRun whose event carried no session_dir has no locatable
        // pack, and a `run_dir` sitting right there does not change that.
        if (family === 'ExecutionRun') expect(fromTrapOnly).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('does not read a raw snake_case session_dir off the request', () => {
    // The resolver's contract is `sessionDir`. Accepting the event's own field
    // name would be reading the event, one rename away from reading `run_dir`.
    fc.assert(
      fc.property(arbAbsoluteDir, arbAbsoluteDir, (cwd, sessionDir) => {
        const family: CommandFamily = 'ExecutionRun';
        const request = Object.assign({ family, cwd }, { session_dir: sessionDir });
        expect(resolveEvidenceDir(request)).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('touches no filesystem path that mentions an event field', () => {
    fc.assert(
      fc.property(
        arbFamily,
        fc.oneof(arbAbsoluteDir, arbAbsentSessionDir),
        arbAbsoluteDir,
        arbTrapFields,
        (family, sessionDir, cwd, trap) => {
          const { fs, touched } = recordingFs();
          const listing = listArtifacts(Object.assign({ family, sessionDir, cwd, fs }, trap));

          // The listing's directory is exactly the family-derived one.
          expect(listing.dir).toBe(resolveEvidenceDir({ family, sessionDir, cwd }));

          for (const path of touched) {
            expect(path.includes('/trap/')).toBe(false);
            // Every read stays inside the resolved directory.
            expect(listing.dir).not.toBeNull();
            expect(path.startsWith(listing.dir ?? '\u0000')).toBe(true);
          }
          // Nothing is touched at all when the family resolves no directory.
          if (listing.dir === null) expect(touched).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('is total and deterministic: absolute or null, never a throw', () => {
    fc.assert(
      fc.property(
        arbFamily,
        fc.oneof(arbAbsoluteDir, arbAbsentSessionDir, arbSegment),
        fc.oneof(arbAbsoluteDir, fc.constant(''), arbSegment),
        (family, sessionDir, cwd) => {
          const first = resolveEvidenceDir({ family, sessionDir, cwd });
          const second = resolveEvidenceDir({ family, sessionDir, cwd });
          expect(second).toBe(first);
          if (first !== null) {
            expect(first.startsWith('/')).toBe(true);
            expect(first.endsWith('evidence')).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
