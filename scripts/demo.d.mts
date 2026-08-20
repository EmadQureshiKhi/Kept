/**
 * Types for `scripts/demo.mjs`.
 *
 * The script itself is JavaScript because it is a zero-dependency command that
 * must run straight from `npm run demo` with no build step in front of it — the
 * judge path of design §15.1 cannot depend on `tsc` having been run. This
 * hand-written declaration is how its exported pieces stay type-checked at the
 * one place they are consumed from TypeScript: the unit test in
 * `packages/kept-core/test/demo-script.test.ts`, which `tsc -b` compiles under
 * the repository's strict settings.
 *
 * Keep it in step with the script by hand. It is nine exports, and the test
 * exercises every one of them, so drift shows up as a failing assertion rather
 * than as a silent `any`.
 */

/** One of the two applications `npm run demo` boots. */
export interface DemoService {
  /** The output prefix, and the name used in diagnostics. */
  readonly label: string;
  /** Repo-relative working directory for the `next dev` process. */
  readonly directory: string;
  /** Load-bearing: 3000 for the Ledger, 3100 for the fixture. */
  readonly port: number;
  /** One line for the banner, telling a judge which is which. */
  readonly description: string;
}

/** A line framer: chunks in, whole prefixed lines out. */
export interface Prefixer {
  write(chunk: string): void;
  end(): void;
}

export declare const REPO_ROOT: string;
export declare const SERVICES: readonly DemoService[];

export declare function nextArgv(service: Pick<DemoService, 'port'>): string[];
export declare function serviceUrl(service: Pick<DemoService, 'port'>): string;
export declare function assertNoKaneInvocation(command: string, argv: readonly string[]): void;
export declare function resolveNextBinary(root?: string): string;
export declare function labelWidth(services?: readonly Pick<DemoService, 'label'>[]): number;
export declare function createPrefixer(
  label: string,
  sink: (line: string) => void,
  width?: number,
): Prefixer;
export declare function banner(services?: readonly DemoService[]): string;
