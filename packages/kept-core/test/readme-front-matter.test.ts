import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The README's front matter, pinned to R13.9 (task 19.2), and the deployment
 * configuration that makes half of it true (task 19.1, R8.6, R14.6).
 *
 * R13.9 asks for the deployed Ledger URL and the demo command inside the README's
 * **first 20 lines**. Twenty is a budget, and a budget with nothing counting it is
 * a budget that drifts: the paragraph someone adds under the title is exactly the
 * edit that pushes the URL to line 21, and nothing about that edit looks wrong.
 * So the line index is asserted here rather than reviewed.
 *
 * ## The honest-placeholder problem, and which of the two options this file takes
 *
 * At the time this suite was written the deployment did not exist yet — only the
 * repository owner can create it — so there was no URL to assert. Two designs were
 * available and they are not equally honest:
 *
 *   (a) assert R13.9 unconditionally and let the suite go red until a URL lands, or
 *   (b) assert that the placeholder *is* the placeholder, and flip to asserting a
 *       real HTTPS URL the moment one replaces it.
 *
 * **This file takes (b).** (a) would leave a permanently red suite whose redness
 * says "someone has not logged into Vercel", which trains a reader to ignore a red
 * suite — the one habit a project about verification cannot afford. (b) never
 * passes on a lie either: while the placeholder is present the README makes no URL
 * claim at all, and this file holds it to making none, checking instead that the
 * placeholder cannot be mistaken for a deployment. It is not green *about* a URL;
 * it is green about there not being one.
 *
 * What keeps (b) from being silent is `it.todo` below. Vitest prints a todo in
 * every run's summary, so the outstanding edit is visible on each `npm run check`
 * rather than buried in a document, and it disappears the moment the edit is made
 * — no test to remember to re-enable, no flag to flip.
 *
 * The pending state is read off **the Live Ledger bullet alone**, not off the whole
 * front matter, and that is load-bearing. The HTML deploy note on line 5 names the
 * placeholder token in its instructions; a whole-file search for the token would
 * therefore report "still pending" forever, one commit after the URL landed. The
 * bullet is the one line that carries the claim, so the bullet is what is read.
 *
 * ## The deployment side
 *
 * `vercel.json` is checked in the last block because a URL in the README is a
 * promise about a deployment, and the shape of that deployment is unusual enough
 * to be worth pinning: `apps/ledger` has no `package.json`, so the Vercel project
 * root has to be the monorepo root and the app directory has to be named by the
 * build command instead. An edit that "tidies" that into the obvious-looking
 * `next build` with a root of `apps/ledger` produces a framework-detection failure
 * that no local command reproduces. The reasoning is in `docs/deploy-ledger.md`.
 *
 * **Validates: Requirements 13.8, 13.9, 14.1, 8.6, 14.6**
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8');
}

const README_PATH = 'README.md';
const README = read(README_PATH);
const LINES = README.split('\n');

/** R13.9's budget, and the only place the number is written. */
const LINE_BUDGET = 20;

/** 1-indexed, as a reader and an editor both count. */
const FRONT_MATTER = LINES.slice(0, LINE_BUDGET);

/**
 * The placeholder standing in for the deployed URL.
 *
 * Deliberately not URL-shaped. A stand-in that looked like a deployment —
 * `https://example.vercel.app`, say — would be a claim a reader could act on and a
 * link a crawler could follow, and the whole point of a placeholder is that
 * neither happens.
 */
const PLACEHOLDER = 'LEDGER_URL_PENDING_DEPLOY';

/** The one line that carries the claim. Backticked token, or the URL that replaces it. */
const LEDGER_BULLET = /^- \*\*Live Ledger\*\* — (.+)$/;

/** The demo command, spelled as the root manifest spells it. */
const DEMO_COMMAND = 'npm run demo';

/** The live-loop command, and the two prerequisites R13.8 names. */
const LOOP_COMMAND = 'npm run loop';

/** R14.1's stated public URL. */
const REPO_URL = 'https://github.com/EmadQureshiKhi/Kept';

const DEPLOY_DOC = 'docs/deploy-ledger.md';

interface LedgerClaim {
  /** 1-indexed line number of the bullet. */
  readonly line: number;
  /** Everything after the em dash. */
  readonly value: string;
}

/** The Live Ledger bullet inside the front matter, or `undefined`. */
function ledgerClaim(lines: readonly string[] = FRONT_MATTER): LedgerClaim | undefined {
  for (const [index, line] of lines.entries()) {
    const match = LEDGER_BULLET.exec(line);
    if (match !== null) return { line: index + 1, value: (match[1] ?? '').trim() };
  }
  return undefined;
}

const CLAIM = ledgerClaim();

/** `true` while the bullet still carries the placeholder rather than a URL. */
const PENDING = CLAIM?.value === `\`${PLACEHOLDER}\``;

/** Every absolute HTTPS URL on a line, bare or wrapped in Markdown autolink brackets. */
function httpsUrls(text: string): string[] {
  return [...text.matchAll(/https:\/\/[^\s"'`)<>\]]+/g)].map((match) => match[0]);
}

/**
 * The front matter with its image sources removed, which is what the URL-count
 * rules below are actually about.
 *
 * The header carries a row of badge images, and a badge's `src` is a
 * `https://img.shields.io/...` URL. A raw count over the whole block therefore
 * reports eight URLs where a reader sees one link, and the "never both a
 * placeholder and a URL" rule would fire on a header that makes no URL claim at
 * all — the badges say `license MIT`, not "the Ledger is at this address".
 *
 * So an `<img src>` and a Markdown `![](…)` are stripped before counting. What is
 * left is the URLs a reader could follow as a claim, which is the set both rules
 * were written to constrain. `<a href>` is deliberately **not** stripped: a
 * navigation link is a claim, and the nav row uses fragment anchors precisely so
 * the front matter carries no second address to keep in step with the first.
 */
function withoutImageSources(text: string): string {
  return text
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '');
}

describe('the README front matter carries what R13.9 requires', () => {
  it('has a Live Ledger bullet inside the first 20 lines', () => {
    expect(
      CLAIM,
      `${README_PATH} has no "- **Live Ledger** — …" line in its first ${LINE_BUDGET}. ` +
        `R13.9 wants the deployed URL there, and this suite reads that one line to ` +
        `decide whether it is a URL yet or still a placeholder.`,
    ).toBeDefined();
  });

  it(`states ${DEMO_COMMAND} inside the first 20 lines`, () => {
    const at = FRONT_MATTER.findIndex((line) => line.includes(DEMO_COMMAND));
    expect(
      at,
      `${README_PATH} does not name \`${DEMO_COMMAND}\` in its first ${LINE_BUDGET} lines. ` +
        `A judge with three minutes reads those lines and nothing else, and R13.9 says ` +
        `the demo command is one of the two things they find there.`,
    ).toBeGreaterThanOrEqual(0);
    expect(at + 1).toBeLessThanOrEqual(LINE_BUDGET);
  });

  it('names the deployed URL and the demo command in exactly one place each', () => {
    /* Two copies of a URL is two things to edit, and the second one is the one that
       gets forgotten. The repository URL and the localhost URL live below the front
       matter for the same reason: one https URL up here means the flip below has no
       ambiguity about which one it is looking at. Badge image sources are excluded —
       see `withoutImageSources`. */
    const urls = httpsUrls(withoutImageSources(FRONT_MATTER.join('\n')));
    expect(
      urls.length,
      `the front matter carries ${urls.length} linkable https URLs (${urls.join(', ')}). ` +
        `Exactly one — the deployed Ledger — or none while it is pending. Put the ` +
        `repository URL and any documentation links below line ${LINE_BUDGET}.`,
    ).toBeLessThanOrEqual(1);
  });

  it('never carries both a placeholder and a URL', () => {
    const urls = httpsUrls(withoutImageSources(FRONT_MATTER.join('\n')));
    expect(
      PENDING && urls.length > 0,
      `${README_PATH} carries the ${PLACEHOLDER} placeholder and an https URL at the ` +
        `same time. One of them is wrong and a reader cannot tell which.`,
    ).toBe(false);
  });

  it('opens with the logo, in both themes, and carries no second wordmark', () => {
    /* The header is the logo, the tagline, the badges and the nav — in that order,
       and with no `# KEPT` heading under the mark. The logo carries the name, so a
       text title beside it is the name twice.

       Both plates are asserted because the source mark is black on transparency,
       which disappears against GitHub's dark theme. One plate is wrong half the
       time, and which half depends on a reader's OS setting rather than on
       anything this repository controls. `tools/logo/build_logo.sh` builds them. */
    const header = FRONT_MATTER.join('\n');
    /* The four centred blocks sit on four consecutive lines with no blank lines
       between them. That is not formatting preference: Markdown keeps them as one
       HTML block either way, and collapsing them buys four lines for the intro
       paragraph while keeping the URL and the demo command inside R13.9's twenty. */
    expect(header, 'the logo is the first thing in the file').toMatch(
      /^<p align="center">\s*\n?\s*<picture>/,
    );
    expect(header, 'the dark-theme plate is offered first, as <picture> requires').toContain(
      '<source media="(prefers-color-scheme: dark)" srcset="Assets/kept-logo-dark.png">',
    );
    expect(header, 'the light plate is the <img> fallback every client understands').toMatch(
      /<img src="Assets\/kept-logo-light\.png" alt="KEPT" width="\d+">/,
    );
    for (const plate of ['Assets/kept-logo-light.png', 'Assets/kept-logo-dark.png']) {
      expect(
        existsSync(resolve(REPO_ROOT, plate)),
        `${plate} is referenced by the README and absent from the tree. Run ` +
          `tools/logo/build_logo.sh.`,
      ).toBe(true);
    }
    expect(
      LINES.some((line) => /^#\s+KEPT\s*$/.test(line)),
      'the logo already says KEPT; a level-one heading repeating it is the name twice',
    ).toBe(false);
  });
});

/* ────────────────── the flip: placeholder today, URL tomorrow ───────────────── */

if (PENDING) {
  it.todo(
    `R13.9: paste the deployed HTTPS Ledger URL over \`${PLACEHOLDER}\` on line ` +
      `${CLAIM?.line ?? '?'} of ${README_PATH} — see ${DEPLOY_DOC}. This suite starts ` +
      `asserting the URL by itself; nothing here needs re-enabling.`,
  );
}

describe.runIf(PENDING)('while the Ledger URL is pending, the placeholder is honest', () => {
  it('is not URL-shaped, so nothing can be mistaken for a deployment', () => {
    const value = CLAIM?.value ?? '';
    expect(value).toBe(`\`${PLACEHOLDER}\``);
    expect(value).not.toMatch(/https?:\/\//);
    expect(value).not.toMatch(/\.(?:app|com|dev|io|net|org)\b/);
  });

  it('says on its own line that it is pending, without a test having to explain it', () => {
    /* Read as a sentence by someone who never opens this file: "Live Ledger —
       LEDGER_URL_PENDING_DEPLOY". The token carries its own caveat, which is why
       there is no separate parenthetical to delete when the URL lands. */
    expect(PLACEHOLDER).toContain('PENDING');
    expect(PLACEHOLDER).toContain('DEPLOY');
  });

  it('claims no coverage of R14.6 anywhere in the front matter', () => {
    expect(FRONT_MATTER.join('\n')).not.toMatch(/\bdeployed at\b|\blive at\b/i);
  });
});

describe.runIf(!PENDING)('once deployed, the URL itself satisfies R13.9 and R14.6', () => {
  it('is a single public HTTPS URL on the Live Ledger line', () => {
    const urls = httpsUrls(CLAIM?.value ?? '');
    expect(
      urls.length,
      `the Live Ledger line no longer carries the placeholder, so it has to carry ` +
        `exactly one https URL. It carries ${urls.length}: ${CLAIM?.value ?? ''}`,
    ).toBe(1);
    const url = urls[0] ?? '';
    expect(url.startsWith('https://'), 'R14.6 says HTTPS').toBe(true);
    expect(url).not.toMatch(/^https:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/);
    expect(url, 'a bare host with no dot is not a public deployment').toMatch(
      /^https:\/\/[^/\s]+\.[^/\s]+/,
    );
    expect(url, 'the Live Ledger line is the Ledger, not the repository').not.toBe(REPO_URL);
  });

  it('sits inside the first 20 lines', () => {
    expect(CLAIM?.line ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(LINE_BUDGET);
  });
});

/* ─────────────────── the note that says which line to edit ──────────────────── */

describe('the README source says where the URL goes', () => {
  const NOTE = /<!--\s*DEPLOY[\s\S]*?-->/;

  it.runIf(PENDING)('carries a deploy note naming the token and the deploy document', () => {
    const note = NOTE.exec(README)?.[0];
    expect(
      note,
      `${README_PATH} carries no <!-- DEPLOY … --> note. Someone finishing this at 2am ` +
        `needs the instruction in the file they are editing, not only in ${DEPLOY_DOC}.`,
    ).toBeDefined();
    expect(note).toContain(PLACEHOLDER);
    expect(note).toContain(DEPLOY_DOC);
  });

  it('has the note point at the line the bullet is actually on', () => {
    const note = NOTE.exec(README)?.[0];
    if (note === undefined || CLAIM === undefined) return;
    const named = /\bline (\d+)\b/.exec(note);
    expect(
      named,
      `the deploy note does not name a line number. "replace it somewhere above" is ` +
        `how a note goes stale without anyone noticing.`,
    ).not.toBeNull();
    expect(
      Number(named?.[1]),
      `the deploy note says line ${named?.[1]} and the Live Ledger bullet is on line ` +
        `${CLAIM.line}. Fix whichever moved.`,
    ).toBe(CLAIM.line);
  });

  it('keeps the note invisible when rendered, so no reader is told to edit anything', () => {
    const note = NOTE.exec(README)?.[0] ?? '<!-- -->';
    expect(note.startsWith('<!--')).toBe(true);
    expect(note.endsWith('-->')).toBe(true);
  });
});

/* ──────────────────────── the live loop, below the fold ─────────────────────── */

describe('the live loop is documented with its prerequisites (R13.8)', () => {
  it('names the command', () => {
    expect(README).toContain(LOOP_COMMAND);
    expect(README).toContain('bin/kept verify --all --member-debug');
  });

  it('names both prerequisites R13.8 lists, and does so beside the command', () => {
    const lower = README.toLowerCase();
    expect(lower, 'a local Chrome installation').toContain('chrome');
    expect(lower, 'Kane CLI credentials').toContain('credentials');
    const loopAt = README.indexOf(LOOP_COMMAND);
    const chromeAt = lower.indexOf('chrome', loopAt);
    expect(
      chromeAt - loopAt,
      `the Chrome prerequisite is ${chromeAt - loopAt} characters after ${LOOP_COMMAND}. ` +
        `A prerequisite a reader meets after they have already run the command is not a ` +
        `prerequisite.`,
    ).toBeLessThan(600);
  });

  it('states the cost honestly rather than claiming the loop is free', () => {
    /* R4.6 says a replay reports 0 credits and that is true of the eight passing
       members and false of the ninth. The README has to carry both halves, because
       a reader who runs this spends real money on exactly one of nine members. */
    expect(README).toContain('0.0000');
    expect(README).toContain('9.85');
    expect(README.toLowerCase()).toMatch(/free where (?:a member )?passes/);
  });

  it('says what --member-debug is for, which is not debugging', () => {
    const denial = /`--member-debug` is \*\*not\*\* a debugging flag/;
    expect(
      README,
      'the flag is in the command line but never explained, and a reader who reads it ' +
        'as optional noise drops the signal the repair branch routes on',
    ).toMatch(denial);
    const at = denial.exec(README)?.index ?? -1;
    expect(README.slice(at, at + 500).toLowerCase()).toContain('classification signal');
  });

  it('names the deliberate failure and does not hide it', () => {
    expect(README).toContain('T-7');
    expect(README).toContain('tests/cart_discount_test.md');
    expect(README.toLowerCase()).toContain('docs-lie');
  });
});

describe('the headless bootstrap recipe is in the README, in order', () => {
  const INGEST = 'kane-cli context ingest apps/fixture/README.md --mode ci';
  const EXTRACT = 'kane-cli context extract --mode agent';

  it('carries both commands, ingest before extract', () => {
    const ingestAt = README.indexOf(INGEST);
    const extractAt = README.indexOf(EXTRACT);
    expect(ingestAt, `${README_PATH} does not carry \`${INGEST}\``).toBeGreaterThanOrEqual(0);
    expect(extractAt, `${README_PATH} does not carry \`${EXTRACT}\``).toBeGreaterThanOrEqual(0);
    expect(
      ingestAt,
      'extract is documented before ingest, and the order is the whole point: ingest ' +
        'lands only, so extraction is a second command rather than a continuation.',
    ).toBeLessThan(extractAt);
  });

  it('warns that a headless ingest looks like it did nothing', () => {
    const lower = README.toLowerCase();
    expect(lower).toContain('lands only');
    expect(
      lower,
      'the remedy arrives on stderr, which is the detail that turns a silent success ' +
        'into a readable one',
    ).toContain('stderr');
  });

  it('records the two refusals a headless caller meets', () => {
    expect(README).toContain('UC_UNREVIEWED');
    expect(README).toContain('--allow-unreviewed');
    expect(
      README,
      '`context list` taking no --mode flag is the correction that matters most: it is ' +
        'the one the source resolver depends on',
    ).toMatch(/`context list` has \*\*no `--mode` flag/);
  });
});

describe('the repository states its own public URL (R14.1)', () => {
  it('names it', () => {
    expect(README).toContain(REPO_URL);
  });

  it('keeps it out of the front matter, where the Ledger URL lives alone', () => {
    expect(FRONT_MATTER.join('\n')).not.toContain(REPO_URL);
  });
});

describe('the README still links the documents it summarises', () => {
  for (const path of [
    'docs/submission-summary.md',
    'docs/judge-path.md',
    'docs/commit-history-audit.md',
    'docs/kane/credits.md',
    'docs/kane/context-bootstrap.md',
    'docs/kane/replay/README.md',
    DEPLOY_DOC,
  ]) {
    it(`links ${path}`, () => {
      expect(
        README,
        `${README_PATH} cites a figure from ${path} without linking it, so a reader ` +
          `cannot check it.`,
      ).toContain(path);
    });
  }

  it('cites its figures rather than restating the measurement', () => {
    /* Every number in the front matter and the loop section is read out of a
       committed document. These are the four that would otherwise drift. */
    expect(read('docs/judge-path.md')).toContain('**3.6 s**');
    expect(read('docs/kane/replay/README.md')).toContain('215–242 s');
    expect(read('docs/kane/replay/README.md')).toContain('0.0000');
    expect(read('docs/kane/replay/README.md')).toContain('9.8505');
  });

  it('links a LICENSE file that exists, because the badge claims one', () => {
    expect(README).toContain('[LICENSE](LICENSE)');
    expect(read('LICENSE')).toContain('MIT License');
  });

  it('states a test-file count that matches the files on disk', () => {
    /* The README quotes the suite's size twice — once in the verification section and
       once in Status. A count nobody checks is a count that drifts, and this one drifts
       on the most ordinary edit there is: adding a test file. So it is counted here.
       Adding a test and updating the number are the same commit, which is the point. */
    const stated = /\*\*(\d+) files, [\d,]+ tests/.exec(README)?.[1];
    expect(stated, 'the verification section no longer states "**N files, M tests"').toBeDefined();

    /* Walked rather than listed. A hard-coded root list is how this check misses a
       whole directory — `apps/fixture/test` was missed exactly that way on the first
       attempt, and a guard that silently undercounts is worse than none. */
    const IGNORED = new Set(['node_modules', '.next', 'dist', '.git']);
    const countTests = (dir: string): number => {
      let total = 0;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!IGNORED.has(entry.name)) total += countTests(resolve(dir, entry.name));
        } else if (/\.test\.tsx?$/.test(entry.name)) {
          total += 1;
        }
      }
      return total;
    };
    const found = ['packages', 'apps'].reduce(
      (total, root) => total + countTests(resolve(REPO_ROOT, root)),
      0,
    );

    expect(
      Number(stated),
      `${README_PATH} says ${stated} test files and there are ${found}. Whichever moved, ` +
        `move the other — the suite's size is a claim like any other.`,
    ).toBe(found);
  });
});

/* ─────────────────────────── the rendered diagrams ──────────────────────────── */

describe('every diagram the README embeds is committed and renderable', () => {
  /** `![alt](path)` for each image whose path is under `Assets/`. */
  const EMBEDS = [...README.matchAll(/!\[([\s\S]*?)\]\((Assets\/[^)\s]+)\)/g)].map((match) => ({
    alt: (match[1] ?? '').replace(/\s+/g, ' ').trim(),
    path: match[2] ?? '',
  }));

  it('makes each one a link to itself, so the detail is reachable', () => {
    /* The canvases are 1740px wide and GitHub's content column is roughly 870, so
       every diagram is downscaled about 2x where it sits. The detail is still there
       — they are vectors — but a reader cannot reach it unless the image links to
       its own file, where the SVG renders standalone and browser zoom is lossless.

       That is the ceiling for a README: GitHub strips script and inline handlers
       from rendered Markdown, so zoom controls and drag-to-pan are unavailable in
       the page itself. This link is the whole affordance, which is why it is
       asserted rather than left to whoever edits the file next. */
    for (const embed of EMBEDS) {
      expect(
        README,
        `${embed.path} is embedded but not linked. Wrap it as [![alt](path)](path) — ` +
          `run tools/diagrams/link_readme_diagrams.py — or the 2x downscale is all a ` +
          `reader ever gets.`,
      ).toContain(`](${embed.path})](${embed.path})`);
    }
  });

  it('says the diagram is clickable, since that is not a known convention', () => {
    const captions = [...README.matchAll(/<sub>Click the diagram to open it at full size\.<\/sub>/g)];
    expect(
      captions.length,
      `${captions.length} captions for ${EMBEDS.length} diagrams. Reaching detail that ` +
        `is invisible at the rendered size is the point, so every diagram says so.`,
    ).toBe(EMBEDS.length);
  });

  it('embeds the five system diagrams', () => {
    expect(
      EMBEDS.map((embed) => embed.path).sort(),
      'the README describes five things a diagram is better at than prose: the system, ' +
        'the three Kane contracts, the code-break loop, the three repair branches, and ' +
        'the promise lifecycle',
    ).toEqual([
      'Assets/kept-architecture.svg',
      'Assets/kept-promise-lifecycle.svg',
      'Assets/kept-repair-branches.svg',
      'Assets/kept-three-contracts.svg',
      'Assets/kept-verify-path.svg',
    ]);
  });

  for (const embed of EMBEDS) {
    describe(embed.path, () => {
      it('exists and is well-formed SVG', () => {
        const svg = read(embed.path);
        expect(svg.trimStart().startsWith('<svg')).toBe(true);
        expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      });

      it('fetches nothing at render, because a browser will not load it', () => {
        /* An SVG rendered through `<img>` — which is what a Markdown image is — loads
           no external subresource, for good security reasons. So a diagram that
           *referenced* the logo PNG rendered fine in a local preview and came out with
           a hole in it on the site.
        
           The rule is therefore about the reference, not about the element: an <image>
           carrying a base64 data URI is entirely self-contained and renders everywhere,
           which is how the header mark is embedded. An earlier version of this test
           banned <image> outright, which is why the first pass at these diagrams drew
           a substitute glyph instead of using the real logo. */
        const svg = read(embed.path);
        const external = [...svg.matchAll(/(?:xlink:)?href\s*=\s*"([^"]*)"/gi)]
          .map((match) => match[1] ?? '')
          .filter((href) => !href.startsWith('#') && !href.startsWith('data:'));
        expect(
          external,
          `${embed.path} reaches outside itself for ${external.join(', ')}. Inline it as a ` +
            `data URI: nothing external is loaded when an SVG is itself an image.`,
        ).toEqual([]);
        const embedded = [...svg.matchAll(/(?:xlink:)?href\s*=\s*"(data:[^,"]*)/gi)].map(
          (match) => match[1] ?? '',
        );
        expect(embedded.length, `${embed.path} embeds no mark`).toBeGreaterThan(0);
        for (const prefix of embedded) {
          expect(prefix, 'an embedded resource should be a base64 PNG').toBe(
            'data:image/png;base64',
          );
        }
      });

      it('carries alt text a reader who cannot see it can use', () => {
        /* A diagram is the one place this README says something in pixels. The alt
           text has to carry the same claim in words — not the file name, and not
           "diagram". The floor is deliberately a sentence rather than a label. */
        expect(embed.alt.length, `alt text for ${embed.path} is "${embed.alt}"`).toBeGreaterThan(
          160,
        );
        expect(embed.alt.toLowerCase()).not.toMatch(/^(?:diagram|image|figure)\b/);
        expect(embed.alt).toMatch(/KEPT|promise|Kane|verdict|branch|contract|loop/i);
      });

      it('states the same thing in its own <desc> as the README states in alt', () => {
        /* Two hand-maintained copies of one paragraph is one too many, so the SVG's
           <desc> is the source and `tools/diagrams/sync_readme_alt.py` copies it out.
           This is what makes that a guarantee rather than a habit: a diagram whose
           description changed and whose alt text did not is a failure here.

           <desc> is not optional either. It is what `aria-labelledby` points at, and
           it is the only representation available to a reader using a screen reader. */
        const svg = read(embed.path);
        const desc = /<desc id="d">([\s\S]*?)<\/desc>/.exec(svg)?.[1];
        expect(desc, `${embed.path} carries no <desc>`).toBeDefined();
        expect(svg, 'role="img" is what makes the title and desc reachable').toContain(
          'role="img" aria-labelledby="t d"',
        );
        const normalise = (text: string): string =>
          text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();
        expect(
          normalise(embed.alt),
          `the alt text in ${README_PATH} and the <desc> in ${embed.path} disagree. ` +
            `Run tools/diagrams/sync_readme_alt.py, or bash tools/build-diagrams.sh.`,
        ).toBe(normalise(desc ?? ''));
      });

      it('is black on white, because colour is the Ledger\'s verdict channel', () => {
        /* The diagrams carry no hue at all: weight, dashing and fill tone do the work,
           so they survive being printed, projected, or read by someone who does not
           separate hues. It is also a discipline worth keeping mechanical, since one
           coloured box in one diagram is how a house style stops being one. */
        const svg = read(embed.path);
        const hexes = new Set(
          [...svg.matchAll(/#[0-9a-fA-F]{6}/g)].map((match) => match[0].toLowerCase()),
        );
        const chromatic = [...hexes].filter((hex) => {
          const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
          return Math.max(...channels) - Math.min(...channels) > 8;
        });
        expect(
          chromatic,
          `${embed.path} carries a chromatic fill: ${chromatic.join(', ')}. Use stroke ` +
            `weight, dashing or fill tone instead.`,
        ).toEqual([]);
      });
    });
  }
});

/* ───────────────── the deployment the front matter points at ────────────────── */

describe('the Vercel configuration deploys the Ledger with no environment (R8.6, R14.6)', () => {
  interface VercelConfig {
    readonly framework?: string;
    readonly installCommand?: string;
    readonly buildCommand?: string;
    readonly outputDirectory?: string;
    readonly env?: unknown;
    readonly build?: { readonly env?: unknown };
  }

  const CONFIG_PATH = 'vercel.json';
  const config = JSON.parse(read(CONFIG_PATH)) as VercelConfig;

  it('installs at the monorepo root with the lockfile', () => {
    expect(config.installCommand).toBe('npm ci');
  });

  it('names the app directory in the build command, because it is not its own package', () => {
    expect(config.framework).toBe('nextjs');
    expect(
      config.buildCommand,
      `apps/ledger has no package.json on purpose, so the Vercel project root is the ` +
        `monorepo root and the app has to be named as an argument to next build. ` +
        `See ${DEPLOY_DOC}.`,
    ).toMatch(/next build .*apps\/ledger$/);
    expect(config.outputDirectory).toBe('apps/ledger/.next');
  });

  it('still has no package.json under apps/ledger, which is what forces that shape', () => {
    expect(() => read('apps/ledger/package.json')).toThrow();
  });

  it('declares zero environment variables', () => {
    expect(
      config.env,
      `R8.6's zero-Kane guarantee is easiest to keep by having nothing to configure. ` +
        `An env block in ${CONFIG_PATH} is the first step away from that.`,
    ).toBeUndefined();
    expect(config.build?.env).toBeUndefined();
    expect(read(CONFIG_PATH)).not.toMatch(/KANE|API_KEY|TOKEN|SECRET/i);
  });

  it('leaves .vercel out of the repository', () => {
    expect(read('.gitignore')).toMatch(/^\.vercel$/m);
  });
});
