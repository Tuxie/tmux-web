# Design Spec: Make TLS Default for tmux-web

## Overview
This spec outlines the changes required to make TLS (HTTPS) the default for `tmux-web`. Users will need to use a new `--no-tls` flag to explicitly disable TLS and use HTTP.

## Goals
- Default server mode to HTTPS.
- Automatically generate self-signed certificates if no custom cert/key is provided.
- Provide a `--no-tls` flag to fallback to HTTP.
- Update documentation and help messages to reflect this change.

## Proposed Changes

### 1. CLI Argument Parsing (`src/server/index.ts`)
- Update `parseArgs` configuration:
    - Change `tls` flag default to `true`.
    - Add `no-tls` boolean flag.
- Update help message:
    - Mark `--tls` as (default).
    - Add `--no-tls` description: "Disable HTTPS and use HTTP".
- Map `config.tls` logic:
    - `tls: args.tls && !args['no-tls']`

### 2. Server Logic (`src/server/index.ts`)
- Keep existing `generateSelfSignedCert()` logic when `config.tls` is true and no certs are provided.
- No changes needed to `http.ts` or `tls.ts` as they already handle the `tls` config correctly.

### 3. Documentation & Metadata
- Update `README.md` to reflect HTTPS as the default.
- Update `CLAUDE.md` if it contains any relevant commands or instructions.

### 4. Testing
- **Unit Test:** Add a test case to verify:
    - Default state is `tls: true`.
    - `--no-tls` correctly sets `tls: false`.
    - `--tls` (explicit) still results in `tls: true`.
- **E2E Tests:** Audit `tests/e2e/` for any tests that might fail due to the protocol change (http -> https) and update them to use `--no-tls` where appropriate for testing non-TLS scenarios, or update them to support HTTPS.

## Success Criteria
- Running `tmux-web` without flags starts an HTTPS server.
- Running `tmux-web --no-tls` starts an HTTP server.
- Existing E2E and unit tests pass (after necessary updates).
