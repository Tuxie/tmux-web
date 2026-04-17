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
