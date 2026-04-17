import { describe, test, expect } from "bun:test";
import { deliverOsc52Reply } from "../../../src/server/osc52-reply.ts";

function recordingExec() {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const exec = async (file: string, args: readonly string[]) => {
    calls.push({ file, args });
    return { stdout: "", stderr: "" };
  };
  return { calls, exec };
}

describe("deliverOsc52Reply", () => {
  test("invokes tmux send-keys -H, not a direct PTY write, when no directWrite is provided", async () => {
    const { calls, exec } = recordingExec();
    let directWriteCalls = 0;
    const sawDirect = (_bytes: string) => { directWriteCalls++; };

    await deliverOsc52Reply({
      tmuxBin: "tmux",
      target: "main",
      selection: "c",
      base64: "aGk=",
      execFileAsync: exec,
      // intentionally no directWrite — this is the "running under tmux" path
      // that the original bug got wrong.
    });

    expect(directWriteCalls).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.file).toBe("tmux");
    const args = calls[0]!.args;
    expect(args.slice(0, 4)).toEqual(["send-keys", "-H", "-t", "main"]);
    // Remaining args must be two-char hex bytes, nothing else. The bug path
    // would be zero tmux calls and a ptyProcess.write instead, which the
    // first assertion above catches; this one locks in the send-keys -H
    // invariant so a future refactor can't quietly regress to a key-string
    // send-keys (missing -H) that tmux would parse and mangle.
    const hexArgs = args.slice(4);
    expect(hexArgs.every(a => /^[0-9a-f]{2}$/.test(a))).toBe(true);
  });

  test("hex args decode back to the expected OSC 52 response bytes", async () => {
    const { calls, exec } = recordingExec();
    await deliverOsc52Reply({
      tmuxBin: "tmux",
      target: "dev",
      selection: "c",
      base64: "aGk=",
      execFileAsync: exec,
    });
    const hex = calls[0]!.args.slice(4);
    const decoded = hex.map(h => String.fromCharCode(parseInt(h, 16))).join("");
    expect(decoded).toBe("\x1b]52;c;aGk=\x07");
  });

  test("empty base64 still delivers a well-formed OSC 52 reply (deny path)", async () => {
    const { calls, exec } = recordingExec();
    await deliverOsc52Reply({
      tmuxBin: "tmux",
      target: "main",
      selection: "c",
      base64: "",
      execFileAsync: exec,
    });
    const hex = calls[0]!.args.slice(4);
    expect(hex.map(h => String.fromCharCode(parseInt(h, 16))).join(""))
      .toBe("\x1b]52;c;\x07");
  });

  test("directWrite shortcut (test mode) bypasses tmux entirely", async () => {
    const { calls, exec } = recordingExec();
    let captured = "";
    await deliverOsc52Reply({
      tmuxBin: "tmux",
      target: "main",
      selection: "c",
      base64: "b2s=",
      execFileAsync: exec,
      directWrite: (bytes) => { captured = bytes; },
    });
    expect(calls).toHaveLength(0);
    expect(captured).toBe("\x1b]52;c;b2s=\x07");
  });

  test("target string is forwarded verbatim (session, window, pane)", async () => {
    const { calls, exec } = recordingExec();
    await deliverOsc52Reply({
      tmuxBin: "tmux",
      target: "dev:2.1",
      selection: "c",
      base64: "",
      execFileAsync: exec,
    });
    expect(calls[0]!.args.slice(0, 4)).toEqual(["send-keys", "-H", "-t", "dev:2.1"]);
  });

  test("uses the configured tmux binary path", async () => {
    const { calls, exec } = recordingExec();
    await deliverOsc52Reply({
      tmuxBin: "/opt/homebrew/bin/tmux",
      target: "main",
      selection: "c",
      base64: "",
      execFileAsync: exec,
    });
    expect(calls[0]!.file).toBe("/opt/homebrew/bin/tmux");
  });
});
