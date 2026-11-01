import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import config from "../electron-builder.config.js";

test("local macOS builds retain valid ad-hoc signing without a release certificate", () => {
  if (process.env.ZCODE_ENABLE_MAC_SIGN === "1") return;
  assert.equal(config.mac.identity, "-");
  assert.equal(config.mac.notarize, false);
});

test("Intel executor is signed with the app while verified native libraries retain their signatures", () => {
  const ignored = (path) => config.mac.signIgnore.some((pattern) => new RegExp(pattern).test(path));
  const resources = "/tmp/Example.app/Contents/Resources";
  assert.equal(
    ignored(`${resources}/glm/packages/zcode-cua-plugin/dist/native/OpenZCodeNative`),
    false,
  );
  assert.equal(ignored(`${resources}/open-computer-use/OpenZCodeNative`), false);
  for (const name of ["ax_native.node", "cocoa-runloop.node"]) {
    assert.equal(ignored(`${resources}/open-computer-use/${name}`), true);
    assert.equal(ignored(`${resources}/glm/packages/zcode-cua-plugin/dist/native/${name}`), true);
  }
  assert.equal(ignored(`${resources}/glm/zcode`), true);
  assert.equal(ignored(`${resources}/tools/rg`), true);
});

test(
  "built desktop plugin contains the exact target native resources, MCP, skills and notices",
  { skip: !["darwin", "win32"].includes(process.platform) },
  async () => {
    const root = resolve(import.meta.dirname, "../../zcode-cua-plugin");
    const intel = process.platform === "darwin" && process.arch === "x64";
    const nativeFiles = intel
      ? ["OpenZCodeNative"]
      : [
          "ax_native.node",
          "helper.mjs",
          "runtime.json",
          ...(process.platform === "darwin" ? ["cocoa-runloop.node"] : []),
        ];
    for (const path of [
      "dist/mcp/server.js",
      ...nativeFiles.map((name) => `dist/native/${name}`),
      "dist/LICENSE",
      "dist/NOTICE",
      "skills/computer-use/SKILL.md",
    ])
      await access(resolve(root, path));
    if (intel) assert.ok((await stat(resolve(root, "dist/native/OpenZCodeNative"))).mode & 0o111);
    const manifest = JSON.parse(await readFile(resolve(root, ".zcode-plugin/plugin.json"), "utf8"));
    const metadata = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    assert.equal(manifest.version, metadata.version);
    const resource = config.extraResources.find((resource) => resource.to === "open-computer-use");
    assert.ok(resource);
    assert.deepEqual(resource.filter, nativeFiles);
    for (const name of nativeFiles)
      assert.deepEqual(
        await readFile(resolve(resource.from, name)),
        await readFile(resolve(root, "dist/native", name)),
      );
  },
);
