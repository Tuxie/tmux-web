import { describe, test, expect } from "bun:test";
import { createHttpHandler } from "../../../src/server/http.ts";
import fs from "fs"; import path from "path"; import os from "os";

async function once(handler: any, url: string) {
  return new Promise<{status: number; body: string}>((resolve) => {
    const req: any = { method: "GET", url, headers: { host: "x" }, socket: { remoteAddress: "127.0.0.1" } };
    const res: any = {
      writeHead(status: number, _h?: any) { this._status = status; },
      end(body?: any) { resolve({ status: this._status ?? 200, body: body?.toString?.() ?? "" }); },
    };
    Promise.resolve(handler(req, res));
  });
}

describe("/api/colours", () => {
  test("returns parsed colour schemes", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-api-"));
    const pack = path.join(tmp, "p");
    fs.mkdirSync(path.join(pack, "colours"), { recursive: true });
    fs.writeFileSync(path.join(pack, "colours", "foo.toml"),
      `[colors.primary]\nforeground="#ffffff"\nbackground="#000000"\n`);
    fs.writeFileSync(path.join(pack, "theme.json"), JSON.stringify({
      colours: [{ file: "colours/foo.toml", name: "Foo", variant: "dark" }],
      themes: [],
    }));

    const handler = await createHttpHandler({
      config: { host: "", port: 0, allowedIps: new Set(), tls: false, testMode: true, debug: false,
                tmuxBin: "tmux", auth: { enabled: false } } as any,
      htmlTemplate: "", distDir: "", fontsDir: "", themesUserDir: "",
      themesBundledDir: tmp, projectRoot: tmp, isCompiled: false,
    });
    const { status, body } = await once(handler, "/api/colours");
    expect(status).toBe(200);
    const json = JSON.parse(body);
    expect(json).toHaveLength(1);
    expect(json[0].name).toBe("Foo");
    expect(json[0].variant).toBe("dark");
    expect(json[0].theme.background).toBe("#000000");
  });
});
