# Out of scope / filtered out

This file records what the analysis intentionally did **not** produce, so the user can see the shape of what was excluded rather than mistaking silence for clean.

## Analysts skipped

- **Database Analyst**: Scout flag `database: absent`. The project has no SQL, no migrations, no ORM imports; persistence is JSON file (`src/server/sessions-store.ts`) with `.part` → rename atomic writes. All `DB-*` and `MIG-*` checklist items are N/A.

## Findings filtered during right-sizing (synthesis §3)

- Tier-mismatch, dropped: **0**
- Tier-mismatch, fix rewritten to fit tier: **0**
- Below profile threshold (project=T2): **0**
- Stylistic restatement: **0**
- Rule-restatement (already in project instructions / docs): **0**

The synthesis filter was a no-op this run because each analyst already calibrated to T2 in their owned-checklist filter and dropped findings at source. Per-analyst `Dropped at source` tallies were:

- Backend: 4 dropped (2 borderline, 1 documented-decision, 1 duplicate)
- Frontend: 4 dropped (2 borderline, 1 documented-decision, 1 duplicate)
- Test: 4 dropped (2 borderline, 1 documented-decision, 1 duplicate)
- Security: 4 dropped (2 borderline, 1 documented-decision, 1 duplicate)
- Tooling: 4 dropped (2 borderline, 1 documented-decision, 1 duplicate)
- Docs: 4 dropped (2 borderline, 1 documented-decision, 1 duplicate)
- Coverage: 3 dropped (2 borderline, 1 documented-decision)

Total dropped at source across all analysts: 27. None were over-aggressive enough to trigger §1b's "high source-drop ratio" flag (all analysts dropped fewer findings than they reported).

## Deferred this run

No findings carry a `[~] deferred` tag this run.

The closest deferral candidates are the cluster-14-frontend-low-architectural items, which Frontend explicitly listed as "no production impact, listed for completeness" — they fit the `[~] deferred` shape but the analyst did not formally tag them, so synthesis kept them as filed Low findings clustered into 14. Future runs may convert these to deferred if the maintainer creates `docs/ideas/<slug>.md` tracking pointers.

## Structural exclusions (never examined statically)

- Runtime profiling / load testing
- Production telemetry and actual error rates
- External service reliability
- Anything requiring credential access or network calls (excluding the gated read-only `bun outdated` invocation by Tooling and the gated `bun run coverage:check` invocation by Coverage in Step 3.5)

## Tier-rule skipped checklist items

The following items were emitted as `[-] N/A — below profile threshold (project=T2)` because their `Min tier` is T3 and the repo shows no counter-evidence of intent:

- `PERF-5` (backend): Cancellation propagation through long-running work.
- `ERR-3` (backend): Circuit breaker / load shedding.
- `CONC-4` (backend): Cancellation propagation.
- `OBS-1` (backend): SLO metrics.
- `OBS-2` (backend): Distributed tracing.
- `API-1` (backend): Versioned API contract / deprecation paths.
- `API-2` (backend): OpenAPI schema.
- `CI-4` (security): Self-hosted runner protections (no self-hosted runner in scope).

The following items were emitted as `[-] N/A` for applicability reasons rather than tier:

- `I18N-1`, `I18N-2`, `I18N-3` (frontend): no i18n intent.
- `SEO-1`, `SEO-2`, `SEO-3` (frontend): auth-gated UI, no crawlable surface.
- `CONT-1`, `CONT-2`, `CONT-3`, `CONT-4`: container absent.
- `IAC-1`, `IAC-2`, `IAC-3`: iac absent.
- All `DB-*`, `MIG-*`, `MONO-*`: database / monorepo absent.
- `DEP-3` (frontend): no peer-dep declaration in client scope.
- `DEP-7` (frontend): no separate frontend lockfile.
- `FE-13` (frontend): no third-party CSS.
