/**
 * How a diff is laid out, and where that choice lives. Design §10.9, §10.1, R7.5.
 *
 * A one-line prose amendment is the case a unified diff serves worst. Read unified, the sentence
 * the README states and the sentence proposed instead are on two different lines with a marker
 * in front of each, and a reader comparing them is scanning vertically across a line break to
 * find which words moved. Read side by side they are on one line, and the change is where the
 * columns stop matching. The amendment on file is exactly that shape, so the two layouts are
 * genuinely different readings rather than a preference, and the reader gets to pick.
 *
 * ## The choice is in the URL, for the same three reasons the verdict filter's is
 *
 * `?view=split` is shareable, which is what makes it worth having in a submission: the link
 * that opens the side-by-side reading of the amendment is a link, not an instruction to open a
 * page and then click something. It keeps `/amendments` statically rendered, because a query
 * string addresses no new route and the choice is read on the client rather than off
 * `searchParams`. And it makes every diff on the page agree, without a page-level client
 * component having to own state and hand it down through server-rendered cards.
 *
 * That last one is the reason this is a URL rather than a `useState` in one place. The cards are
 * server components: lifting a mode to the page would make the page a client component, and the
 * page reads the snapshot, whose contract package reaches modules that open files. `RunLog`
 * documents what that costs. Reading one query parameter in each pane keeps the boundary where
 * it already is.
 *
 * Unified is the default and clears the parameter rather than spelling `?view=unified`, so the
 * canonical URL for the page is the one a reader gets by not choosing.
 *
 * Pure and DOM-free, so it is checked under the repository's no-DOM `lib` program and the
 * parsing is provable without a render.
 */

/** The two layouts, and no third. */
export type DiffMode = 'unified' | 'split';

/** The layout a reader gets without asking. */
export const DEFAULT_DIFF_MODE: DiffMode = 'unified';

/** The query key. */
export const DIFF_MODE_PARAM = 'view';

/** The modes, in the order the toggle offers them: the default first. */
export const DIFF_MODES: readonly DiffMode[] = Object.freeze(['unified', 'split']);

/**
 * The event a pane listens for when another pane changes the mode.
 *
 * `history.pushState` fires no event, and `popstate` only covers the browser's own back and
 * forward. So a pane that changed the URL tells the others, and every pane re-reads the URL
 * rather than being handed a value: the address bar stays the single source of truth and two
 * diffs on one page cannot end up disagreeing about how they are drawn.
 *
 * Namespaced, because the origin is shared with whatever else is served from it.
 */
export const DIFF_MODE_EVENT = 'kept:diff-mode';

/**
 * The mode a raw query value selects.
 *
 * Anything unrecognised is the default rather than an error. `?view=banana` is a URL somebody
 * typed, and the honest response is the page as it normally reads.
 */
export function diffModeOf(raw: string | null | undefined): DiffMode {
  return raw === 'split' ? 'split' : DEFAULT_DIFF_MODE;
}

/** The mode encoded in a `location.search`, whatever shape it arrives in. */
export function diffModeFromSearch(search: string): DiffMode {
  const query = search.startsWith('?') ? search.slice(1) : search;
  return diffModeOf(new URLSearchParams(query).get(DIFF_MODE_PARAM));
}

/**
 * The URL that selects `mode`, preserving everything else in `search`.
 *
 * Preserving the rest is not politeness. `/amendments#am_57fdcb99` puts a reader on one card,
 * and a toggle that rebuilt the query from scratch would drop any other parameter the page
 * grows later, so the link a reader copied would stop meaning what it meant.
 */
export function diffModeHref(path: string, search: string, mode: DiffMode): string {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (mode === DEFAULT_DIFF_MODE) query.delete(DIFF_MODE_PARAM);
  else query.set(DIFF_MODE_PARAM, mode);
  const rest = query.toString();
  return rest.length === 0 ? path : `${path}?${rest}`;
}
