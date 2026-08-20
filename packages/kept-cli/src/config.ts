/**
 * `.kept/config.json` — the one committed file under `.kept/` (design §13.1,
 * §6.4, and the `!.kept/config.json` negation in `.gitignore`).
 *
 * Everything else under `.kept/` is regenerable single-writer state. This file is
 * configuration and is reviewable in history, because it carries the one string
 * the verdict spike is allowed to change:
 *
 * ```json
 * { "verdictRouter": "resultCode740", "memberDebug": false,
 *   "timeouts": { "hookMs": 300000, "enrichmentMs": 60000 } }
 * ```
 *
 * Two rules govern this module.
 *
 * **The committed file is the authority; the constants below are the fallback.**
 * `timeouts.enrichmentMs` deliberately has no default inside
 * `providers/enrichment.ts` — a default there would be a second home for the 60 s
 * budget, which is why the provider is a factory that takes the number. This is
 * the *first* home: the value a caller passes comes from here, and here reads the
 * committed file. {@link DEFAULT_CONFIG} exists only for a tree where the file was
 * deleted, and every use of it is announced by a diagnostic naming the field, so
 * "the config was missing" never looks like "the config said this".
 *
 * **A malformed config is a state of the world, not a programming error.**
 * `kept build` on a repository whose config is truncated mid-key must still
 * produce a ledger from the baseline provider (§14.2, R2.12), so every field is
 * read defensively and a bad one falls back with a `warn`. Nothing here throws.
 */

import type { CollectingDiagnosticSink, Diagnostic, DiagnosticSink } from '@kept/core';
import { createDiagnosticSink, type StateFileSystem } from '@kept/core';

/** Where the config lives, relative to the repository root. */
export const CONFIG_FILE_RELATIVE_PATH = '.kept/config.json';

/** The two routers of design §6.4. Exactly these; `--router` accepts no other. */
export const VERDICT_ROUTER_NAMES = Object.freeze([
  'resultCode740',
  'failureYamlTriage',
] as const);

/** One router name. */
export type VerdictRouterName = (typeof VERDICT_ROUTER_NAMES)[number];

/** Is this string one of the two routers? */
export function isVerdictRouterName(value: unknown): value is VerdictRouterName {
  return typeof value === 'string' && (VERDICT_ROUTER_NAMES as readonly string[]).includes(value);
}

/** The two Kane budgets, in milliseconds (design §13.1 timeout column). */
export interface KeptTimeouts {
  /** Hook-path budget: `verify`, `reconcile`, `evolve`. 300 000. */
  readonly hookMs: number;
  /** Enrichment budget: `cover --json`. 60 000. */
  readonly enrichmentMs: number;
}

/** The config, every field present. */
export interface KeptConfig {
  readonly verdictRouter: VerdictRouterName;
  readonly memberDebug: boolean;
  readonly timeouts: KeptTimeouts;
}

/**
 * The fallback for a tree with no `.kept/config.json`. Every use is diagnosed, so
 * this is never silently in force.
 */
export const DEFAULT_CONFIG: KeptConfig = Object.freeze({
  verdictRouter: 'resultCode740',
  memberDebug: false,
  timeouts: Object.freeze({ hookMs: 300_000, enrichmentMs: 60_000 }),
});

/** Diagnostic codes this module reports. Stable; the Ledger keys off them. */
export const CONFIG_DIAGNOSTIC_CODES = Object.freeze({
  absent: 'config-absent',
  unreadable: 'config-unreadable',
  fieldInvalid: 'config-field-invalid',
  routerOverride: 'config-router-override',
  routerOverrideInvalid: 'config-router-override-invalid',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const CONFIG_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(CONFIG_DIAGNOSTIC_CODES),
);

/** {@link loadConfig}'s input. */
export interface LoadConfigRequest {
  /** Absolute repository root. `.kept/config.json` sits under it. */
  readonly repoRoot: string;
  /** Reuses the state store's filesystem seam, so a test needs no disk. */
  readonly fileSystem: StateFileSystem;
  readonly diagnostics?: DiagnosticSink | undefined;
}

/** What {@link loadConfig} answers. */
export interface LoadConfigResult {
  readonly config: KeptConfig;
  /** True when the file was present, parsed, and every field was usable. */
  readonly loaded: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

/** A positive finite integer millisecond budget, or null. */
function readTimeout(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

/**
 * Read `.kept/config.json`.
 *
 * Never throws. An absent file, a file that is not JSON, a file that is a JSON
 * array, and a file whose `timeouts.enrichmentMs` is the string `"60s"` all
 * answer a complete {@link KeptConfig} plus the diagnostics explaining which
 * fields came from {@link DEFAULT_CONFIG} and why.
 */
export function loadConfig(request: LoadConfigRequest): LoadConfigResult {
  const sink: CollectingDiagnosticSink = createDiagnosticSink();
  const report = (draft: Parameters<DiagnosticSink['report']>[0]): void => {
    const diagnostic = sink.report(draft);
    request.diagnostics?.report({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      file: diagnostic.file,
      line: diagnostic.line,
    });
  };

  const path = joinPath(request.repoRoot, CONFIG_FILE_RELATIVE_PATH);
  const text = request.fileSystem.readFile(path);
  if (text === null) {
    report({
      code: CONFIG_DIAGNOSTIC_CODES.absent,
      severity: 'info',
      message:
        `${CONFIG_FILE_RELATIVE_PATH} is absent, so the built-in defaults are in force: ` +
        `router '${DEFAULT_CONFIG.verdictRouter}', enrichment budget ` +
        `${DEFAULT_CONFIG.timeouts.enrichmentMs} ms, hook budget ` +
        `${DEFAULT_CONFIG.timeouts.hookMs} ms`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
    return { config: DEFAULT_CONFIG, loaded: false, diagnostics: sink.entries };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    report({
      code: CONFIG_DIAGNOSTIC_CODES.unreadable,
      severity: 'warn',
      message:
        `${CONFIG_FILE_RELATIVE_PATH} is not valid JSON (` +
        `${error instanceof Error ? error.message : String(error)}), so the built-in defaults ` +
        `are in force`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
    return { config: DEFAULT_CONFIG, loaded: false, diagnostics: sink.entries };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    report({
      code: CONFIG_DIAGNOSTIC_CODES.unreadable,
      severity: 'warn',
      message:
        `${CONFIG_FILE_RELATIVE_PATH} is not a JSON object, so the built-in defaults are in force`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
    return { config: DEFAULT_CONFIG, loaded: false, diagnostics: sink.entries };
  }

  const record = raw as Record<string, unknown>;
  let clean = true;

  let verdictRouter = DEFAULT_CONFIG.verdictRouter;
  if (isVerdictRouterName(record['verdictRouter'])) {
    verdictRouter = record['verdictRouter'];
  } else {
    clean = false;
    report({
      code: CONFIG_DIAGNOSTIC_CODES.fieldInvalid,
      severity: 'warn',
      message:
        `${CONFIG_FILE_RELATIVE_PATH}: verdictRouter is ` +
        `${JSON.stringify(record['verdictRouter'])}, which is not one of ` +
        `${VERDICT_ROUTER_NAMES.join(' | ')}; using '${DEFAULT_CONFIG.verdictRouter}'`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
  }

  let memberDebug = DEFAULT_CONFIG.memberDebug;
  if (typeof record['memberDebug'] === 'boolean') {
    memberDebug = record['memberDebug'];
  } else if (record['memberDebug'] !== undefined) {
    clean = false;
    report({
      code: CONFIG_DIAGNOSTIC_CODES.fieldInvalid,
      severity: 'warn',
      message:
        `${CONFIG_FILE_RELATIVE_PATH}: memberDebug is ` +
        `${JSON.stringify(record['memberDebug'])}, which is not a boolean; using ` +
        `${String(DEFAULT_CONFIG.memberDebug)}`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
  }

  const rawTimeouts = record['timeouts'];
  const timeoutRecord: Record<string, unknown> =
    typeof rawTimeouts === 'object' && rawTimeouts !== null && !Array.isArray(rawTimeouts)
      ? (rawTimeouts as Record<string, unknown>)
      : {};
  const timeouts: { hookMs: number; enrichmentMs: number } = {
    hookMs: DEFAULT_CONFIG.timeouts.hookMs,
    enrichmentMs: DEFAULT_CONFIG.timeouts.enrichmentMs,
  };
  for (const field of ['hookMs', 'enrichmentMs'] as const) {
    const value = readTimeout(timeoutRecord[field]);
    if (value !== null) {
      timeouts[field] = value;
      continue;
    }
    clean = false;
    report({
      code: CONFIG_DIAGNOSTIC_CODES.fieldInvalid,
      severity: 'warn',
      message:
        `${CONFIG_FILE_RELATIVE_PATH}: timeouts.${field} is ` +
        `${JSON.stringify(timeoutRecord[field])}, which is not a positive integer number of ` +
        `milliseconds; using ${DEFAULT_CONFIG.timeouts[field]}`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
  }

  return {
    config: { verdictRouter, memberDebug, timeouts: Object.freeze(timeouts) },
    loaded: clean,
    diagnostics: sink.entries,
  };
}

/**
 * Layer one invocation's flags over the loaded config (design §13.1).
 *
 * `--router` overrides for one invocation and nothing else; `--member-debug`
 * turns member capture on and, deliberately, cannot turn it off — the flag's
 * presence is the whole signal, so a config that already says `true` stays true.
 * A `--router` naming a router that does not exist is **ignored with a warning**
 * rather than being a usage error: §14.2 keeps the exit code a statement about
 * whether KEPT worked, and a hook that starts failing over a typo is a hook
 * somebody disables.
 */
export function applyOverrides(
  config: KeptConfig,
  overrides: { readonly router?: string | null; readonly memberDebug?: boolean },
  diagnostics?: DiagnosticSink,
): KeptConfig {
  let verdictRouter = config.verdictRouter;
  const router = overrides.router ?? null;
  if (router !== null) {
    if (isVerdictRouterName(router)) {
      verdictRouter = router;
      diagnostics?.report({
        code: CONFIG_DIAGNOSTIC_CODES.routerOverride,
        severity: 'info',
        message: `--router '${router}' overrides the configured '${config.verdictRouter}' for this invocation`,
      });
    } else {
      diagnostics?.report({
        code: CONFIG_DIAGNOSTIC_CODES.routerOverrideInvalid,
        severity: 'warn',
        message:
          `--router '${router}' is not one of ${VERDICT_ROUTER_NAMES.join(' | ')}, so the ` +
          `configured '${config.verdictRouter}' stays in force`,
      });
    }
  }
  return {
    verdictRouter,
    memberDebug: config.memberDebug || overrides.memberDebug === true,
    timeouts: config.timeouts,
  };
}

/**
 * The environment overrides one invocation needs (R4.12).
 *
 * A pure function of the resolved config so the wiring can be asserted without a
 * process anywhere: `KANE_TESTRUN_MEMBER_DEBUG=1` when member capture is on, and
 * an empty record otherwise — never `KANE_TESTRUN_MEMBER_DEBUG=0`, because Kane
 * reads the variable's presence.
 */
export function memberDebugEnv(config: KeptConfig): Readonly<Record<string, string>> {
  return config.memberDebug ? Object.freeze({ KANE_TESTRUN_MEMBER_DEBUG: '1' }) : Object.freeze({});
}

/** POSIX join, matching the state store's own path handling. */
export function joinPath(root: string, relative: string): string {
  return root.endsWith('/') ? `${root}${relative}` : `${root}/${relative}`;
}
