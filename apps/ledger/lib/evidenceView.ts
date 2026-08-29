/**
 * Which sealed artefacts can be looked at without leaving the page. Design §10.2, R8.3.
 *
 * The evidence pack in the committed snapshot holds fifty-nine artefacts: fifty-six per-step
 * screenshots, one annotated capture, and two failure documents. The screenshots are the
 * product's "here is the proof" moment, and until now looking at one cost a tab switch: the
 * reader left the graph they were reading, looked at a JPEG on its own, and came back to find
 * their place again. In the middle of a demonstration that is the worst possible time to lose
 * the page.
 *
 * So an artefact the browser can draw opens in a lightbox over the panel, and an artefact it
 * cannot still opens in a tab. This module decides which is which, and nothing else does.
 *
 * ## The extension decides, not the kind
 *
 * `kind` is Kane's description of what an artefact *is for*, one of `screenshot`, `annotated`,
 * `failure-yaml`, `har`, `console`, `log` or `other`, and it is a claim rather than a format.
 * A pack could carry a `screenshot` written as a `.yaml`, or an `other` that is a PNG, and in
 * both cases trusting the label would put the wrong thing in an `<img>`: a broken image icon
 * for the first, and a needless tab switch for the second. The extension is what the browser
 * will actually try to decode, so the extension is what is read.
 *
 * `.svg` is deliberately absent from the list. An SVG is a document rather than a bitmap, and
 * although one loaded through `<img src>` cannot run script, the safe default for a file
 * format that *can* carry script is the tab the browser already sandboxes it in. No artefact
 * in the committed pack is an SVG, so nothing is lost by being careful here.
 *
 * Pure and DOM-free, so it is checked under the repository's no-DOM `lib` program and can be
 * proven over arbitrary snapshots.
 */

import type { SnapshotEvidence } from 'kept-core';

/** One artefact, as much of it as this module needs. */
export interface ViewableCandidate {
  readonly publicPath: string;
}

/**
 * Extensions a browser draws as a bitmap, lower case and without the dot.
 *
 * A closed list rather than a "not one of the text formats" test: an unknown extension going
 * to a tab is a mild inconvenience, and an unknown extension going into an `<img>` is a
 * broken image where the reader was promised proof.
 */
export const VIEWABLE_EXTENSIONS: readonly string[] = Object.freeze([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
]);

/** The lower-cased extension of a path, or `null` when it has none. */
export function extensionOf(path: string): string | null {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** `true` when this artefact can be drawn in the lightbox rather than opened in a tab. */
export function isViewableArtifact(artifact: ViewableCandidate): boolean {
  const extension = extensionOf(artifact.publicPath);
  return extension !== null && VIEWABLE_EXTENSIONS.includes(extension);
}

/**
 * The pack's viewable artefacts, in the order the pack lists them.
 *
 * Order matters because the lightbox steps through this array with the arrow keys, and a
 * reader stepping through fifty-six per-step captures is reading the run in the order it
 * happened. Re-sorting them would turn a sequence into a gallery.
 */
export function viewableArtifacts<T extends ViewableCandidate>(
  artifacts: readonly T[],
): readonly T[] {
  return artifacts.filter((artifact) => isViewableArtifact(artifact));
}

/** How many of a pack's artefacts can be viewed inline. `null` packs count as none. */
export function viewableCount(pack: SnapshotEvidence | null): number {
  return pack === null ? 0 : viewableArtifacts(pack.artifacts).length;
}
