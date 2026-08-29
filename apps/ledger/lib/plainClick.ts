/**
 * Whether a click on a link is the plain one a component may take over.
 *
 * Two places in the Ledger hand a reader a real `<a href>` and then handle the click
 * themselves: the verdict chips on `/coverage`, which filter in place rather than navigate,
 * and the evidence artefacts in the promise panel, which open an image in a lightbox rather
 * than in a tab. Both need the same rule, and the rule is worth stating once.
 *
 * **A modified click is a request for the browser's own behaviour.** Cmd or ctrl opens a tab,
 * shift opens a window, alt downloads, and a middle click is a new tab on every platform.
 * Those are contracts the reader has with their browser rather than with this page, and
 * calling `preventDefault` on one breaks a promise nobody here made. So only an unmodified
 * primary click is intercepted, and everything else falls through to the `href` untouched.
 *
 * That is also what keeps the `href` honest rather than decorative. A component that handles
 * every click may as well render a `<button>`, and then "copy link address", "open in new
 * tab" and a reader with JavaScript disabled all lose. Handling the narrow case and leaving
 * the rest is what makes the element genuinely a link.
 *
 * A structural parameter rather than React's `MouseEvent`, so this module stays free of React
 * and is checked under the repository's no-DOM `lib` program. A DOM event and a synthetic one
 * both satisfy it.
 */
export interface ClickModifiers {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly defaultPrevented: boolean;
}

/** `true` for an unmodified primary click that nothing else has already handled. */
export function isPlainClick(event: ClickModifiers): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  );
}
