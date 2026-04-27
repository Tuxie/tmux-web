#!/usr/bin/env bash
# Patch a TTF with Nerd Font glyphs and tighten its native line-height.
#
# Usage: scripts/patch-nerd-font.sh <font.ttf> <line-height-percent>
#
# The percent is applied to the OS/2 typo + win and hhea ascent / descent /
# linegap values: 100 leaves metrics unchanged, 90 produces a font that
# natively renders with a line box ~90% of the original (so CSS can use
# line-height: 1 instead of line-height: 0.9).
#
# Outputs (in tmp/):
#   <basename>-Nerd-LH<percent>.ttf
#   <basename>-Nerd-LH<percent>.woff2

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/patch-nerd-font.sh <font.ttf> <line-height-percent>

  font.ttf              source font (TTF)
  line-height-percent   integer or float, e.g. 90 to scale vertical
                        metrics to 90% of original

Example:
  scripts/patch-nerd-font.sh tmp/IosevkaTerm-Regular.ttf 90

Produces tmp/<basename>-Nerd-LH<percent>.{ttf,woff2}.

Requirements:
  fontforge        (brew install fontforge)
  woff2_compress   (brew install woff2)
  tmp/FontPatcher  (extract Nerd Fonts FontPatcher.zip into ./tmp/)
EOF
  exit 1
}

[[ $# -eq 2 ]] || usage
font=$1
percent=$2

require() {
  local tool=$1 hint=$2
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'patch-nerd-font: %s not found in $PATH. %s\n' "$tool" "$hint" >&2
    exit 2
  fi
}

require fontforge      'Install with: brew install fontforge'
require woff2_compress 'Install with: brew install woff2'

repo_root=$(cd -- "$(dirname -- "$0")/.." && pwd)
patcher=$repo_root/tmp/FontPatcher/font-patcher
if [[ ! -f $patcher ]]; then
  printf 'patch-nerd-font: FontPatcher not found at %s\n' "$patcher" >&2
  printf '  Download FontPatcher.zip from https://github.com/ryanoasis/nerd-fonts/releases/latest\n' >&2
  printf '  and extract it into ./tmp/FontPatcher/\n' >&2
  exit 2
fi

[[ -f $font ]] || { printf 'patch-nerd-font: input font %s not found\n' "$font" >&2; exit 2; }

if ! [[ $percent =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  printf 'patch-nerd-font: line-height-percent "%s" must be a positive number\n' "$percent" >&2
  exit 2
fi

stem=$(basename "$font")
stem=${stem%.*}
work_dir=$repo_root/tmp/${stem}-Nerd-LH${percent}.work
final_ttf=$repo_root/tmp/${stem}-Nerd-LH${percent}.ttf
final_woff2=$repo_root/tmp/${stem}-Nerd-LH${percent}.woff2

rm -rf "$work_dir"
mkdir -p "$work_dir"
ffscript=
cleanup() {
  rm -rf "$work_dir"
  [[ -n $ffscript ]] && rm -f "$ffscript"
  return 0
}
trap cleanup EXIT

echo ">> patching $font with Nerd Font glyphs (--complete)"
fontforge --quiet --script "$patcher" "$font" --complete --no-progressbars -out "$work_dir" >/dev/null

patched_ttf=$(find "$work_dir" -maxdepth 1 -type f -name '*.ttf' | head -n1)
if [[ -z $patched_ttf ]]; then
  printf 'patch-nerd-font: FontPatcher produced no .ttf in %s\n' "$work_dir" >&2
  exit 1
fi

echo ">> scaling vertical metrics to ${percent}% of original"
ffscript=$(mktemp)
cat >"$ffscript" <<'PY'
import fontforge, sys
inp, outp, percent = sys.argv[1], sys.argv[2], float(sys.argv[3])
factor = percent / 100.0
f = fontforge.open(inp)

# Use our manual values verbatim, not added on top of FontForge's auto-derived defaults.
# (FontForge has no `_add` flag for linegap — it is always stored directly.)
for flag in ('os2_typoascent_add', 'os2_typodescent_add',
             'os2_winascent_add',  'os2_windescent_add',
             'hhea_ascent_add',    'hhea_descent_add'):
    setattr(f, flag, False)

for attr in ('os2_typoascent', 'os2_typodescent', 'os2_typolinegap',
             'os2_winascent',  'os2_windescent',
             'hhea_ascent',    'hhea_descent',    'hhea_linegap'):
    setattr(f, attr, int(round(getattr(f, attr) * factor)))

f.generate(outp)
PY
fontforge --quiet -lang=py -script "$ffscript" "$patched_ttf" "$final_ttf" "$percent" >/dev/null

[[ -f $final_ttf ]] || {
  printf 'patch-nerd-font: fontforge did not produce %s\n' "$final_ttf" >&2
  exit 1
}

echo ">> compressing to woff2"
rm -f "$final_woff2"
woff2_compress "$final_ttf" >/dev/null

[[ -f $final_woff2 ]] || {
  printf 'patch-nerd-font: woff2_compress did not produce %s\n' "$final_woff2" >&2
  exit 1
}

echo "wrote: $final_ttf"
echo "wrote: $final_woff2"
