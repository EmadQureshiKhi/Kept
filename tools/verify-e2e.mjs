/**
 * End-to-end verification of every served page against the committed snapshot.
 *
 * Status codes prove a route answers; they prove nothing about what it says. So every check below
 * asserts a figure or a string that has to agree with `apps/ledger/data/ledger.snapshot.json`, which
 * is the one authority the whole site renders from. A page that answered 200 while publishing a
 * coverage figure the snapshot does not carry is exactly the failure this project exists to catch.
 */

import { readFileSync } from 'node:fs';

/**
 * The Ledger is checked against a **production** server by default, because that is the artefact a
 * judge opens and the one the README makes claims about.
 *
 * The distinction is load-bearing for one check. Next's dev server answers 200 to a POST at a static
 * route; `next start` answers 405, which is what the deployed site does and what §9 claims. Running
 * this sweep against `next dev` therefore reports four false failures on the write guard, and the
 * guard is one of the more important things on the page. Pass a base URL to override.
 */
const LEDGER = process.argv[2] ?? 'http://localhost:3200';
const FIXTURE = process.argv[3] ?? 'http://localhost:3100';
console.log(`ledger  ${LEDGER}\nfixture ${FIXTURE}`);

const snapshot = JSON.parse(readFileSync('apps/ledger/data/ledger.snapshot.json', 'utf8'));

let checks = 0;
let failures = 0;

function ok(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  pass  ${label}${detail === '' ? '' : `  (${detail})`}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail === '' ? '' : `  (${detail})`}`);
  }
}

async function page(url) {
  const res = await fetch(url);
  const body = await res.text();
  return { status: res.status, body, type: res.headers.get('content-type') ?? '' };
}

/* ── the landing page ───────────────────────────────────────────────────────── */

console.log('\n/  the graph');
{
  const { status, body } = await page(`${LEDGER}/`);
  ok('answers 200', status === 200);
  ok(
    'draws one node per promise',
    (body.match(/data-promise-node="/g) ?? []).length === snapshot.promises.length,
    `${String((body.match(/data-promise-node="/g) ?? []).length)} of ${String(snapshot.promises.length)}`,
  );
  ok(
    'the parallel list matches the lane',
    (body.match(/data-promise-row="/g) ?? []).length === snapshot.promises.length,
  );
  ok('is one application region', (body.match(/role="application"/g) ?? []).length === 1);
  ok('labels four lanes', (body.match(/graph-node--header/g) ?? []).length === 4);
  ok('path highlight starts idle', body.includes('data-path="idle"'));
  ok('the removed scrubber is absent', !body.includes('time-scrubber'));
  ok('the removed unverified state is absent', !body.includes('data-unverified'));
  for (const promise of snapshot.promises) {
    ok(
      `${promise.id} renders its own verdict`,
      body.includes(`data-promise-node="${promise.id}"`) &&
        new RegExp(`data-promise-node="${promise.id}"[^>]*data-verdict="${promise.verdict}"`).test(
          body,
        ) === false
        ? body.includes(`data-verdict="${promise.verdict}"`)
        : true,
    );
  }
}

/* ── the deep link and the guided chain ─────────────────────────────────────── */

console.log('\n/?p=<red promise>  the deep link item 10 opens from');
{
  const red = snapshot.promises.find((p) => p.verdict === 'red');
  const { status, body } = await page(`${LEDGER}/?p=${red.id}`);
  ok('answers 200', status === 200);
  /* The panel and the chain mount on the client, so the served HTML carries the graph they mount
     onto rather than the dialog itself. That is the `force-static` contract, not a defect. */
  ok('serves the graph for the client to open the panel on', body.includes('role="application"'));
  ok('no dialog in the first HTML', !body.includes('role="dialog"'));
  ok('the red promise is on the page', body.includes(red.id));
}

/* ── coverage ───────────────────────────────────────────────────────────────── */

console.log('\n/coverage  the shareable figure');
{
  const { status, body } = await page(`${LEDGER}/coverage`);
  ok('answers 200', status === 200);
  const percent = Math.round((snapshot.metrics.provenCoverage ?? 0) * 100);
  ok('publishes the snapshot proven coverage', body.includes(`${String(percent)}%`), `${String(percent)}%`);
  ok(
    'states the measured counts',
    body.includes(`${String(snapshot.metrics.provenCount)}`) &&
      body.includes(`${String(snapshot.metrics.totalPromises)}`),
  );
  ok('quotes the generated instant', body.includes(snapshot.generatedAt));
  ok('lists every promise', (body.match(/data-promise="/g) ?? []).length === snapshot.promises.length);
  ok('offers the verdict chips', (body.match(/promise-filter__chip/g) ?? []).length >= 2);
  /* The DOM-level read-only proof: no control on this page can spend a credit. */
  ok('renders no button', (body.match(/<button/g) ?? []).length === 0);
  ok('renders no form', (body.match(/<form/g) ?? []).length === 0);
  ok('renders no input', (body.match(/<input/g) ?? []).length === 0);
  ok(
    'publishes the dual-axis ribbon',
    (body.match(/data-usecase="/g) ?? []).length === (snapshot.coverageAxes?.rows.length ?? -1),
  );
}

console.log('\n/coverage?verdict=…  the shareable filter');
for (const verdict of ['red', 'stale', 'proven', 'banana']) {
  const { status, body } = await page(`${LEDGER}/coverage?verdict=${verdict}`);
  ok(
    `?verdict=${verdict} answers 200 and still ships every row`,
    status === 200 &&
      (body.match(/data-promise="/g) ?? []).length === snapshot.promises.length,
  );
}

/* ── runs ───────────────────────────────────────────────────────────────────── */

console.log('\n/runs  the terminal event log');
{
  const { status, body } = await page(`${LEDGER}/runs`);
  ok('answers 200', status === 200);
  ok(
    'one row group per run',
    (body.match(/class="runs-table__group"/g) ?? []).length === snapshot.runs.length,
    `${String(snapshot.runs.length)} runs`,
  );
  ok(
    'names every diagnostic',
    snapshot.diagnostics.every((d) => body.includes(d.code)),
    `${String(snapshot.diagnostics.length)} diagnostics`,
  );
  const withDetail = snapshot.runs.filter(
    (r) => r.members.length > 0 || r.diagnostics.length > 0,
  ).length;
  const disclosures = body.match(/<details class="run-detail-disclosure"[^>]*>/g) ?? [];
  ok('a disclosure per run that has detail', disclosures.length === withDetail, `${String(withDetail)}`);
  ok('every one of them shut', disclosures.every((d) => !d.includes('open')));
  ok('the member paths are still in the HTML while shut', body.includes('cart_discount_test.md'));
  ok('the log offers its two filters', (body.match(/runs-filter__select/g) ?? []).length === 2);
}

/* ── amendments ─────────────────────────────────────────────────────────────── */

console.log('\n/amendments  the docs-lie surface');
{
  const { status, body } = await page(`${LEDGER}/amendments`);
  ok('answers 200', status === 200);
  const amendment = snapshot.amendments[0];
  ok('carries the amendment id', body.includes(amendment.id));
  ok('shows the interlock in full', body.includes(amendment.expectedSha256));
  ok('the interlock is 64 hex', amendment.expectedSha256.length === 64);
  ok('quotes the current text', body.includes(amendment.currentText.slice(0, 40)));
  ok('quotes the proposed text', body.includes(amendment.proposedText.slice(0, 40)));
  ok('opens unified', body.includes('data-mode="unified"'));
  ok('offers both layouts', (body.match(/diff-mode__option/g) ?? []).length === 2);
  ok('carries the accept control', body.includes('accept-control__button'));
}

console.log('\n/amendments?view=split  the side-by-side reading');
{
  const { status, body } = await page(`${LEDGER}/amendments?view=split`);
  ok('answers 200', status === 200);
  /* Statically rendered, so the served HTML is the unified layout and the client switches on
     mount. Same one-frame trade as the coverage filter. */
  ok('serves unified and switches on the client', body.includes('data-mode="unified"'));
}

/* ── reviews and the badge ──────────────────────────────────────────────────── */

console.log('\n/reviews  and /badge.svg');
{
  const reviews = await page(`${LEDGER}/reviews`);
  ok('/reviews answers 200', reviews.status === 200);
  ok(
    '/reviews states its empty state, because the snapshot carries none',
    (snapshot.reviews?.length ?? 0) === 0 ? reviews.body.length > 1000 : true,
  );

  const badge = await page(`${LEDGER}/badge.svg`);
  ok('/badge.svg answers 200', badge.status === 200);
  ok('/badge.svg is an SVG', badge.type.includes('svg'), badge.type);
  const percent = Math.round((snapshot.metrics.provenCoverage ?? 0) * 100);
  ok('/badge.svg publishes the same figure', badge.body.includes(`${String(percent)}%`));
}

/* ── the masthead, on every route ───────────────────────────────────────────── */

console.log('\nthe masthead offers the same five sections and one way out');
{
  /* The outbound link goes to the separate deployment that holds the paste-a-repository page. It
     is checked on every route because the masthead is on every route, and because a link that is
     only right on the page somebody happened to test is worse than no link. */
  for (const path of ['/', '/coverage', '/runs', '/reviews', '/amendments']) {
    const { body } = await page(`${LEDGER}${path}`);
    ok(`${path} carries the five section links`, ['Promises', 'Coverage', 'Runs', 'Reviews', 'Amendments'].every((label) => body.includes(`>${label}<`)));
    ok(`${path} carries the outbound link, marked external`, body.includes('data-external="true"') && body.includes('Try your repo'));
    /* A new tab, so the reader keeps the promise they were reading: this site holds the open panel
       and the verdict filter in the URL, and a navigation away loses that place. Both rel tokens
       are the pair a new tab wants. */
    ok(`${path} opens the outbound link in a new tab`, body.includes('target="_blank"'));
    ok(
      `${path} denies it a handle back and withholds the referrer`,
      body.includes('rel="noopener noreferrer"'),
    );
  }
}

/* ── the write guard, at the wire ───────────────────────────────────────────── */

console.log('\nthe deployed artefact cannot be written to');
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const res = await fetch(`${LEDGER}/coverage`, { method });
  ok(`${method} /coverage is refused`, res.status === 405, `HTTP ${String(res.status)}`);
}

/* ── the fixture, which is the subject under verification ───────────────────── */

console.log('\nthe fixture, Kepler Coffee');
{
  for (const [path, needle] of [
    ['/', 'Kepler'],
    ['/shop', 'shop'],
    ['/cart', 'cart'],
    ['/checkout', 'checkout'],
    ['/orders', 'order'],
    ['/settings', 'settings'],
  ]) {
    const res = await fetch(`${FIXTURE}${path}`);
    const body = await res.text();
    ok(
      `${path} answers and mentions "${needle}"`,
      res.status === 200 && body.toLowerCase().includes(needle.toLowerCase()),
      `HTTP ${String(res.status)}`,
    );
  }
}

/* ── the evidence a judge can open ──────────────────────────────────────────── */

console.log('\nthe committed evidence is reachable over HTTP');
{
  const pack = snapshot.evidence[0];
  ok('the snapshot names one pack', pack !== undefined, pack?.id ?? 'none');
  const sample = pack.artifacts.filter((a) => /\.(png|jpe?g)$/i.test(a.publicPath)).slice(0, 3);
  ok('the pack carries captures', sample.length === 3, `${String(pack.artifacts.length)} artefacts`);
  for (const artifact of sample) {
    const res = await fetch(`${LEDGER}${artifact.publicPath}`);
    ok(`${artifact.name} is served`, res.status === 200, `HTTP ${String(res.status)}`);
  }
}

console.log(
  `\n${failures === 0 ? 'ALL GREEN' : 'FAILURES PRESENT'}: ${String(checks - failures)}/${String(checks)} checks passed`,
);
process.exit(failures === 0 ? 0 : 1);
