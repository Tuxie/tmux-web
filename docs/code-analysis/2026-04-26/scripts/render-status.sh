#!/usr/bin/env bash
# render-status.sh — regenerate the cluster index in a report's README.md
# from each cluster file's frontmatter `Status:` / `Autonomy:` / `Resolved-in:` fields.
#
# Usage:
#   ./scripts/render-status.sh .                          # from inside a report dir (canonical)
#   ./scripts/render-status.sh <report-dir>               # from the repo root
#
# Example:
#   cd docs/code-analysis/2026-04-17/ && ./scripts/render-status.sh .
#
# Rewrites the `<!-- cluster-index:start -->` ... `<!-- cluster-index:end -->`
# block inside the report's README.md. If the markers are missing, prints
# the rendered block to stdout and exits 0 so the user can paste it in once.
#
# Works in both multi-file mode (clusters/NN-slug.md per cluster) and
# single-file mode (one REPORT.md with <!-- cluster:NN:start --> blocks).

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <report-dir>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
report_dir="${1%/}"
readme_multi="${report_dir}/README.md"
readme_single="${report_dir}/REPORT.md"
clusters_dir="${report_dir}/clusters"
validator="${script_dir}/validate-frontmatter.sh"

if [[ -d "${clusters_dir}" ]]; then
  mode="multi"
  readme="${readme_multi}"
elif [[ -f "${readme_single}" ]]; then
  mode="single"
  readme="${readme_single}"
else
  echo "no clusters/ or REPORT.md under ${report_dir}" >&2
  exit 1
fi

if [[ -f "${validator}" ]]; then
  if ! bash "${validator}" "${report_dir}" >/dev/null; then
    echo "frontmatter validation failed; cluster index was not rewritten" >&2
    exit 1
  fi
fi

render_block_multi() {
  shopt -s nullglob
  local files=("${clusters_dir}"/*.md)
  shopt -u nullglob

  if [[ ${#files[@]} -eq 0 ]]; then
    echo "- _No clusters rendered._"
    return
  fi

  for f in "${files[@]}"; do
    local base name status autonomy resolved_in goal
    base="$(basename "$f" .md)"
    # Extract frontmatter fields (between leading '---' lines).
    status="$(awk '/^---$/{n++; next} n==1 && /^Status:/ {sub(/^Status:[[:space:]]*/,""); print; exit}' "$f")"
    autonomy="$(awk '/^---$/{n++; next} n==1 && /^Autonomy:/ {sub(/^Autonomy:[[:space:]]*/,""); print; exit}' "$f")"
    resolved_in="$(awk '/^---$/{n++; next} n==1 && /^Resolved-in:/ {sub(/^Resolved-in:[[:space:]]*/,""); print; exit}' "$f")"
    # Heading line (first "# Cluster ..." line) for display name.
    name="$(awk '/^# Cluster /{print; exit}' "$f" | sed 's/^# //')"
    # Goal line from TL;DR (first "- **Goal:** ..." match).
    goal="$(awk '/^- \*\*Goal:\*\*/{sub(/^- \*\*Goal:\*\*[[:space:]]*/,""); print; exit}' "$f")"

    status="${status:-open}"
    autonomy="${autonomy:-}"
    name="${name:-${base}}"
    goal="${goal:-_no goal line found_}"

    local suffix=""
    case "${status}" in
      closed)
        [[ -n "${resolved_in}" ]] && suffix=" (resolved-in ${resolved_in})"
        ;;
      partial)
        [[ -n "${resolved_in}" ]] && suffix=" (partial: ${resolved_in})"
        ;;
      resolved-by-dep)
        [[ -n "${resolved_in}" ]] && suffix=" (resolved-by-dep ${resolved_in})"
        ;;
    esac

    local autonomy_suffix=""
    [[ -n "${autonomy}" ]] && autonomy_suffix=" · ${autonomy}"

    printf -- "- [%s](./clusters/%s.md) — %s · **%s**%s%s\n" \
      "${name}" "${base}" "${goal}" "${status}" "${autonomy_suffix}" "${suffix}"
  done
}

render_block_single() {
  # Parse REPORT.md for <!-- cluster:NN:start --> ... <!-- cluster:NN:end --> blocks.
  # Inside each block, the HTML comment contains Status: / Autonomy: / Resolved-in: lines.
  awk '
    /<!-- cluster:[0-9]+:start -->/ {
      match($0, /cluster:[0-9]+/); cid = substr($0, RSTART+8, RLENGTH-8);
      inblk=1; status=""; autonomy=""; resolved=""; heading=""; goal="";
      next
    }
    /<!-- cluster:[0-9]+:end -->/ {
      if (inblk) {
        if (status=="") status="open";
        autosuf = (autonomy != "") ? (" · " autonomy) : "";
        suf = "";
        if (status=="closed" && resolved!="") suf = " (resolved-in " resolved ")";
        else if (status=="partial" && resolved!="") suf = " (partial: " resolved ")";
        else if (status=="resolved-by-dep" && resolved!="") suf = " (resolved-by-dep " resolved ")";
        if (heading=="") heading="Cluster " cid;
        if (goal=="") goal="_no goal line found_";
        anchor = tolower(heading); gsub(/[^a-z0-9]+/, "-", anchor); sub(/^-/, "", anchor); sub(/-$/, "", anchor);
        printf "- [%s](#%s) — %s · **%s**%s%s\n", heading, anchor, goal, status, autosuf, suf;
      }
      inblk=0; next
    }
    inblk && /^Status:/         { sub(/^Status:[[:space:]]*/, ""); status=$0; next }
    inblk && /^Autonomy:/       { sub(/^Autonomy:[[:space:]]*/, ""); autonomy=$0; next }
    inblk && /^Resolved-in:/    { sub(/^Resolved-in:[[:space:]]*/, ""); resolved=$0; next }
    inblk && /^### Cluster /    { h=$0; sub(/^### /, "", h); heading=h; next }
    inblk && /^- \*\*Goal:\*\*/ { sub(/^- \*\*Goal:\*\*[[:space:]]*/, ""); goal=$0; next }
  ' "${readme_single}"
}

render_block() {
  if [[ "${mode}" == "multi" ]]; then
    render_block_multi
  else
    render_block_single
  fi
}

block_start="<!-- cluster-index:start -->"
block_end="<!-- cluster-index:end -->"

rendered="$(render_block)"

if [[ ! -f "${readme}" ]]; then
  echo "${readme} not found — printing rendered block instead:" >&2
  echo "${rendered}"
  exit 0
fi

if ! grep -q "${block_start}" "${readme}" || ! grep -q "${block_end}" "${readme}"; then
  echo "markers missing in ${readme} — paste this block under your cluster list:" >&2
  echo "${block_start}"
  echo "${rendered}"
  echo "${block_end}"
  exit 0
fi

tmp="$(mktemp)"
awk -v start="${block_start}" -v end="${block_end}" -v repl="${rendered}" '
  $0 == start { print; print repl; printing=0; skipping=1; next }
  $0 == end   { skipping=0; print; next }
  !skipping   { print }
' "${readme}" > "${tmp}"

mv "${tmp}" "${readme}"
echo "rewrote cluster index in ${readme}"
