import { describe, test, expect } from "bun:test";
import { processData, buildOsc52Response } from "../../../src/server/protocol.ts";

describe("processData — OSC 52 read detection", () => {
  test("ESC ] 52 ; c ; ? BEL is detected and stripped", () => {
    const { output, readRequests } = processData("\x1b]52;c;?\x07hello", "main");
    expect(readRequests).toEqual([{ selection: "c" }]);
    expect(output).toBe("hello");
  });

  test("ST terminator is also accepted", () => {
    const { output, readRequests } = processData("\x1b]52;p;?\x1b\\world", "main");
    expect(readRequests).toEqual([{ selection: "p" }]);
    expect(output).toBe("world");
  });

  test("multiple reads in one chunk are all captured", () => {
    const { readRequests, output } = processData(
      "a\x1b]52;c;?\x07b\x1b]52;c;?\x07c", "main",
    );
    expect(readRequests).toHaveLength(2);
    expect(output).toBe("abc");
  });

  test("write payloads are not reported as read requests", () => {
    const { readRequests, messages } = processData("\x1b]52;c;aGVsbG8=\x07", "main");
    expect(readRequests).toHaveLength(0);
    expect(messages.some(m => m.clipboard === "aGVsbG8=")).toBe(true);
  });

  test("empty selection field defaults to 'c'", () => {
    const { readRequests } = processData("\x1b]52;;?\x07", "main");
    expect(readRequests).toEqual([{ selection: "c" }]);
  });
});

describe("buildOsc52Response", () => {
  test("formats the expected OSC 52 reply with BEL terminator", () => {
    expect(buildOsc52Response("c", "aGk=")).toBe("\x1b]52;c;aGk=\x07");
  });

  test("empty base64 is valid (used for deny / empty clipboard)", () => {
    expect(buildOsc52Response("c", "")).toBe("\x1b]52;c;\x07");
  });
});

describe("OSC 52 write interceptor — adversarial inputs", () => {
  test("drops payloads larger than 1 MiB and does not emit a TT message", () => {
    // 2 MiB of base64 'A' characters — well over the 1 MiB cap
    const huge = "A".repeat(2 * 1024 * 1024);
    const seq = `\x1b]52;c;${huge}\x07`;
    const { messages } = processData(seq, "main");
    expect(messages.some(m => "clipboard" in m)).toBe(false);
  });

  test("accepts small payloads under the 1 MiB cap", () => {
    const small = Buffer.from("hello").toString("base64"); // "aGVsbG8="
    const seq = `\x1b]52;c;${small}\x07`;
    const { messages } = processData(seq, "main");
    expect(messages.some(m => m.clipboard === small)).toBe(true);
  });

  test("accepts a payload exactly at the 1 MiB boundary", () => {
    // 1 MiB of valid base64 characters (A) — exactly at the limit, should pass
    const atLimit = "A".repeat(1 * 1024 * 1024);
    const seq = `\x1b]52;c;${atLimit}\x07`;
    const { messages } = processData(seq, "main");
    expect(messages.some(m => m.clipboard === atLimit)).toBe(true);
  });

  test("drops a payload one byte over the 1 MiB cap", () => {
    const overLimit = "A".repeat(1 * 1024 * 1024 + 1);
    const seq = `\x1b]52;c;${overLimit}\x07`;
    const { messages } = processData(seq, "main");
    expect(messages.some(m => "clipboard" in m)).toBe(false);
  });

  test("rejects base64 with invalid characters — poisoned char is not matched by OSC_52_WRITE_RE", () => {
    // OSC_52_WRITE_RE only matches [A-Za-z0-9+/=]+; a '!' stops the match.
    // The sequence is either rejected entirely or the poisoned payload is not captured.
    const poisoned = `\x1b]52;c;AAA!BBB\x07`;
    const { messages } = processData(poisoned, "main");
    // The regex only captures the valid-base64 prefix "AAA"; the match terminates
    // at '!' so the full sequence is not stripped from output, but no large payload leaks.
    // What matters: no clipboard message contains the poison character.
    const clipboardMessages = messages.filter(m => "clipboard" in m);
    for (const m of clipboardMessages) {
      expect(m.clipboard).not.toContain("!");
    }
  });

  test("handles multiple OSC 52 writes in one chunk, dropping only the oversized one", () => {
    const small = Buffer.from("ok").toString("base64"); // "b2s="
    const huge = "A".repeat(2 * 1024 * 1024);
    const seq = `\x1b]52;c;${small}\x07\x1b]52;c;${huge}\x07`;
    const { messages } = processData(seq, "main");
    const clipMessages = messages.filter(m => "clipboard" in m);
    // Only the small payload should be forwarded
    expect(clipMessages).toHaveLength(1);
    expect(clipMessages[0]!.clipboard).toBe(small);
  });

  test("caps OSC 52 write frames per chunk (keeps last N)", () => {
    // Build 20 distinct OSC 52 writes in a single chunk. Only the last 8
    // should reach the client — earlier clipboard writes are superseded
    // on the browser side anyway.
    const frames: string[] = [];
    for (let i = 0; i < 20; i++) {
      const payload = Buffer.from(`n${i}`).toString("base64");
      frames.push(`\x1b]52;c;${payload}\x07`);
    }
    const { messages } = processData(frames.join(""), "main");
    const clips = messages.filter(m => "clipboard" in m).map(m => m.clipboard as string);
    expect(clips).toHaveLength(8);
    // Last 8 payloads correspond to i=12..19.
    const expected = Array.from({ length: 8 }, (_, k) =>
      Buffer.from(`n${k + 12}`).toString("base64"),
    );
    expect(clips).toEqual(expected);
  });
});
