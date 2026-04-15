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
