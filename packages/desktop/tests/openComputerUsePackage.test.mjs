import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import config from "../electron-builder.config.js";

test("computer control native copies participate in signing without resigning existing runtime assets", () => {
  const ignored = (path) => config.mac.signIgnore.some((pattern) => new RegExp(pattern).test(path));
  const resources = "/tmp/Example.app/Contents/Resources";
  assert.equal(
    ignored(`${resources}/glm/packages/zcode-cua-plugin/dist/native/OpenZCodeNative`),
    false,
  );
  assert.equal(ignored(`${resources}/open-computer-use/OpenZCodeNative`), false);
  assert.equal(ignored(`${resources}/glm/zcode`), true);
  assert.equal(ignored(`${resources}/tools/rg`), true);
});

test(
  "macOS staged plugin contains native, MCP, skills and licenses",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = resolve(
      import.meta.dirname,
      `../bundled-agents/darwin-${process.arch}/glm/packages/zcode-cua-plugin`,
    );
    for (const path of [
      "dist/mcp/server.js",
      "dist/native/OpenZCodeNative",
      "dist/LICENSE",
      "dist/NOTICE",
      "skills/computer-use/SKILL.md",
    ])
      await access(resolve(root, path));
    assert.ok((await stat(resolve(root, "dist/native/OpenZCodeNative"))).mode & 0o111);
    assert.equal(
      JSON.parse(await readFile(resolve(root, ".zcode-plugin/plugin.json"), "utf8")).version,
      "0.6.4",
    );
    const resource = config.extraResources.find(
      (resource) => resource.to === "open-computer-use/OpenZCodeNative",
    );
    assert.ok(resource);
    assert.deepEqual(
      await readFile(resource.from),
      await readFile(resolve(root, "dist/native/OpenZCodeNative")),
    );
  },
);
