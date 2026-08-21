#!/usr/bin/env bash
#
# The KEPT logo plates, and the diagram mark.
#
# ## The problem this solves
#
# The source is a black mark on transparency, which vanishes against a dark page.
# GitHub serves both a light and a dark README theme, so a single plate is wrong
# half the time. This builds two and the README picks between them with a
# <picture> element.
#
# Neither source file is ever overwritten. They stay the canonical marks.
#
# ## What comes out
#
#   Assets/kept-logo-light.png   the lockup on a light card, for the README hero
#   Assets/kept-logo-dark.png    the same inverted, for the dark theme
#   Assets/kept-mark.png         the K alone, black on transparency, for diagrams
#
# The lockup carries the wordmark and is what a hero wants. The diagram headers
# take the mark alone and set the title as text beside it, so the name is not
# rendered twice in one header.
#
# ## Why the source needs no white-background lift
#
# There is a well-known trick for lifting a mark off a solid white plate: derive
# alpha from luminance rather than fuzz-matching white, because `-transparent
# white` chews holes in antialiased edges.
#
#     magick src.png -colorspace gray -negate alpha.png
#     magick src.png alpha.png -alpha off -compose CopyOpacity -composite mark.png
#
# It is recorded here because it is the right answer to that problem and someone
# will meet it. It is **not used**: both KEPT sources were measured as pure black
# on genuine transparency, antialiased, so there is nothing to lift.

set -euo pipefail

cd "$(dirname "$0")/../.."

LOCKUP="Assets/Kept logo.png"
MARK_SRC="Assets/kept logo only k.png"
OUT="Assets"

for f in "$LOCKUP" "$MARK_SRC"; do
  [[ -f "$f" ]] || { echo "build_logo: missing $f" >&2; exit 1; }
done

command -v magick >/dev/null || { echo "build_logo: ImageMagick 7 (magick) is required" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── the card geometry, shared by both plates ─────────────────────────────────
CARD_W=1180
CARD_H=760
RADIUS=64

# 1. Trim to the mark's own ink *first*, so the padding added afterwards is real
#    padding rather than whatever transparent margin the export happened to leave.
#    +repage resets the virtual canvas offset — skip it and the offset follows the
#    image into every later operation and everything lands off-centre.
magick "$LOCKUP" -trim +repage -resize 800x520 "$TMP/mark_light.png"

# 2. Invert for the dark plate. -channel RGB -negate flips the colour and leaves
#    alpha alone, so a black mark becomes white and the transparency survives.
#    That is the whole trick.
magick "$TMP/mark_light.png" -channel RGB -negate "$TMP/mark_dark.png"

# 3. One rounded mask, reused by both plates.
magick -size ${CARD_W}x${CARD_H} xc:none -fill white \
  -draw "roundrectangle 0,0 $((CARD_W - 1)),$((CARD_H - 1)) $RADIUS,$RADIUS" "$TMP/mask.png"

# ── one plate ────────────────────────────────────────────────────────────────
# plate <name> <top> <bottom> <border> <mark> <shadow>
plate() {
  local name="$1" top="$2" bottom="$3" border="$4" mark="$5" shadow="$6"

  # a vertical gradient
  magick -size ${CARD_W}x${CARD_H} "gradient:${top}-${bottom}" "$TMP/grad_$name.png"

  # punch the rounded shape out of it
  magick "$TMP/grad_$name.png" "$TMP/mask.png" -alpha off \
    -compose CopyOpacity -composite "$TMP/card_$name.png"

  # a hairline border: an edge without a hard outline
  magick "$TMP/card_$name.png" -fill none -stroke "$border" -strokewidth 3 \
    -draw "roundrectangle 1.5,1.5 $((CARD_W - 1)).5,$((CARD_H - 1)).5 $RADIUS,$RADIUS" \
    "$TMP/edged_$name.png"

  # centre the mark
  magick "$TMP/edged_$name.png" "$TMP/mark_$mark.png" -gravity center -composite \
    "$TMP/plate_$name.png"

  # a soft drop shadow, merged onto transparency so the plate floats on whatever
  # background the page has. Shadow syntax is opacity x sigma + x + y.
  magick "$TMP/plate_$name.png" \
    \( +clone -background black -shadow "$shadow" \) \
    +swap -background none -layers merge +repage "$OUT/kept-logo-$name.png"

  # ImageMagick writing inside a mktemp -d inherits that directory's private
  # mode, and a tracked asset at 600 is a surprise nobody wants.
  chmod 644 "$OUT/kept-logo-$name.png"
}

#        name    top       bottom    border    mark   shadow
plate    light  '#ffffff' '#eef0f3' '#d9dce0'  light  '38x26+0+18'
plate    dark   '#1d2126' '#111418' '#333940'  dark   '55x30+0+18'

# The dark plate carries a stronger shadow — 55% at sigma 30 against 38% at 26 —
# because a dark card on a dark page has less inherent separation to begin with.

# ── the diagram mark: the K alone, black, on transparency ────────────────────
magick "$MARK_SRC" -trim +repage -resize x240 -strip PNG32:"$OUT/kept-mark.png"
chmod 644 "$OUT/kept-mark.png"

# macOS tags anything a script writes with a quarantine flag, which triggers a
# pointless prompt the first time somebody opens the file. Strip it, and do not
# fail the build on a platform that has no xattr.
xattr -c "$OUT"/kept-logo-light.png "$OUT"/kept-logo-dark.png "$OUT"/kept-mark.png 2>/dev/null || true

# ── verify, rather than assume ────────────────────────────────────────────────
echo "build_logo: sources"
magick identify -format '  %f  %wx%h  %[channels]\n' "$LOCKUP" "$MARK_SRC"
echo "build_logo: plates"
magick identify -format '  %f  %wx%h  %[channels]\n' \
  "$OUT/kept-logo-light.png" "$OUT/kept-logo-dark.png" "$OUT/kept-mark.png"
