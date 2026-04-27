#!/usr/bin/env bash
# Build a fallback webfont by remapping a source font onto a different
# em + vertical-metric geometry. Used to make a single bundled font
# (e.g. IosevkaTerm Nerd Font) cover BMP and PUA glyphs that are missing
# from a target font (e.g. the Amiga bitmap fonts) while staying baseline-
# aligned in the browser's font fallback stack.
#
# Usage:
#   scripts/build-fallback-font.sh <source-font> <em> <ascent> <descent> \
#       <glyph-y-shift> <output-family> [<output-filename>]
#
# Example (Amiga geometry, Iosevka glyphs):
#   scripts/build-fallback-font.sh themes/default/'IosevkaTerm Nerd Font.woff2' \
#       1600 1600 0 312 'Iosevka Amiga'
#
# Outputs tmp/<output-filename> (defaults to "<output-family>.woff2") plus
# the intermediate .ttf next to it.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/build-fallback-font.sh <source-font> <em> <ascent> <descent> <glyph-y-shift> <output-family> [<output-filename>]

  source-font        TTF or WOFF2 (anything fontforge can open)
  em                 target units-per-em (positive integer)
  ascent             OS/2 + hhea ascent in target em units
  descent            OS/2 + hhea descent (positive number; stored negative
                     in OS/2 typo & hhea fields, positive in OS/2 win)
  glyph-y-shift      uniform vertical translate (target em units) applied
                     to every glyph — use to align the source's letter
                     midline onto the target font's letter midline
  output-family      new family name written into the OpenType name table
  output-filename    optional override (default "<output-family>.woff2")

Outputs in tmp/:
  <output-filename>      woff2 (the file you ship)
  <basename>.ttf         intermediate ttf, kept for inspection

Requirements:
  fontforge        (brew install fontforge)
  woff2_compress   (brew install woff2)
EOF
  exit 1
}

[[ $# -ge 6 && $# -le 7 ]] || usage

src=$1
em=$2
ascent=$3
descent=$4
shift_y=$5
family=$6
out_name=${7:-"$family.woff2"}

require() {
  local tool=$1 hint=$2
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'build-fallback-font: %s not found in $PATH. %s\n' "$tool" "$hint" >&2
    exit 2
  fi
}
require fontforge      'Install with: brew install fontforge'
require woff2_compress 'Install with: brew install woff2'

[[ -f $src ]] || { printf 'build-fallback-font: source font %s not found\n' "$src" >&2; exit 2; }

for arg in "$em" "$ascent" "$descent"; do
  if ! [[ $arg =~ ^[0-9]+$ ]]; then
    printf 'build-fallback-font: em/ascent/descent must be non-negative integers (got "%s")\n' "$arg" >&2
    exit 2
  fi
done
if ! [[ $shift_y =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then
  printf 'build-fallback-font: glyph-y-shift must be numeric (got "%s")\n' "$shift_y" >&2
  exit 2
fi

repo_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
out_ttf=$repo_root/tmp/${out_name%.woff2}.ttf
out_woff2=$repo_root/tmp/$out_name
mkdir -p "$repo_root/tmp"

ffscript=$(mktemp)
cleanup() { rm -f "$ffscript"; }
trap cleanup EXIT

cat >"$ffscript" <<'PY'
import fontforge, sys
src, dst, em, asc, desc, shift, family = sys.argv[1:8]
em, asc, desc, shift = int(em), int(asc), int(desc), float(shift)

f = fontforge.open(src)

# 1. Rescale em — this scales every glyph uniformly so coordinates after
#    this point are in target em units.
f.em = em

# 2. Vertical shift — translate every glyph by `shift` units along Y so
#    the source font's letter midline lands on the target's letter midline.
if shift != 0:
    matrix = (1, 0, 0, 1, 0, shift)
    for g in f.glyphs():
        g.transform(matrix)

# 3. Rewrite vertical metrics. Use absolute values (no auto-add).
for flag in ('os2_typoascent_add', 'os2_typodescent_add',
             'os2_winascent_add',  'os2_windescent_add',
             'hhea_ascent_add',    'hhea_descent_add'):
    setattr(f, flag, False)

f.os2_typoascent  =  asc
f.os2_typodescent = -desc
f.os2_typolinegap = 0
f.os2_winascent   =  asc
f.os2_windescent  =  desc
f.hhea_ascent     =  asc
f.hhea_descent    = -desc
f.hhea_linegap    = 0
f.ascent          =  asc
f.descent         =  desc

# 4. Rename — family / fullname / postscript name. Browsers match
#    @font-face by family, so this is what the CSS stack will see.
psname = family.replace(' ', '-')
f.familyname = family
f.fullname   = family
f.fontname   = psname

# Drop existing SFNT name records so our new ones aren't shadowed by
# stale entries from the source font.
f.sfnt_names = (
    ('English (US)', 'Family', family),
    ('English (US)', 'SubFamily', 'Regular'),
    ('English (US)', 'Fullname', family),
    ('English (US)', 'PostScriptName', psname),
    ('English (US)', 'UniqueID', family + ' Regular'),
    ('English (US)', 'Preferred Family', family),
    ('English (US)', 'Preferred Styles', 'Regular'),
)

f.generate(dst)
PY

echo ">> rescaling $src to em=$em, asc/desc=$ascent/$descent, shift=${shift_y}"
fontforge --quiet -lang=py -script "$ffscript" "$src" "$out_ttf" "$em" "$ascent" "$descent" "$shift_y" "$family" >/dev/null

[[ -f $out_ttf ]] || { printf 'build-fallback-font: fontforge did not produce %s\n' "$out_ttf" >&2; exit 1; }

echo ">> compressing to woff2"
rm -f "$out_woff2"
woff2_compress "$out_ttf" >/dev/null

[[ -f $out_woff2 ]] || { printf 'build-fallback-font: woff2_compress did not produce %s\n' "$out_woff2" >&2; exit 1; }

echo "wrote: $out_ttf"
echo "wrote: $out_woff2"
