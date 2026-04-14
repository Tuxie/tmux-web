import { expect, test } from "bun:test";
import { parseConfig } from "../../../src/server/index.js";

test("parseConfig returns default values", () => {
  const { config } = parseConfig([]);
  expect(config?.tls).toBe(false);
});
