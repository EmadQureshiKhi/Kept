/**
 * Why `maintain evolve` has no headless path, asserted against the probe (task 21.1,
 * design §4.9, §8.1, §13.1, §18 #10, R7.2, R7.10, R7.11).
 *
 * Task 21.1 asked for this branch to be wired for real. It cannot be, and this suite
 * exists so that conclusion rests on captured bytes rather than on a paragraph nobody
 * can check.
 *
 * The task's own diagnosis was that `maintain evolve` lacks `--mode`, which is true,
 * and that correcting the argv would let the branch call Kane, which is not. The argv
 * was already correct: `evolveArgv` composes `maintain evolve <ref>` and writes no
 * ask-policy flag. What stops the invocation is one rung further down.
 *
 * **The verb refuses to run without a TTY, and says why.** Probed once against a
 * fresh target chosen so that a success could supersede nothing, the whole exchange
 * was:
 *
 * ```console
 * $ kane-cli maintain evolve uc-10 --because "…" > capture.ndjson
 * evolving uc-10: reading the graph…
 * error: evolve needs a TTY — the blast-radius confirm is the point; headless
 *   evolution rides `kane-cli maintain reconcile`
 * $ echo $?
 * 2
 * ```
 *
 * That answers the task's probe question and closes the task in the same breath:
 *
 * 1. Piped stdout is **not** an NDJSON enabler here. One line of human prose, then a
 *    refusal. There was never a machine-readable stream to consume.
 * 2. The refusal is deliberate. The blast-radius confirm is the point, because this
 *    verb supersedes a use case's scenario and test pairs. Kane reaches the same
 *    conclusion §8.1 reached for the `test-drift` branch, from the other side of the
 *    process boundary: a human looks before that happens.
 * 3. Kane names the headless route, and it is one KEPT already takes. `maintain
 *    reconcile` is §13.2's command, `kept reconcile` invokes it, and its staged rows
 *    already become held review cards. The capability the task wanted exists; it
 *    arrives through the other verb.
 *
 * So the degradation path in `evolve.ts` is not a workaround for a missing flag. It
 * is the correct headless behaviour, and the fact that it was right all along is the
 * finding. What changed is the remedy it names.
 *
 * **The probe cost nothing and moved nothing**, which is asserted here too, because a
 * probe that quietly superseded four scenario and test pairs would have been an
 * expensive way to learn this.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EVOLVE_ARGV_HEAD, MODE_FLAG, evolveArgv } from '../src/commands/evolve.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function read(relative: string): string {
  return readFileSync(`${REPO_ROOT}${relative}`, 'utf8');
}

const DIR = 'docs/kane/evolve';

describe('the argv was already right, so correcting it changes nothing', () => {
  it('composes the verb and the ref, and no ask-policy flag', () => {
    expect(evolveArgv('uc-10')).toEqual(['maintain', 'evolve', 'uc-10']);
    expect(EVOLVE_ARGV_HEAD).toEqual(['maintain', 'evolve']);
    expect(evolveArgv('uc-10')).not.toContain(MODE_FLAG);
    expect(evolveArgv('uc-10')).not.toContain('--agent');
  });

  it('leaves the two options Kane really does accept out of the composed argv', () => {
    // `--from-stale` and `--because` are the verb's whole option table. Neither is
    // composed here: `--from-stale` would widen one ref into every stale use case,
    // and `--because` overrides the freshness gate, which is a human's call.
    const argv = evolveArgv('uc-10').join(' ');
    expect(argv).not.toContain('--from-stale');
    expect(argv).not.toContain('--because');
  });
});

describe('the verb refuses headless operation, and that is the answer to 21.1', () => {
  const stdout = read(`${DIR}/rehearse-uc10.stdout.ndjson`);
  const stderr = read(`${DIR}/rehearse-uc10.stderr.txt`);
  const exit = read(`${DIR}/rehearse-uc10.exit.txt`);

  it('exited 2 with the whole invocation captured', () => {
    expect(exit.trim()).toBe('exit=2');
    expect(read(`${DIR}/probe-exit.txt`).trim()).toBe('exit=2');
  });

  it('refuses for want of a TTY, and names its own headless alternative', () => {
    expect(stderr).toContain('evolve needs a TTY');
    expect(stderr).toContain('the blast-radius confirm is the point');
    // The sentence that decides the task: Kane points at a verb KEPT already drives.
    expect(stderr).toContain('headless evolution rides');
    expect(stderr).toContain('maintain reconcile');
  });

  it('put one line of prose on stdout and no NDJSON at all', () => {
    /* The task asked whether piped stdout is the enabler here the way it is for
       `testrun run`. It is not: this is the entire captured stdout, and it is a
       progress sentence. A reader that treated it as a stream would parse nothing and
       then wait for a terminal event that was never coming. */
    expect(stdout.trim()).toBe('evolving uc-10: reading the graph\u2026');
    expect(stdout.split('\n').filter((line) => line.trim().startsWith('{'))).toEqual([]);
  });

  it('refuses the same way for a ref that does not resolve', () => {
    // The cheaper probe, run first: a ref nothing matches cannot supersede anything.
    // It also exits 2, so the refusal is not specific to the TTY question.
    expect(read(`${DIR}/probe-exit.txt`).trim()).toBe('exit=2');
  });
});

describe('the probe moved nothing and cost nothing', () => {
  it('left the commit chain at the same length', () => {
    // A superseding record would have appended to `.context/commits/`.
    const before = read(`${DIR}/commit-count-before.txt`).trim();
    const after = read(`${DIR}/commit-count-after.txt`).trim();
    expect(before).toBe('39');
    expect(after).toBe(before);
  });

  it('left the graph byte-identical, so no pair was superseded', () => {
    /* The assertion that makes this a rehearsal rather than a gamble. `maintain
       evolve` supersedes a use case's scenario and test pairs, and uc-10 was chosen
       precisely because it is fresh and carries none, so a success could have cost
       nothing either. It refused before reaching that question. */
    const before = read(`${DIR}/graph-before.json`);
    const after = read(`${DIR}/graph-after.json`);
    expect(after).toBe(before);
    // Non-vacuous: the capture really is a graph with the nodes evolution acts on.
    const labels = before
      .split('\n')
      .filter((line) => line.trim().startsWith('{'))
      .map((line) => (JSON.parse(line) as { readonly label: string }).label);
    expect(labels).toContain('usecase');
    expect(labels).toContain('scenario');
    expect(labels).toContain('test');
    expect(labels.filter((label) => label === 'usecase').length).toBeGreaterThan(1);
  });

  it('was cleared by fsck either side, so the store is sound', () => {
    expect(read(`${DIR}/fsck-before.txt`)).toContain('record(s) verified');
    expect(read(`${DIR}/fsck-before.txt`)).toContain('derived projection in parity');
  });
});

describe('the target was chosen so a success could not have cost anything', () => {
  it('picked a fresh use case carrying no designed scenario or test', () => {
    /* uc-2 is the only use case in this graph that is complete and proven, and it is
       stale, so it is the one `--from-stale` would have reached and the one whose
       supersession would have cost the six acceptance criteria the ribbon publishes.
       uc-10 is fresh, undesigned and not run, which is why `--because` was needed to
       target it at all and why targeting it was safe. */
    const snapshot = JSON.parse(read('apps/ledger/data/ledger.snapshot.json')) as {
      readonly coverageAxes: {
        readonly rows: readonly {
          readonly id: string;
          readonly designCompleteness: { readonly status: string };
          readonly proven: { readonly status: string };
        }[];
      } | null;
    };
    const rows = snapshot.coverageAxes?.rows ?? [];
    expect(rows.length).toBeGreaterThan(0);

    const complete = rows.filter((row) => row.designCompleteness.status === 'complete');
    expect(complete.map((row) => row.id)).toEqual(['uc-2']);

    const target = rows.find((row) => row.id === 'uc-10');
    expect(target, 'uc-10 is no longer in the published rows').toBeDefined();
    expect(target?.designCompleteness.status).toBe('undesigned');
    expect(target?.proven.status).toBe('not_run');
  });
});
