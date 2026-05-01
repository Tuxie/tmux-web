#!/usr/bin/env bash
# validate-frontmatter.sh — validate code-analysis cluster metadata before
# render-status.sh rebuilds the cluster index.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <report-dir>" >&2
  exit 2
fi

report_dir="${1%/}"
clusters_dir="${report_dir}/clusters"
report_file="${report_dir}/REPORT.md"
errors=0

err() {
  echo "$*" >&2
  errors=$((errors + 1))
}

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "${s}"
}

field_value() {
  local key="$1"
  local line
  while IFS= read -r line; do
    if [[ "${line}" == "${key}:"* ]]; then
      trim "${line#${key}:}"
      return 0
    fi
  done
  return 1
}

has_field() {
  local key="$1"
  local line
  while IFS= read -r line; do
    [[ "${line}" == "${key}:"* ]] && return 0
  done
  return 1
}

validate_slug_list() {
  local source="$1"
  local key="$2"
  local value="$3"
  local item

  value="$(trim "${value}")"
  [[ -z "${value}" || "${value}" == "none" ]] && return 0

  IFS=',' read -r -a items <<< "${value}"
  for item in "${items[@]}"; do
    item="$(trim "${item}")"
    [[ -z "${item}" ]] && continue
    if [[ ! "${item}" =~ ^[0-9][0-9]-[a-z0-9][a-z0-9-]*$ ]]; then
      err "${source}: ${key} contains invalid cluster slug '${item}'"
    fi
  done
}

validate_record() {
  local source="$1"
  local frontmatter="$2"
  local status autonomy resolved model resolving deferred_reason depends informal

  if ! status="$(printf '%s\n' "${frontmatter}" | field_value "Status")"; then
    err "${source}: missing required Status"
    status=""
  fi
  if ! autonomy="$(printf '%s\n' "${frontmatter}" | field_value "Autonomy")"; then
    err "${source}: missing required Autonomy"
    autonomy=""
  fi

  resolved="$(printf '%s\n' "${frontmatter}" | field_value "Resolved-in" || true)"
  model="$(printf '%s\n' "${frontmatter}" | field_value "model-hint" || true)"
  resolving="$(printf '%s\n' "${frontmatter}" | field_value "Resolving-cluster" || true)"
  deferred_reason="$(printf '%s\n' "${frontmatter}" | field_value "Deferred-reason" || true)"
  depends="$(printf '%s\n' "${frontmatter}" | field_value "Depends-on" || true)"
  informal="$(printf '%s\n' "${frontmatter}" | field_value "informally-unblocks" || true)"

  case "${status}" in
    ""|open|in-progress|closed|partial|deferred|resolved-by-dep) ;;
    *) err "${source}: invalid Status '${status}'" ;;
  esac

  case "${autonomy}" in
    ""|autofix-ready|needs-decision|needs-spec) ;;
    *) err "${source}: invalid Autonomy '${autonomy}'" ;;
  esac

  case "${model}" in
    ""|junior|standard|senior) ;;
    *) err "${source}: invalid model-hint '${model}'" ;;
  esac

  case "${status}" in
    closed|partial)
      [[ -n "${resolved}" ]] || err "${source}: Status ${status} requires Resolved-in"
      ;;
    deferred)
      [[ -n "${deferred_reason}" ]] || err "${source}: Status deferred requires Deferred-reason"
      [[ -n "${resolved}" ]] || err "${source}: Status deferred requires Resolved-in"
      ;;
    resolved-by-dep)
      [[ -n "${resolved}" ]] || err "${source}: Status resolved-by-dep requires Resolved-in"
      [[ -n "${resolving}" ]] || err "${source}: Status resolved-by-dep requires Resolving-cluster"
      ;;
  esac

  validate_slug_list "${source}" "Depends-on" "${depends}"
  validate_slug_list "${source}" "informally-unblocks" "${informal}"
  [[ -z "${resolving}" ]] || validate_slug_list "${source}" "Resolving-cluster" "${resolving}"
}

validate_multi() {
  shopt -s nullglob
  local files=("${clusters_dir}"/*.md)
  shopt -u nullglob

  if [[ ${#files[@]} -eq 0 ]]; then
    err "${clusters_dir}: no cluster files found"
    return
  fi

  declare -A seen_numbers=()
  local f base number count frontmatter
  for f in "${files[@]}"; do
    base="$(basename "${f}")"
    if [[ ! "${base}" =~ ^([0-9][0-9])-[a-z0-9][a-z0-9-]*\.md$ ]]; then
      err "${f}: filename must match NN-kebab-slug.md"
    else
      number="${BASH_REMATCH[1]}"
      if [[ -n "${seen_numbers[${number}]:-}" ]]; then
        err "${f}: duplicate cluster number ${number} (also ${seen_numbers[${number}]})"
      fi
      seen_numbers["${number}"]="${f}"
    fi

    count="$(grep -c '^---$' "${f}" || true)"
    if [[ "${count}" -lt 2 ]]; then
      err "${f}: missing frontmatter delimiters"
      continue
    fi

    if [[ "$(sed -n '1p' "${f}")" != "---" ]]; then
      err "${f}: frontmatter must start on the first line"
      continue
    fi

    frontmatter="$(awk '/^---$/{n++; next} n==1{print} n==2{exit}' "${f}")"
    validate_record "${f}" "${frontmatter}"
  done
}

validate_single() {
  local in_block=0 id="" frontmatter="" line
  declare -A seen_ids=()

  while IFS= read -r line; do
    if [[ "${line}" =~ ^\<\!--[[:space:]]cluster:([0-9][0-9]):start[[:space:]]--\>$ ]]; then
      if [[ "${in_block}" -eq 1 ]]; then
        err "${report_file}: cluster ${id} starts before previous cluster ended"
      fi
      id="${BASH_REMATCH[1]}"
      if [[ -n "${seen_ids[${id}]:-}" ]]; then
        err "${report_file}: duplicate cluster number ${id}"
      fi
      seen_ids["${id}"]=1
      in_block=1
      frontmatter=""
      continue
    fi

    if [[ "${line}" =~ ^\<\!--[[:space:]]cluster:([0-9][0-9]):end[[:space:]]--\>$ ]]; then
      if [[ "${in_block}" -eq 0 ]]; then
        err "${report_file}: cluster end without matching start"
      else
        validate_record "${report_file} cluster ${id}" "${frontmatter}"
      fi
      in_block=0
      id=""
      frontmatter=""
      continue
    fi

    if [[ "${in_block}" -eq 1 ]]; then
      case "${line}" in
        "Status:"*|"Autonomy:"*|"Resolved-in:"*|"Depends-on:"*|"informally-unblocks:"*|"Pre-conditions:"*|"attribution:"*|"Commit-guidance:"*|"model-hint:"*|"Deferred-reason:"*|"Resolving-cluster:"*)
          frontmatter+="${line}"$'\n'
          ;;
      esac
    fi
  done < "${report_file}"

  if [[ "${in_block}" -eq 1 ]]; then
    err "${report_file}: cluster ${id} missing end marker"
  fi
  if [[ ${#seen_ids[@]} -eq 0 ]]; then
    err "${report_file}: no cluster blocks found"
  fi
}

if [[ -d "${clusters_dir}" ]]; then
  validate_multi
elif [[ -f "${report_file}" ]]; then
  validate_single
else
  err "no clusters/ or REPORT.md under ${report_dir}"
fi

if [[ "${errors}" -gt 0 ]]; then
  echo "frontmatter validation failed with ${errors} error(s)" >&2
  exit 1
fi

echo "frontmatter validation passed"
