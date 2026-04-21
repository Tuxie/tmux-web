# Suggested CLAUDE.md additions (META-1)

Drafts per `synthesis.md` §9. Each rule would have prevented ≥3 recurrences of a finding shape seen in this run.

- **HTTP handlers always gate on `req.method` at the top of the function body. A missing method check is a bug even when the handler is behind auth.** — prevents: `src/server/http.ts:231,237,243,290,310,554` (six read-only endpoints accept any HTTP method; `/api/sessions` in particular invokes `execFileAsync` regardless of verb, see cluster 03). Rationale: method dispatch is part of an endpoint's contract; not gating on it is how POST-mutation creeps in later, and is the kind of drift that happens silently when endpoints are added one by one.

- **Boot-time fetches in the client must surface a user-visible signal (toast, inline status, or retry prompt) when they fail — never silently fall back to an empty default.** — prevents: `src/client/session-settings.ts:100-110`, `src/client/colours.ts:68-70`, `src/client/theme.ts:42-46` (three boot fetches that `try/catch {}` into an empty array/default, so a server 500 at boot renders a blank settings menu with no diagnostic for the user). Rationale: silent empty-state hides real outages; a one-line toast in the catch block makes the failure investigable.
