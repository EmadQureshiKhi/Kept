import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FAILURE_YAML_FILENAMES,
  TRIAGE_SIGNAL_FIELDS,
  createDiagnosticSink,
  findFailureYamlArtifact,
  loadFailureYaml,
  loadFailureYamlFromEvidence,
  nodeFailureYamlFileSystem,
  type CollectingDiagnosticSink,
  type FailureYaml,
} from 'kept-core';

/**
 * Unit tests for `kane/failureYaml.ts` (design §6.3, R6.7).
 *
 * The four `failure-*.yaml` fixtures are read **off disk**, not inlined: the
 * three parseable ones each use a different accepted alias and the fourth is
 * verified-invalid YAML, so the committed files are the point of the exercise
 * (`test/fixtures/README.md`). Inlining copies would let the fixtures drift away
 * from the loader that claims to read them.
 *
 * Branch selection is task 11.4 and is asserted nowhere here. What is asserted is
 * the signal, the field it came from, and that a document which never parsed is
 * distinguishable from one that parsed and said nothing.
 */

const FIXTURES = resolve(fileURLToPath(new URL('./fixtures/', import.meta.url)));

const fixture = (name: string): string => join(FIXTURES, name);

let sink: CollectingDiagnosticSink;

beforeEach(() => {
  sink = createDiagnosticSink();
});

/** Load a fixture from disk through the production read. */
function loadFixture(name: string): FailureYaml | null {
  return loadFailureYaml({ path: fixture(name), diagnostics: sink });
}

describe('loadFailureYaml — the four committed fixtures, read from disk', () => {
  it('reads product_bug through the nested triage.category alias', () => {
    const loaded = loadFixture('failure-product-bug.yaml');

    expect(loaded).not.toBeNull();
    expect(loaded?.signal).toBe('product_bug');
    expect(loaded?.signalField).toBe('triage.category');
    expect(loaded?.isMapping).toBe(true);
    expect(loaded?.path).toBe(fixture('failure-product-bug.yaml'));
    // Nested severity/confidence/one_liner are surfaced for RoutedRepair (R6.4).
    expect(loaded?.severity).toBe('high');
    expect(loaded?.confidence).toBe(0.9);
    expect(loaded?.oneLiner).toBe('subtotal did not change after quantity increment');
    // The fixture types the code as a string; the coercing accessor normalises.
    expect(loaded?.resultCode).toBe(740);
    expect(sink.hasSeverity('warn')).toBe(false);
  });

  it('reads selector_not_found through the top-level category alias', () => {
    const loaded = loadFixture('failure-selector.yaml');

    expect(loaded?.signal).toBe('selector_not_found');
    expect(loaded?.signalField).toBe('category');
    expect(loaded?.severity).toBe('medium');
    expect(loaded?.confidence).toBe(0.72);
    // Inside the same band as the assertion class on purpose — the loader
    // surfaces both signals and orders neither (ordering is task 11.4).
    expect(loaded?.resultCode).toBe(715);
    expect(loaded?.signal).not.toBeNull();
  });

  it('reads assertion through the classification alias', () => {
    const loaded = loadFixture('failure-assertion.yaml');

    expect(loaded?.signal).toBe('assertion');
    expect(loaded?.signalField).toBe('classification');
    expect(loaded?.severity).toBe('low');
    expect(loaded?.confidence).toBe(0.95);
    expect(loaded?.resultCode).toBe(742);
  });

  it('returns null for the deliberately invalid fixture, with the parser reason', () => {
    const loaded = loadFixture('failure-unparseable.yaml');

    expect(loaded).toBeNull();
    const [diagnostic] = sink.withCode('failure-yaml-unparseable');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe('warn');
    // The real reason, not the word "failed" — the fixture's unterminated quote.
    expect(diagnostic?.message).toContain('quote');
    expect(diagnostic?.line).toBe(6);
    expect(diagnostic?.file).toBe(fixture('failure-unparseable.yaml'));
  });

  it('preserves the whole parsed document, nested structures included', () => {
    const loaded = loadFixture('failure-product-bug.yaml');
    const artifacts = loaded?.fields['artifacts'] as Record<string, unknown> | undefined;

    expect(loaded?.fields['test_id']).toBe('T-3');
    expect(artifacts?.['screenshots']).toEqual(['step-3.png', 'step-4.png']);
    expect(loaded?.document).toEqual(loaded?.fields);
  });
});

describe('loadFailureYaml — alias precedence', () => {
  it('accepts the reason alias, which has no committed fixture', () => {
    const loaded = loadFailureYaml({ content: 'reason: Timeout\n', diagnostics: sink });

    expect(loaded?.signal).toBe('timeout');
    expect(loaded?.signalField).toBe('reason');
  });

  it('prefers each alias over the ones after it, deepest spelling first', () => {
    const all = [
      'triage:',
      '  rca:',
      '    category: from_rca',
      '  category: from_triage',
      'category: from_category',
      'classification: from_classification',
      'reason: from_reason',
      '',
    ].join('\n');

    // `triage.rca.category` is the spelling every real sealed pack uses, so it
    // outranks the three shallower ones rather than merely joining them.
    expect(loadFailureYaml({ content: all })?.signalField).toBe('triage.rca.category');
    expect(loadFailureYaml({ content: all })?.signal).toBe('from_rca');

    const withoutRca = ['triage:', ...all.split('\n').slice(3)].join('\n');
    expect(loadFailureYaml({ content: withoutRca })?.signalField).toBe('triage.category');

    const withoutNested = all.split('\n').slice(4).join('\n');
    expect(loadFailureYaml({ content: withoutNested })?.signalField).toBe('category');

    const withoutCategory = all.split('\n').slice(5).join('\n');
    expect(loadFailureYaml({ content: withoutCategory })?.signalField).toBe('classification');

    const reasonOnly = all.split('\n').slice(6).join('\n');
    expect(loadFailureYaml({ content: reasonOnly })?.signalField).toBe('reason');
  });

  it('reads confidence out of triage.rca, which is where a real note puts it', () => {
    // Measured off a sealed pack: `category` and `confidence` sit under
    // `triage.rca`, `severity` one level up under `triage`. A reader that knew
    // only the shallower two published a category with no confidence beside it.
    const loaded = loadFailureYaml({
      content: [
        'triage:',
        '  rca:',
        '    category: application_issue/ui_data_defect',
        '    confidence: 0.96',
        '  severity: major',
        '',
      ].join('\n'),
    });

    expect(loaded?.signal).toBe('application_issue/ui_data_defect');
    expect(loaded?.signalField).toBe('triage.rca.category');
    expect(loaded?.confidence).toBe(0.96);
    expect(loaded?.severity).toBe('major');
  });

  it('does not mistake reason_code for the reason alias', () => {
    // Every committed fixture carries `reason_code`; only exact `reason` counts.
    const loaded = loadFailureYaml({ content: 'reason_code: failure.product_bug\n' });

    expect(loaded?.signal).toBeNull();
    expect(loaded?.signalField).toBeNull();
  });

  it('skips an alias that is present but empty or the wrong type', () => {
    const loaded = loadFailureYaml({
      content: ['triage:', '  category: "   "', 'category: 42', 'classification: Assertion', ''].join('\n'),
    });

    expect(loaded?.signalField).toBe('classification');
    expect(loaded?.signal).toBe('assertion');
  });

  it('reads triage.category only from a mapping, never from a sequence', () => {
    const loaded = loadFailureYaml({
      content: ['triage:', '  - category: from_sequence', 'category: from_top_level', ''].join('\n'),
    });

    expect(loaded?.signalField).toBe('category');
  });
});

describe('loadFailureYaml — documents that are not mappings', () => {
  it('treats an empty document as parsed-but-silent, not as absent', () => {
    const loaded = loadFailureYaml({ content: '', diagnostics: sink });

    expect(loaded).not.toBeNull();
    expect(loaded?.document).toBeNull();
    expect(loaded?.fields).toEqual({});
    expect(loaded?.isMapping).toBe(false);
    expect(loaded?.signal).toBeNull();
    expect(sink.has('failure-yaml-empty')).toBe(true);
    expect(sink.has('failure-yaml-absent')).toBe(false);
  });

  it('treats a comment-only document the same way', () => {
    expect(loadFailureYaml({ content: '# nothing here\n' })?.document).toBeNull();
  });

  it('returns a record for a scalar root and reads no field from it', () => {
    const loaded = loadFailureYaml({ content: 'product_bug\n', diagnostics: sink });

    expect(loaded?.document).toBe('product_bug');
    expect(loaded?.fields).toEqual({});
    expect(loaded?.signal).toBeNull();
    expect(loaded?.resultCode).toBeNull();
    expect(sink.has('failure-yaml-not-a-mapping')).toBe(true);
  });

  it('returns a record for a sequence root and reads no field from it', () => {
    const loaded = loadFailureYaml({
      content: '- category: product_bug\n- severity: high\n',
      diagnostics: sink,
    });

    expect(Array.isArray(loaded?.document)).toBe(true);
    expect(loaded?.fields).toEqual({});
    expect(loaded?.signal).toBeNull();
    expect(sink.has('failure-yaml-not-a-mapping')).toBe(true);
  });

  it('records that a mapping carried no accepted alias', () => {
    const loaded = loadFailureYaml({ content: 'schema: 1\nstep: 4\n', diagnostics: sink });

    expect(loaded?.isMapping).toBe(true);
    expect(loaded?.signal).toBeNull();
    expect(sink.has('failure-yaml-no-signal')).toBe(true);
  });
});

describe('loadFailureYaml — adversity is data', () => {
  it('returns null and diagnoses an absent path', () => {
    const loaded = loadFailureYaml({ path: fixture('failure-does-not-exist.yaml'), diagnostics: sink });

    expect(loaded).toBeNull();
    expect(sink.has('failure-yaml-absent')).toBe(true);
    expect(sink.withCode('failure-yaml-absent')[0]?.severity).toBe('warn');
  });

  it('returns null and diagnoses no path and no content at all', () => {
    expect(loadFailureYaml({ diagnostics: sink })).toBeNull();
    expect(sink.has('failure-yaml-absent')).toBe(true);
  });

  it('returns null and quotes the reason when the injected read throws', () => {
    const loaded = loadFailureYaml({
      path: '/sealed/pack/failure.yaml',
      fs: {
        readFile(): string | null {
          throw new Error('EACCES: permission denied');
        },
      },
      diagnostics: sink,
    });

    expect(loaded).toBeNull();
    expect(sink.withCode('failure-yaml-unreadable')[0]?.message).toContain('EACCES');
  });

  it('refuses an alias bomb instead of expanding it', () => {
    const bomb = [
      'a: &a ["x","x"]',
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]',
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]',
      'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]',
      'e: [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]',
      '',
    ].join('\n');

    const loaded = loadFailureYaml({ content: bomb, path: '/pack/failure.yaml', diagnostics: sink });

    expect(loaded).toBeNull();
    expect(sink.has('failure-yaml-unmaterialised')).toBe(true);
    expect(sink.withCode('failure-yaml-unmaterialised')[0]?.message).toContain('alias');
  });

  it('answers null for a deeply nested document rather than hanging', () => {
    const deep = `${'['.repeat(2000)}${']'.repeat(2000)}`;
    const loaded = loadFailureYaml({ content: deep, diagnostics: sink });

    // Either the parser rejects the depth or it materialises it; both are
    // answers, and neither is a throw.
    expect(loaded === null || loaded.signal === null).toBe(true);
    expect(sink.hasSeverity('error')).toBe(false);
  });

  it('never throws for any of a spread of hostile inputs', () => {
    const hostile = [
      '\uFEFFcategory: product_bug\n',
      'category: !!python/object/apply:os.system ["echo"]\n',
      '\u0000\u0001\u0002',
      '---\ncategory: a\n---\ncategory: b\n',
      'category: *missing\n',
      '{',
      'a'.repeat(100_000),
    ];

    for (const content of hostile) {
      expect(() => loadFailureYaml({ content, diagnostics: sink })).not.toThrow();
    }
    // The BOM case is the one that must still read its field.
    expect(loadFailureYaml({ content: '\uFEFFcategory: product_bug\n' })?.signal).toBe('product_bug');
  });
});

describe('composing with the evidence resolver', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kept-failure-yaml-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('loads the failure.yaml of the newest pack for an ExecutionRun', () => {
    const packDir = join(root, 'session', 'evidence', 'ev_20260820T184011Z');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, 'failure.yaml'), 'triage:\n  category: product_bug\n', 'utf8');
    writeFileSync(join(packDir, 'annotated.png'), 'not really a png', 'utf8');

    const loaded = loadFailureYamlFromEvidence({
      family: 'ExecutionRun',
      sessionDir: join(root, 'session'),
      cwd: root,
      diagnostics: sink,
    });

    expect(loaded?.signal).toBe('product_bug');
    expect(loaded?.path).toBe(join(packDir, 'failure.yaml'));
  });

  it('returns null when the family seals no pack', () => {
    const loaded = loadFailureYamlFromEvidence({
      family: 'Assurance',
      cwd: root,
      diagnostics: sink,
    });

    expect(loaded).toBeNull();
    expect(sink.has('failure-yaml-absent')).toBe(true);
  });

  it('returns null when the pack holds no failure.yaml', () => {
    const packDir = join(root, '.testmuai', 'evidence', 'ev_1');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, 'run.log'), 'nothing to triage', 'utf8');

    const loaded = loadFailureYamlFromEvidence({
      family: 'ExecutionTestrun',
      cwd: root,
      diagnostics: sink,
    });

    expect(loaded).toBeNull();
    expect(sink.withCode('failure-yaml-absent')[0]?.message).toContain('no failure.yaml');
  });

  it('prefers the pack-root failure.yaml over a nested copy', () => {
    const artifact = findFailureYamlArtifact({
      id: 'ev_1',
      dir: '/pack',
      sealedAt: null,
      archive: false,
      artifacts: [
        {
          kind: 'failure-yaml',
          name: 'nested/failure.yaml',
          path: '/pack/nested/failure.yaml',
          bytes: 1,
          modifiedAt: null,
        },
        {
          kind: 'failure-yaml',
          name: 'failure.yml',
          path: '/pack/failure.yml',
          bytes: 1,
          modifiedAt: null,
        },
      ],
    });

    expect(artifact?.name).toBe('failure.yml');
    expect(findFailureYamlArtifact(null)).toBeNull();
  });
});

describe('exported constants', () => {
  it('names the five accepted aliases in design precedence order', () => {
    expect(TRIAGE_SIGNAL_FIELDS).toEqual([
      'triage.rca.category',
      'triage.category',
      'category',
      'classification',
      'reason',
    ]);
  });

  it('names both file spellings the evidence classifier recognises', () => {
    expect(FAILURE_YAML_FILENAMES).toEqual(['failure.yaml', 'failure.yml']);
  });

  it('answers null from the production read for a directory rather than a file', () => {
    expect(nodeFailureYamlFileSystem.readFile(FIXTURES)).toBeNull();
  });
});
