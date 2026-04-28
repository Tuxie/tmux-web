# `act -j e2e` fails before starting the Release E2E job

## Context

While preparing the 1.10.2 point release on 2026-04-27, the normal
release rehearsal command ran:

```bash
act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

That command successfully executed the `Release / E2E (ubuntu)` dependency job
before the build leg:

- Playwright installed Chromium.
- `Run E2E tests` executed 108 tests.
- Result: `108 passed`.

Afterward, the checklist's explicit standalone E2E command was run:

```bash
act -j e2e -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

It failed immediately before job setup:

```text
time="2026-04-27T21:05:41+02:00" level=info msg="Using docker host 'unix:///var/run/docker.sock', and daemon socket 'unix:///var/run/docker.sock'"
Error: listen tcp: lookup <nil>: no such host
```

Retrying produced the same error. Targeting the workflow directly also failed
the same way:

```bash
act -W .github/workflows/release.yml -j e2e -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

```text
Error: listen tcp: lookup <nil>: no such host
```

## Why this matters

`AGENTS.md` tells release agents to run both:

```bash
act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest
act -j e2e -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

The E2E job itself is apparently healthy when invoked as the build dependency,
but the standalone invocation currently fails in this environment before it can
prove anything.

## Suggested fix path

Start by reproducing the direct command in the same checkout:

```bash
act -j e2e -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

Then compare the `act` planning/runtime inputs between:

```bash
act --list
act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest
act -j e2e -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

The likely area to inspect is the local `act` network/listen configuration or
event context for the direct job, not the Playwright suite itself. Evidence:
the direct command never reaches repository checkout, setup, or test steps,
while the same `e2e` job has just passed as part of the `build` dependency run.

## Resolution

On 2026-04-28, the direct command no longer reproduced the `lookup <nil>`
failure in the same checkout:

```bash
act -j e2e -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

It reached job setup, installed the Linux helpers, set up Bun, built the
frontend/assets, installed Playwright browsers, ran the Release E2E job, and
completed successfully:

```text
108 passed
Job succeeded
```

No repository code change was needed. The original failure was an intermittent
or local `act`/Docker environment problem, not a release workflow bug.
