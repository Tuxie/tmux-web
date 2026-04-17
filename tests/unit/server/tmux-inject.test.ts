import { describe, test, expect } from "bun:test";
import { sendBytesToPane } from "../../../src/server/tmux-inject.ts";

function recordingExec() {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const exec = async (file: string, args: readonly string[]) => {
    calls.push({ file, args });
    return { stdout: "", stderr: "" };
  };
  return { calls, exec };
}

describe("sendBytesToPane", () => {
  test("invokes `tmux send-keys -H -t <target> <hex bytes>`", async () => {
    const { calls, exec } = recordingExec();
    await sendBytesToPane({
      tmuxBin: "tmux",
      target: "main",
      bytes: "\x1b[200~/tmp/x\x1b[201~",
      execFileAsync: exec,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.file).toBe("tmux");
    const args = calls[0]!.args;
    expect(args.slice(0, 4)).toEqual(["send-keys", "-H", "-t", "main"]);
    const decoded = args.slice(4)
      .map(h => String.fromCharCode(parseInt(h, 16)))
      .join("");
    expect(decoded).toBe("\x1b[200~/tmp/x\x1b[201~");
  });

  test("forwards the target string verbatim (session:window.pane form)", async () => {
    const { calls, exec } = recordingExec();
    await sendBytesToPane({
      tmuxBin: "/opt/bin/tmux",
      target: "dev:2.1",
      bytes: "x",
      execFileAsync: exec,
    });
    expect(calls[0]!.file).toBe("/opt/bin/tmux");
    expect(calls[0]!.args.slice(0, 4)).toEqual(["send-keys", "-H", "-t", "dev:2.1"]);
  });

  test("each byte is emitted as exactly one two-digit hex arg", async () => {
    const { calls, exec } = recordingExec();
    await sendBytesToPane({
      tmuxBin: "tmux",
      target: "main",
      bytes: "ab\x00\xff",
      execFileAsync: exec,
    });
    const hex = calls[0]!.args.slice(4);
    expect(hex).toEqual(["61", "62", "00", "ff"]);
  });
});
