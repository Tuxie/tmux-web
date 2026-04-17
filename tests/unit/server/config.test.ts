import { expect, test } from "bun:test";
import { parseConfig } from "../../../src/server/index.js";

test("parseConfig returns default values", () => {
  const { config } = parseConfig([]);
  expect(config?.tls).toBe(true);
});

test("parseConfig with --no-tls returns tls: false", () => {
  const { config } = parseConfig(["--no-tls"]);
  expect(config?.tls).toBe(false);
});

test("parseConfig with explicit --tls returns tls: true", () => {
  const { config } = parseConfig(["--tls"]);
  expect(config?.tls).toBe(true);
});

test("parseConfig includes themes-dir when provided", () => {
  const { config } = parseConfig(["--themes-dir", "/tmp/themes"]);
  expect(config?.themesDir).toBe("/tmp/themes");
});

test("parseConfig includes theme when provided", () => {
  const { config } = parseConfig(["--theme", "Default"]);
  expect(config?.theme).toBe("Default");
});

test("--version short-circuits parsing with version:true", () => {
  const r = parseConfig(["--version"]);
  expect(r.version).toBe(true);
  expect(r.config).toBeNull();
});

test("-V is the short form of --version (matches tmux -V)", () => {
  expect(parseConfig(["-V"]).version).toBe(true);
});

test("--help short-circuits parsing with help:true", () => {
  const r = parseConfig(["--help"]);
  expect(r.help).toBe(true);
  expect(r.config).toBeNull();
});

test("short flags: -a / -u / -p / -t / -d map to their long forms", () => {
  const { config } = parseConfig([
    "-a", "10.0.0.1",
    "-u", "alice",
    "-p", "secret",
    "-t", "Amiga",
    "-d",
    "--no-tls",
  ]);
  expect(config?.allowedIps.has("10.0.0.1")).toBe(true);
  expect(config?.auth.username).toBe("alice");
  expect(config?.auth.password).toBe("secret");
  expect(config?.theme).toBe("Amiga");
  expect(config?.debug).toBe(true);
});

test("-a is repeatable for multiple allowed IPs", () => {
  const { config } = parseConfig(["-a", "1.2.3.4", "-a", "5.6.7.8", "--no-auth"]);
  expect(config?.allowedIps.has("1.2.3.4")).toBe(true);
  expect(config?.allowedIps.has("5.6.7.8")).toBe(true);
});
