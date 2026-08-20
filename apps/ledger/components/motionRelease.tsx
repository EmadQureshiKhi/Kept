/**
 * Handing an element back to the cascade — design §10.6.4, §18.1 (M4's "what
 * replaces it"), R10.4.
 *
 * The gate (`lib/motion.tsx`) guarantees that the DOM after an orchestration
 * finishes is the DOM the reduced-motion branch writes: `play()` applies
 * `spec.to` in both paths. That makes the two states *equal to each other*. This
 * module makes them equal to a **third** thing, which is the one the tasks
 * actually name — the render where the orchestration never ran at all: task 17.5
 * asks for a resting DOM that is *byte-identical* to the no-motion render, and
 * §18.1 says dropping M4 leaves "nodes at opacity 1 on first paint — identical to
 * the reduced-motion render".
 *
 * Those two sentences only hold if nothing inline survives. An animation ends by
 * writing its last frame into the `style` attribute; `utils.set` writes there too.
 * So `transform: translateY(0px)` and `color: rgb(217, 166, 74)` outlive every
 * orchestration — values that are visually identical to what `tokens.css` and
 * `verdict-tag.css` already resolve, and textually a difference in the DOM. A
 * comparison that reads computed styles sees `translateY(0px)` against `none` and
 * calls it a difference, and it is right to: an inline declaration that shadows a
 * stylesheet is a real change, even when the two agree today.
 *
 * Hence this: after an orchestration has landed on its declared end state, the
 * properties it wrote are removed, and the cascade — which resolves to those same
 * values from `data-verdict` and the token file — states them again. Three
 * consequences, all of them wanted:
 *
 *   1. The resting DOM of a page that animated, a page under reduced motion, and a
 *      page whose flourish was cut are the same bytes. That is §18.1's claim about
 *      droppability, made checkable.
 *   2. Colour stays CSS's job. A verdict hue pinned inline would win over
 *      `verdict-tag.css` forever after, so the *next* verdict change would have to
 *      be animated to be seen at all — motion carrying information, which §10.6.4
 *      forbids outright.
 *   3. The `style` attribute is removed once empty, rather than left as `style=""`.
 *      "Byte-identical" is the word the task uses.
 *
 * Timing: the release runs after `play()` resolves, which under reduced motion is a
 * microtask after a synchronous `utils.set` — before the frame is painted, so no
 * reader ever sees the inline value it removes.
 */

/** Removes `properties` from each target's inline style, and the attribute if empty. */
export function releaseInlineMotion(
  targets: readonly HTMLElement[],
  properties: readonly string[],
): void {
  for (const target of targets) {
    for (const property of properties) target.style.removeProperty(property);
    if (target.style.length === 0) target.removeAttribute('style');
  }
}
