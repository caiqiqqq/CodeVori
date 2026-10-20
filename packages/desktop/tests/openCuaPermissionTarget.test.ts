import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  createCurrentCuaApplicationTarget,
  resolveCurrentCuaApplicationPath,
} from "../src/main/openCuaPermissionTarget.js";
import { resolveCuaOsSupport } from "../src/main/cuaOsSupport.js";

test(
  "permission identity is the actual main executable's application, not a configured Helper",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-open-cua-app-"));
    try {
      const app = join(root, "Example.app");
      const executable = join(app, "Contents", "MacOS", "Example");
      await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
      await writeFile(executable, "fixture");
      await chmod(executable, 0o755);
      const info = join(app, "Contents", "Info.plist");
      await writeFile(
        info,
        JSON.stringify({
          CFBundleExecutable: "Example",
          CFBundleIdentifier: "test.example",
          CFBundleDisplayName: "Example",
        }),
      );
      await promisify(execFile)("/usr/bin/plutil", ["-convert", "xml1", info]);
      const target = createCurrentCuaApplicationTarget(executable);
      assert.equal(await target.ensureHelperInstalled(), app);
      assert.equal((await target.resolveHelperIdentity(app)).bundleId, "test.example");
      await assert.rejects(target.verifyHelperInstalled(join(root, "Other.app")), /当前应用/);
      assert.equal(resolveCurrentCuaApplicationPath("/usr/bin/node"), undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("open native's macOS 14 floor is reflected by desktop OS availability", () => {
  assert.equal(resolveCuaOsSupport("darwin", "22.6.0").kind, "macos-below-minimum");
  assert.deepEqual(resolveCuaOsSupport("darwin", "23.0.0"), { kind: "supported" });
  assert.equal(resolveCuaOsSupport("win32").kind, "not-applicable");
});
