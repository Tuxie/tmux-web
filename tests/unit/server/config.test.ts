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
