# Suggested agent-instruction additions (META-1)

Drafts per `synthesis.md` §9. Each rule would have prevented ≥3 recurrences of a finding.

The single recurring finding shape this run is **doc-drift** — six findings across `AGENTS.md` and `README.md` where the prose names a specific value (field list, default, metavar, structural directory) that the code has since moved past. AGENTS.md already has prose-update guidance scattered through its sections (`AGENTS.md` "Documentation/release" content), so this is a Case 2 "existing rule violated N times" rather than a Case 1 new rule.

- **Enforce existing AGENTS.md/README "name the file when you touch the field" practice:** add a pre-release checklist line that grep-confirms documented `<select>` field lists, default values, and CLI option metavars match their code-of-record. Prevents: cluster 08 findings (DOC-1, DOC-2, DOC-3 across AGENTS.md:294, AGENTS.md:394, AGENTS.md:398, README.md:70, README.md:80, AGENTS.md:160). Rationale: AGENTS.md and README already document the project's defaults; the violations are an enforcement gap, not a missing rule. Mechanism: extend the existing "Pre-release verification checklist" (rendered into this report's README from the Scout's `Pre-release surface: yes` output) with a one-line check that `grep -nE 'default|currently uses|by default|defaults to' AGENTS.md README.md` produces no entries the maintainer has not re-validated since the last release. The check is mechanical (low false-positive cost), the maintainer-judgment portion is bounded ("re-validate against code"), and the failure mode is "a release goes out with stale docs that contradict shipped code" — which is exactly the shape this run found six times.

_No further recurring shapes (≥3 occurrences) surfaced this run._
