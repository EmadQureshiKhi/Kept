import { createDiagnosticSink, inMemoryStateFileSystem } from '@kept/core';
import { describe, expect, it } from 'vitest';

import {
  CONFIG_DIAGNOSTIC_CODES,
  CONFIG_FILE_RELATIVE_PATH,
  DEFAULT_CONFIG,
  VERDICT_ROUTER_NAMES,
  applyOverrides,
  isVerdictRouterName,
  loadConfig,
  memberDebugEnv,
} from '../src/config.js';

/**
 * `.kept/config.json` (design §6.4, §13.1).
 *
 * The behaviour under test is that a broken config never stops a build. Every
 * malformed shape below answers a complete config plus a diagnostic naming the
 * field, because `kept build` on a repository whose config is truncated mid-key
 * must still produce a ledger from the baseline provider (§14.2, R2.12).
 */
const ROOT = '/repo';
const CONFIG_PATH = `${ROOT}/${CONFIG_FILE_RELATIVE_PATH}`;

function load(contents?: string) {
  const fileSystem = inMemoryStateFileSystem(
    contents === undefined ? {} : { [CONFIG_PATH]: contents },
  );
  const sink = createDiagnosticSink();
  const result = loadConfig({ repoRoot: ROOT, fileSystem, diagnostics: sink });
  return { ...result, sink };
}

describe('the router vocabulary', () => {
  it('is exactly the two routers of design §6.4', () => {
    expect([...VERDICT_ROUTER_NAMES]).toEqual(['resultCode740', 'failureYamlTriage']);
  });

  it('recognises those two and nothing else', () => {
    expect(isVerdictRouterName('resultCode740')).toBe(true);
    expect(isVerdictRouterName('failureYamlTriage')).toBe(true);
    expect(isVerdictRouterName('resultcode740')).toBe(false);
    expect(isVerdictRouterName(740)).toBe(false);
    expect(isVerdictRouterName(null)).toBe(false);
  });
});

describe('loading the committed config', () => {
  it('reads every field', () => {
    const { config, loaded } = load(
      JSON.stringify({
        verdictRouter: 'failureYamlTriage',
        memberDebug: true,
        timeouts: { hookMs: 120_000, enrichmentMs: 30_000 },
      }),
    );
    expect(loaded).toBe(true);
    // Spread over the defaults rather than listed: the portability keys of §20.1
    // are optional and resolve to §20.4's fail-closed values, which is what this
    // three-key document is asserting about them.
    expect(config).toEqual({
      ...DEFAULT_CONFIG,
      verdictRouter: 'failureYamlTriage',
      memberDebug: true,
      timeouts: { ...DEFAULT_CONFIG.timeouts, hookMs: 120_000, enrichmentMs: 30_000 },
    });
  });

  it('reads the repository\u2019s own committed shape', () => {
    const { config, loaded } = load(
      JSON.stringify({
        verdictRouter: 'resultCode740',
        memberDebug: false,
        timeouts: { hookMs: 300_000, enrichmentMs: 60_000 },
      }),
    );
    expect(loaded).toBe(true);
    expect(config).toEqual(DEFAULT_CONFIG);
  });
});

describe('a config that cannot be used', () => {
  it('falls back with an info diagnostic when absent', () => {
    const { config, loaded, sink } = load();
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(loaded).toBe(false);
    expect(sink.has(CONFIG_DIAGNOSTIC_CODES.absent)).toBe(true);
  });

  it('falls back with a warning when it is not JSON', () => {
    const { config, loaded, sink } = load('{ "verdictRouter": ');
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(loaded).toBe(false);
    expect(sink.has(CONFIG_DIAGNOSTIC_CODES.unreadable)).toBe(true);
  });

  it('falls back with a warning when it is a JSON array', () => {
    const { config, sink } = load('[]');
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(sink.has(CONFIG_DIAGNOSTIC_CODES.unreadable)).toBe(true);
  });

  it('names the offending field and keeps the rest', () => {
    const { config, loaded, sink } = load(
      JSON.stringify({
        verdictRouter: 'resultCode741',
        memberDebug: 'yes',
        timeouts: { hookMs: 300_000, enrichmentMs: '60s' },
      }),
    );
    expect(loaded).toBe(false);
    expect(config.verdictRouter).toBe(DEFAULT_CONFIG.verdictRouter);
    expect(config.memberDebug).toBe(false);
    // The one good field survives; only the bad ones fall back.
    expect(config.timeouts.hookMs).toBe(300_000);
    expect(config.timeouts.enrichmentMs).toBe(DEFAULT_CONFIG.timeouts.enrichmentMs);
    const messages = sink.withCode(CONFIG_DIAGNOSTIC_CODES.fieldInvalid).map((d) => d.message);
    expect(messages.some((message) => message.includes('verdictRouter'))).toBe(true);
    expect(messages.some((message) => message.includes('memberDebug'))).toBe(true);
    expect(messages.some((message) => message.includes('timeouts.enrichmentMs'))).toBe(true);
  });

  it('rejects a non-positive or fractional budget', () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { config } = load(JSON.stringify({ timeouts: { enrichmentMs: value } }));
      expect(config.timeouts.enrichmentMs).toBe(DEFAULT_CONFIG.timeouts.enrichmentMs);
    }
  });
});

describe('per-invocation overrides', () => {
  it('applies a valid --router for one invocation', () => {
    const sink = createDiagnosticSink();
    const config = applyOverrides(DEFAULT_CONFIG, { router: 'failureYamlTriage' }, sink);
    expect(config.verdictRouter).toBe('failureYamlTriage');
    expect(sink.has(CONFIG_DIAGNOSTIC_CODES.routerOverride)).toBe(true);
  });

  it('ignores an unknown --router with a warning rather than failing', () => {
    const sink = createDiagnosticSink();
    const config = applyOverrides(DEFAULT_CONFIG, { router: 'magic' }, sink);
    expect(config.verdictRouter).toBe(DEFAULT_CONFIG.verdictRouter);
    expect(sink.has(CONFIG_DIAGNOSTIC_CODES.routerOverrideInvalid)).toBe(true);
  });

  it('turns member debug on but never off', () => {
    expect(applyOverrides(DEFAULT_CONFIG, { memberDebug: true }).memberDebug).toBe(true);
    const on = { ...DEFAULT_CONFIG, memberDebug: true };
    expect(applyOverrides(on, { memberDebug: false }).memberDebug).toBe(true);
  });

  it('leaves the timeouts alone', () => {
    expect(applyOverrides(DEFAULT_CONFIG, { router: 'failureYamlTriage' }).timeouts).toEqual(
      DEFAULT_CONFIG.timeouts,
    );
  });
});

describe('the member-debug environment (R4.12)', () => {
  it('sets KANE_TESTRUN_MEMBER_DEBUG=1 when on', () => {
    expect(memberDebugEnv({ ...DEFAULT_CONFIG, memberDebug: true })).toEqual({
      KANE_TESTRUN_MEMBER_DEBUG: '1',
    });
  });

  it('sets nothing at all when off — never the string 0', () => {
    // Kane reads the variable's presence, so a `0` would turn capture *on*.
    expect(memberDebugEnv(DEFAULT_CONFIG)).toEqual({});
  });
});
