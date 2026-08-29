/**
 * A sweep over `apps/try` as it actually answers, on a server somebody has already started.
 *
 * The `apps/try` unit tests take a map of documents and check the gate. This checks the thing a
 * reader touches: the page's own prose, the handler's happy path against a real repository, and
 * every refusal it is supposed to make. It asserts *content* rather than status codes, because a
 * 200 carrying the wrong sentence is the failure that matters here.
 *
 * The happy-path assertion is the interesting one. It reads this repository at whatever commit
 * GitHub is serving and requires the graph to be the one the CLI draws locally: thirteen claims,
 * five in the root README and eight in the fixture's. That is the whole claim of the page. If the
 * two ever disagree, the page is an imitation of KEPT rather than KEPT with its filesystem
 * swapped, and this fails rather than letting it look fine.
 *
 *   node tools/dev-try.sh &            # or npm run dev:try
 *   node tools/verify-try.mjs
 *
 * Needs a network, because reading a public repository is what it is verifying. Invokes Kane zero
 * times and spends no credits.
 */

const BASE = process.env.TRY_BASE ?? 'http://localhost:3300';

let passed = 0;
const failures = [];

function check(what, condition, detail = '') {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(detail === '' ? what : `${what}\n    ${detail}`);
}

async function post(repo) {
  const res = await fetch(`${BASE}/api/graph`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repo }),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  /* ── the page itself ───────────────────────────────────────────────────────── */

  const home = await fetch(BASE);
  const html = await home.text();
  check('the page answers 200', home.status === 200, `got ${home.status}`);

  /* The three places the page says nothing has been verified. All three, because a reader who
     lands on a list of their own claims will assume the list means something otherwise. */
  check(
    'the standfirst says nothing below has been verified',
    html.includes('nothing below has been verified'),
  );
  check('it names the CLI as the half that verifies', html.includes('to verify any of this, run it yourself'));
  /* `NO_VERDICT_NOTE` is deliberately not asserted here. It sits beside the figures, so it is only
     rendered once a read has happened and is not in the first response. This sweep reads HTML
     rather than running the page, so it checks the server-rendered prose here and the result's own
     copy is covered by `apps/try/test`. */
  check('it states zero Kane invocations', html.includes('invokes Kane zero times'));

  /* No verdict vocabulary and no verdict colour, because there is no verdict here. */
  for (const word of ['--verdict-', '--wash-', 'proven', 'stale']) {
    check(`the page does not use the word or token ${word}`, !html.includes(word));
  }

  check('it carries a real form', html.includes('<form'));
  check('the field is labelled', html.includes('for="kept-try-repo"'));

  /* ── the handler, against this repository ─────────────────────────────────── */

  const self = await post('EmadQureshiKhi/Kept');
  check('reading this repository answers 200', self.status === 200, `got ${self.status}`);
  check('and answers ok', self.body.ok === true, JSON.stringify(self.body).slice(0, 200));

  const counts = self.body.counts ?? {};
  check(
    'it finds the thirteen claims the CLI finds',
    counts.promises === 13,
    `found ${String(counts.promises)}; the local snapshot has 13`,
  );
  check('it refuses none of them', counts.rejected === 0, `refused ${String(counts.rejected)}`);
  check('it reports a sha', typeof self.body.repo?.sha === 'string' && self.body.repo.sha.length === 40);

  const groups = self.body.groups ?? [];
  check(
    'the claims sit in the two documents that state them',
    JSON.stringify(groups.map((group) => group.file)) ===
      JSON.stringify(['README.md', 'apps/fixture/README.md']),
    JSON.stringify(groups.map((group) => group.file)),
  );
  check(
    'five in the root README and eight in the fixture',
    JSON.stringify(groups.map((group) => group.promises.length)) === JSON.stringify([5, 8]),
    JSON.stringify(groups.map((group) => group.promises.length)),
  );

  /* The red one, by citation and by designed test. This is the claim the demo is about, and it
     resolves the same way here as it does on a working copy. */
  const fixture = groups.find((group) => group.file === 'apps/fixture/README.md');
  const discount = (fixture?.promises ?? []).find((promise) => promise.line === 20);
  check('the discount claim is cited to apps/fixture/README.md:20', discount !== undefined);
  check(
    'and bound to tests/cart_discount_test.md T-7',
    discount?.testPath === 'tests/cart_discount_test.md' && discount?.testId === 'T-7',
    `${String(discount?.testPath)} ${String(discount?.testId)}`,
  );

  /* No verdict on the wire either, not even a null one. */
  const keys = Object.keys(discount ?? {}).sort().join(',');
  check(
    'no promise carries a verdict field',
    keys === 'claim,file,id,line,testId,testPath,text',
    keys,
  );

  /* ── every refusal ────────────────────────────────────────────────────────── */

  const refusals = [
    ['', 'an empty paste'],
    ['   ', 'whitespace'],
    ['https://gitlab.com/owner/name', 'a host that is not github.com'],
    ['https://raw.githubusercontent.com/a/b', 'a GitHub host that is not github.com'],
    ['http://localhost:3300/x', 'a loopback address'],
    ['owner/../etc', 'a bare path trying to climb out'],
    ['ow%2fner/name', 'an encoded separator'],
    ['not a repository at all', 'prose'],
    ['owner', 'an owner with no name'],
  ];
  for (const [input, what] of refusals) {
    const res = await post(input);
    check(`${what} is refused with 400`, res.status === 400, `got ${res.status} for ${JSON.stringify(input)}`);
    check(
      `${what} is refused with a sentence`,
      typeof res.body.message === 'string' && res.body.message.length > 20,
      JSON.stringify(res.body),
    );
  }

  /**
   * A full URL carrying `..` is not refused, and that is the right answer rather than a gap.
   *
   * `new URL` resolves the segments before the parser is handed a pathname, so
   * `https://github.com/owner/../../etc/passwd` arrives as `/etc/passwd` and reads as the
   * repository `etc/passwd`. The host was still checked, the name still matched the character
   * rule, and the only address that gets fetched is a github.com one, so nothing escaped: it is a
   * repository that does not exist, and it answers as one. The bare form with no scheme is refused
   * outright above, which is the case the normaliser never sees.
   */
  const climbed = await post('https://github.com/owner/../../etc/passwd');
  check(
    'a URL with climbing segments resolves inside github.com and 404s',
    climbed.status === 404,
    `got ${climbed.status}`,
  );

  const missing = await post('EmadQureshiKhi/this-repository-does-not-exist-9f2a');
  check('a repository that does not exist answers 404', missing.status === 404, `got ${missing.status}`);
  check('and says so in words', typeof missing.body.message === 'string');

  /* A GET explains the endpoint rather than 405-ing at a curious reader. */
  const get = await fetch(`${BASE}/api/graph`);
  const explained = await get.json();
  check('a GET on the endpoint explains it', get.status === 200 && explained.ok === false);
  check('and names the CLI as the verifying half', String(explained.message).includes('CLI'));

  /* ── report ───────────────────────────────────────────────────────────────── */

  console.log(`try sweep: ${String(passed)}/${String(passed + failures.length)} against ${BASE}`);
  if (failures.length > 0) {
    console.log('');
    for (const failure of failures) console.log(`  FAIL  ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((cause) => {
  console.error(`try sweep could not run: ${String(cause)}`);
  console.error(`is a server up at ${BASE}? start one with npm run dev:try`);
  process.exitCode = 1;
});
