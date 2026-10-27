import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import test from "node:test";
import { ServiceCollection } from "@zcode/services";
import { createHttpServer, isInsideDirectory } from "../src/http.js";

test("Windows static containment rejects cross-drive, UNC and device paths", () => {
  for (const candidate of [
    "Z:\\private.txt",
    "Z:private.txt",
    "C:\\web-sibling\\private.txt",
    "C:\\private.txt",
    "\\\\server\\share\\private.txt",
    "\\\\?\\Z:\\private.txt",
  ]) {
    assert.equal(isInsideDirectory("C:\\web", candidate, win32), false, candidate);
  }
  assert.equal(isInsideDirectory("C:\\web", "c:\\WEB\\assets\\main.js", win32), true);
  assert.equal(isInsideDirectory("C:\\web", "C:\\web", win32), true);
  assert.equal(isInsideDirectory("/web", "/web/main.js", posix), true);
  assert.equal(isInsideDirectory("/web", "/private.txt", posix), false);
});

test("HTTP rejects decoded drive paths before SPA fallback and still serves valid resources", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-http-boundary-"));
  const root = join(directory, "web");
  await mkdir(root);
  await writeFile(join(root, "index.html"), "synthetic spa");
  await writeFile(join(root, "asset.txt"), "synthetic asset");
  await writeFile(join(directory, "private.txt"), "synthetic private");
  const server = createHttpServer(new ServiceCollection(), 0, {
    host: "127.0.0.1",
    staticRoot: root,
  });
  try {
    if (!server.listening) await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const path of [
      "/Z:/private.txt",
      "/Z%3A/private.txt",
      "/z%3aprivate.txt",
      "/C%3A%5cprivate.txt",
      "/%2e%2e%2fprivate.txt",
    ]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 404, path);
      assert.doesNotMatch(await response.text(), /synthetic (private|spa)/);
    }
    assert.equal(await (await fetch(origin + "/asset.txt")).text(), "synthetic asset");
    assert.equal(await (await fetch(origin + "/tasks/example")).text(), "synthetic spa");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
