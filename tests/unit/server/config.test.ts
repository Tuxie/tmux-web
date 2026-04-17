import { expect, test, describe } from "bun:test";
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

test("short flags: -i / -u / -p / -t / -d map to their long forms", () => {
  const { config } = parseConfig([
    "-i", "10.0.0.1",
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

test("-i is repeatable for multiple allowed IPs", () => {
  const { config } = parseConfig(["-i", "1.2.3.4", "-i", "5.6.7.8", "--no-auth"]);
  expect(config?.allowedIps.has("1.2.3.4")).toBe(true);
  expect(config?.allowedIps.has("5.6.7.8")).toBe(true);
});

describe("--allow-origin / --allow-ip defaults", () => {
  test("defaults allowedIps to loopback (127.0.0.1 and ::1)", () => {
    const { config } = parseConfig(["--no-auth"]);
    expect(config?.allowedIps.has("127.0.0.1")).toBe(true);
    expect(config?.allowedIps.has("::1")).toBe(true);
  });
  test("defaults allowedOrigins to empty", () => {
    const { config } = parseConfig(["--no-auth"]);
    expect(config?.allowedOrigins).toEqual([]);
  });
  test("accepts -i as short alias for --allow-ip (replaces legacy -a)", () => {
    const { config } = parseConfig(["--no-auth", "-i", "10.0.0.5"]);
    expect(config?.allowedIps.has("10.0.0.5")).toBe(true);
  });
  test("accepts -o as short alias for --allow-origin", () => {
    const { config } = parseConfig(["--no-auth", "-o", "https://tmux.example.com"]);
    expect(config?.allowedOrigins).toEqual([
      { scheme: "https", host: "tmux.example.com", port: 443 },
    ]);
  });
  test('accepts "-o *" wildcard', () => {
    const { config } = parseConfig(["--no-auth", "-o", "*"]);
    expect(config?.allowedOrigins).toEqual(["*"]);
  });
  test("throws on malformed --allow-origin", () => {
    expect(() => parseConfig(["--no-auth", "-o", "not-a-url"])).toThrow();
  });
});

import { warnIfDangerousOriginConfig } from "../../../src/server/index.js";
import { isOriginAllowed } from "../../../src/server/origin.js";

describe("warnIfDangerousOriginConfig", () => {
  test("warns when -o * combines with a non-loopback --allow-ip", () => {
    const messages: string[] = [];
    const origErr = console.error;
    console.error = (m: unknown) => { messages.push(String(m)); };
    try {
      warnIfDangerousOriginConfig({
        allowedIps: new Set(["127.0.0.1", "::1", "192.168.2.4"]),
        allowedOrigins: ["*"],
      });
    } finally {
      console.error = origErr;
    }
    expect(messages.some(m => m.includes("--allow-origin *"))).toBe(true);
  });
  test("does not warn when -o * combines only with loopback", () => {
    const messages: string[] = [];
    const origErr = console.error;
    console.error = (m: unknown) => { messages.push(String(m)); };
    try {
      warnIfDangerousOriginConfig({
        allowedIps: new Set(["127.0.0.1", "::1"]),
        allowedOrigins: ["*"],
      });
    } finally {
      console.error = origErr;
    }
    expect(messages).toEqual([]);
  });
  test("does not warn when -o is not wildcard", () => {
    const messages: string[] = [];
    const origErr = console.error;
    console.error = (m: unknown) => { messages.push(String(m)); };
    try {
      warnIfDangerousOriginConfig({
        allowedIps: new Set(["127.0.0.1", "192.168.2.4"]),
        allowedOrigins: [{ scheme: "https", host: "tmux.example.com", port: 443 }],
      });
    } finally {
      console.error = origErr;
    }
    expect(messages).toEqual([]);
  });
});

describe("HTTP Origin check integration (pure shape)", () => {
  test("default config rejects cross-origin from evil.com", () => {
    const { config } = parseConfig(["--no-auth"]);
    expect(isOriginAllowed(
      { headers: { origin: "https://evil.com" } } as any,
      {
        allowedIps: config!.allowedIps,
        allowedOrigins: config!.allowedOrigins,
        serverScheme: config!.tls ? "https" : "http",
        serverPort: config!.port,
      },
    )).toBe(false);
  });
});
