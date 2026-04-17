# TLS Default and --no-tls Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TLS the default setting for the tmux-web server and add a `--no-tls` flag to allow disabling it.

**Architecture:** Update `parseConfig` to default `tls` to `true` and introduce a `no-tls` argument. Map the final `tls` configuration to `args.tls && !args['no-tls']`. Update the CLI help message and unit tests accordingly.

**Tech Stack:** TypeScript, Bun (test runner), `util.parseArgs`

---

### Task 1: Update `parseConfig` in `src/server/index.ts`

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Update `parseArgs` options**
  Change `tls` default to `true` and add `'no-tls'` boolean option with default `false`.

```typescript
      tls:          { type: 'boolean', default: true },
      'no-tls':     { type: 'boolean', default: false },
```

- [ ] **Step 2: Map `config.tls`**
  Update the mapping of `config.tls` to use both `args.tls` and `args['no-tls']`.

```typescript
    tls: !!args.tls && !args['no-tls'],
```

### Task 2: Update help message in `src/server/index.ts`

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Update descriptions in `startServer`**
  Update `--tls` description and add `--no-tls`.

```typescript
      --tls                    Enable HTTPS with self-signed certificate (default)
      --no-tls                 Disable HTTPS
```

### Task 3: Update and add unit tests in `tests/unit/server/config.test.ts`

**Files:**
- Modify: `tests/unit/server/config.test.ts`

- [ ] **Step 1: Update existing test**
  Update "parseConfig returns default values" to expect `tls: true`.

```typescript
test("parseConfig returns default values", () => {
  const { config } = parseConfig([]);
  expect(config?.tls).toBe(true);
});
```

- [ ] **Step 2: Add test case for `--no-tls`**
  Verify that `--no-tls` results in `tls: false`.

```typescript
test("parseConfig with --no-tls returns tls: false", () => {
  const { config } = parseConfig(["--no-tls"]);
  expect(config?.tls).toBe(false);
});
```

- [ ] **Step 3: Add test case for explicit `--tls`**
  Verify that explicit `--tls` results in `tls: true`.

```typescript
test("parseConfig with explicit --tls returns tls: true", () => {
  const { config } = parseConfig(["--tls"]);
  expect(config?.tls).toBe(true);
});
```

### Task 4: Verification

- [ ] **Step 1: Run unit tests**
  Run `bun test tests/unit/server/config.test.ts` and ensure all tests pass.

### Task 5: Commit

- [ ] **Step 1: Commit changes**
  Commit the changes with the required message.

```bash
git add src/server/index.ts tests/unit/server/config.test.ts
git commit -m "feat(server): make TLS default and add --no-tls"
```
