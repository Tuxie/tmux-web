import { describe, test, expect } from "bun:test";
import { readBodyCapped } from "../../../src/server/http.ts";

/** Build a Request whose body is a ReadableStream we control. Lets us
 *  construct a stream whose cancel() hangs, exercising F3's timeout
 *  race. */
function makeStreamRequest(opts: {
  bytes: Uint8Array[];
  /** How long cancel() blocks before resolving. Use a large value (e.g.
   *  10_000) to simulate a hung upstream. */
  cancelDelayMs: number;
}): { req: Request; cancelled: () => boolean } {
  let cancelCalled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const b of opts.bytes) controller.enqueue(b);
      // Don't close — keep the reader expecting more.
    },
    cancel(_reason) {
      cancelCalled = true;
      return new Promise<void>(resolve => setTimeout(resolve, opts.cancelDelayMs));
    },
  });
  const req = new Request("http://x/post", { method: "POST", body: stream });
  return { req, cancelled: () => cancelCalled };
}

describe("readBodyCapped (cluster 15 / F3 — cancel timeout)", () => {
  test("returns null within ~600ms even if the underlying stream's cancel() hangs", async () => {
    // The upstream stream's cancel() blocks for 10 seconds. Our cap is
    // 4 bytes; first chunk is 8 bytes, so the cap trips immediately and
    // readBodyCapped goes to its cancel() path. The 500 ms race must
    // unstick us — total elapsed should be well under the 10s the
    // cancel() would otherwise consume.
    const { req, cancelled } = makeStreamRequest({
      bytes: [new Uint8Array(8)],
      cancelDelayMs: 10_000,
    });

    const start = Date.now();
    const result = await readBodyCapped(req, 4);
    const elapsed = Date.now() - start;

    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(800); // generous bound: 500ms timeout + slack
    expect(cancelled()).toBe(true);
  });

  test("under-cap body still returns the bytes (regression guard)", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const req = new Request("http://x/post", { method: "POST", body: stream });
    const result = await readBodyCapped(req, 100);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
  });

  test("missing body returns an empty Buffer", async () => {
    const req = new Request("http://x/get", { method: "GET" });
    const result = await readBodyCapped(req, 100);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(0);
  });

  test("cancel() that resolves quickly is not penalised by the timeout race", async () => {
    const { req, cancelled } = makeStreamRequest({
      bytes: [new Uint8Array(8)],
      cancelDelayMs: 10,
    });
    const start = Date.now();
    const result = await readBodyCapped(req, 4);
    const elapsed = Date.now() - start;
    expect(result).toBeNull();
    // Returned via the fast cancel, not the 500ms timeout — well under 200ms.
    expect(elapsed).toBeLessThan(200);
    expect(cancelled()).toBe(true);
  });
});
