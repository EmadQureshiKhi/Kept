import { describe, expect, it } from 'vitest';

import {
  ID_HASH_LENGTH,
  NODE_ID_PREFIXES,
  designedTestId,
  documentId,
  evidenceId,
  isDesignedTestId,
  isDocumentId,
  isEvidenceId,
  isNodeId,
  isPromiseId,
  normaliseClaim,
  promiseId,
  sha256Hex,
  toPosix,
} from '@kept/core';

/**
 * Unit tests for identifier derivation (design §3.2, R1.2).
 *
 * Property 1 (`promise-id.prop.test.ts`) states stability over generated input;
 * this file pins the named decisions `normaliseClaim` makes, one example each, so
 * a future edit to the normaliser has to change a test that says out loud what it
 * is changing.
 */

describe('toPosix', () => {
  it('converts separators, trims, collapses and drops ./ and trailing /', () => {
    expect(toPosix('apps\\fixture\\README.md')).toBe('apps/fixture/README.md');
    expect(toPosix('  apps/fixture/README.md  ')).toBe('apps/fixture/README.md');
    expect(toPosix('./apps//fixture/README.md')).toBe('apps/fixture/README.md');
    expect(toPosix('apps/fixture/')).toBe('apps/fixture');
    expect(toPosix('/')).toBe('/');
    expect(toPosix('')).toBe('');
  });

  it('preserves case, because the filesystems here are case-sensitive', () => {
    expect(toPosix('README.md')).not.toBe(toPosix('readme.md'));
  });

  it('is idempotent, so an already-normalised path keys identically', () => {
    const once = toPosix('./apps\\fixture//README.md');
    expect(toPosix(once)).toBe(once);
  });
});

describe('normaliseClaim', () => {
  it('collapses internal whitespace and trims', () => {
    expect(normaliseClaim('  The   cart\tsubtotal\n updates  ')).toBe(
      'The cart subtotal updates',
    );
  });

  it('absorbs CRLF, including the trailing \\r a CRLF file leaves behind', () => {
    // A CRLF file split on '\n' hands every line a trailing '\r' (design §3.3).
    expect(normaliseClaim('The cart subtotal updates\r')).toBe('The cart subtotal updates');
    expect(normaliseClaim('The cart\r\nsubtotal updates')).toBe('The cart subtotal updates');
  });

  it('strips leading list, quote, heading and checkbox markers', () => {
    const claim = 'The cart subtotal updates';
    for (const decorated of [
      `- ${claim}`,
      `* ${claim}`,
      `+ ${claim}`,
      `1. ${claim}`,
      `12) ${claim}`,
      `> ${claim}`,
      `>>> ${claim}`,
      `## ${claim}`,
      `###### ${claim}`,
      `- [ ] ${claim}`,
      `- [x] ${claim}`,
      `> - 3. [X] ${claim}`,
    ]) {
      expect(normaliseClaim(decorated), decorated).toBe(claim);
    }
  });

  it('keeps a leading number that is part of the claim', () => {
    // The deliberate deviation from the design sketch: a marker is only stripped
    // when whitespace follows it, so these two stay two different promises.
    expect(normaliseClaim('3.5x faster checkout')).toBe('3.5x faster checkout');
    expect(normaliseClaim('9.9x faster checkout')).toBe('9.9x faster checkout');
    expect(promiseId('README.md', '3.5x faster checkout')).not.toBe(
      promiseId('README.md', '9.9x faster checkout'),
    );
  });

  it('leaves a horizontal rule and a bare dash alone', () => {
    expect(normaliseClaim('---')).toBe('---');
    expect(normaliseClaim('-')).toBe('-');
  });

  it('normalises Unicode to NFC and drops zero-width characters', () => {
    expect(normaliseClaim('caf\u00e9 checkout')).toBe(normaliseClaim('cafe\u0301 checkout'));
    expect(normaliseClaim('fast\u200b checkout')).toBe('fast checkout');
    // Non-breaking space is whitespace to JS and collapses like any other.
    expect(normaliseClaim('fast\u00a0checkout')).toBe('fast checkout');
  });

  it('preserves case, punctuation and inline markdown', () => {
    expect(normaliseClaim('Checkout is fast.')).not.toBe(normaliseClaim('checkout is fast.'));
    expect(normaliseClaim('Checkout is fast.')).not.toBe(normaliseClaim('Checkout is fast'));
    expect(normaliseClaim('**subtotal** updates')).toBe('**subtotal** updates');
  });

  it('reduces a whitespace-only cited line to the empty claim without throwing', () => {
    for (const blank of ['', ' ', '\t', '\r', '   \t \r ', '\u00a0']) {
      expect(normaliseClaim(blank)).toBe('');
    }
  });

  it('is idempotent', () => {
    const once = normaliseClaim('> - 1.  The  cart\tsubtotal updates\r');
    expect(normaliseClaim(once)).toBe(once);
  });
});

describe('promiseId', () => {
  it('prefixes p_ and carries 12 lowercase hex characters', () => {
    const id = promiseId('apps/fixture/README.md', 'The cart subtotal updates');
    expect(id.startsWith(NODE_ID_PREFIXES.promise)).toBe(true);
    expect(id).toMatch(/^p_[0-9a-f]{12}$/);
    expect(id.slice(NODE_ID_PREFIXES.promise.length)).toHaveLength(ID_HASH_LENGTH);
    expect(isPromiseId(id)).toBe(true);
  });

  it('is a pure function of file plus normalised claim, and nothing else', () => {
    const id = promiseId('apps/fixture/README.md', 'The cart subtotal updates');
    expect(promiseId('./apps/fixture/README.md', '- The cart   subtotal updates\r')).toBe(id);
    expect(promiseId('apps\\fixture\\README.md', '## The cart subtotal updates')).toBe(id);
  });

  it('separates a different claim and a different file', () => {
    const here = promiseId('apps/fixture/README.md', 'The cart subtotal updates');
    expect(promiseId('apps/fixture/README.md', 'The cart subtotal freezes')).not.toBe(here);
    expect(promiseId('apps/fixture/CHANGELOG.md', 'The cart subtotal updates')).not.toBe(here);
  });

  it('is deterministic across processes, not just within one', () => {
    // Pinned literal: SHA-256 is unseeded, so this value is a constant of the
    // repository. If it ever changes, every verdict in every committed snapshot
    // has been orphaned — which is exactly what this line exists to catch.
    expect(promiseId('apps/fixture/README.md', 'The cart subtotal updates')).toBe(
      'p_' + sha256Hex('apps/fixture/README.md\nThe cart subtotal updates').slice(0, 12),
    );
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('accepts an empty claim and an empty file without throwing', () => {
    expect(isPromiseId(promiseId('', ''))).toBe(true);
    expect(promiseId('README.md', '   ')).toBe(promiseId('README.md', ''));
  });
});

describe('node id prefixes', () => {
  it('uses d_, p_, t_ and ev_', () => {
    expect(NODE_ID_PREFIXES).toEqual({
      document: 'd_',
      promise: 'p_',
      designedTest: 't_',
      evidence: 'ev_',
    });
  });

  it('derives document and designed-test ids from the normalised path', () => {
    expect(documentId('./apps/fixture/README.md')).toBe(documentId('apps/fixture/README.md'));
    expect(isDocumentId(documentId('apps/fixture/README.md'))).toBe(true);
    expect(designedTestId('tests\\cart_subtotal_test.md')).toBe(
      designedTestId('tests/cart_subtotal_test.md'),
    );
    expect(isDesignedTestId(designedTestId('tests/cart_subtotal_test.md'))).toBe(true);
  });

  it('keeps an evidence stamp readable, path-safe and idempotent', () => {
    expect(evidenceId('20260820T184011Z')).toBe('ev_20260820T184011Z');
    expect(evidenceId('ev_20260820T184011Z')).toBe('ev_20260820T184011Z');
    expect(evidenceId('2026-08-20T18:40:11Z')).toBe('ev_2026-08-20T18-40-11Z');
    expect(isEvidenceId(evidenceId('2026-08-20T18:40:11Z'))).toBe(true);
    expect(isEvidenceId('ev_')).toBe(false);
  });

  it('answers the guards the same way twice, holding no regex state', () => {
    const id = evidenceId('20260820T184011Z');
    expect(isEvidenceId(id)).toBe(isEvidenceId(id));
    expect(isNodeId(id)).toBe(true);
  });

  it('keeps the four id spaces disjoint', () => {
    const ids = [
      promiseId('README.md', 'claim'),
      documentId('README.md'),
      designedTestId('tests/a_test.md'),
      evidenceId('20260820T184011Z'),
    ];
    const guards = [isPromiseId, isDocumentId, isDesignedTestId, isEvidenceId];
    ids.forEach((id, index) => {
      guards.forEach((guard, guardIndex) => {
        expect(guard(id), `${id} against guard ${guardIndex}`).toBe(index === guardIndex);
      });
      expect(isNodeId(id)).toBe(true);
    });
    expect(isNodeId('p_notlowercasehex')).toBe(false);
    expect(isNodeId(null)).toBe(false);
  });
});
