import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const servicesUrl = `data:text/javascript,${encodeURIComponent("export function setDataBaseDir() {}")}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "@zcode/services/node" &&
      context.parentURL?.endsWith("/desktopDataBaseDirBootstrap.ts")
    ) {
      return { url: servicesUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

try {
  const { applyEarlyDataBaseDirBootstrap } =
    await import("../src/main/desktopDataBaseDirBootstrap.ts");
  const { applyEarlyChromiumHardwareAccelerationBootstrap } =
    await import("../src/main/desktopChromiumHardwareAccelerationBootstrap.ts");
  const { resolveStartupWindowBootstrap } = await import("../src/main/startupWorkspace.ts");
  await test("pre-ready settings prefer the product file and only fall back when it is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "codevori-settings-bootstrap-"));
    const previous = process.env.ZCODE_DESKTOP_HOME_DIR;
    process.env.ZCODE_DESKTOP_HOME_DIR = home;
    try {
      const current = join(home, ".codevori/v2/setting.json");
      const legacy = join(home, ".zcode/v2/setting.json");
      const legacyRaw = JSON.stringify({
        dataBaseDir: "/legacy",
        desktopChromiumHardwareAccelerationEnabled: false,
      });
      await mkdir(dirname(legacy), { recursive: true });
      await writeFile(legacy, legacyRaw);
      let disabled = 0;
      const app = {
        disableHardwareAcceleration() {
          disabled += 1;
        },
      };
      assert.equal(applyEarlyDataBaseDirBootstrap(), "/legacy");
      assert.equal(applyEarlyChromiumHardwareAccelerationBootstrap(app), false);
      assert.equal(disabled, 1);
      await assert.rejects(readFile(current), { code: "ENOENT" });
      await mkdir(dirname(current), { recursive: true });
      await writeFile(
        current,
        JSON.stringify({
          dataBaseDir: "/current",
          desktopChromiumHardwareAccelerationEnabled: true,
        }),
      );
      assert.equal(applyEarlyDataBaseDirBootstrap(), "/current");
      assert.equal(applyEarlyChromiumHardwareAccelerationBootstrap(app), true);
      assert.equal(disabled, 1);
      await writeFile(current, "broken current JSON");
      assert.equal(applyEarlyDataBaseDirBootstrap(), null);
      assert.equal(applyEarlyChromiumHardwareAccelerationBootstrap(app), true);
      assert.equal(await readFile(legacy, "utf8"), legacyRaw);
    } finally {
      if (previous === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
      else process.env.ZCODE_DESKTOP_HOME_DIR = previous;
      await rm(home, { recursive: true, force: true });
    }
  });
  await test("workspace restoration migrates settings and malformed legacy JSON still permits startup", async () => {
    const home = await mkdtemp(join(tmpdir(), "codevori-workspace-settings-"));
    const previous = process.env.ZCODE_DESKTOP_HOME_DIR;
    process.env.ZCODE_DESKTOP_HOME_DIR = home;
    try {
      const workspace = join(home, "project");
      const conversationWorkspaceDir = join(home, "conversation");
      const legacy = join(home, ".zcode/v2/setting.json");
      await mkdir(workspace);
      await mkdir(dirname(legacy), { recursive: true });
      await writeFile(
        legacy,
        JSON.stringify({
          lastWorkspaceSession: [{ kind: "local", workspacePath: workspace }],
          recentProjects: [workspace],
        }),
      );
      const restored = await resolveStartupWindowBootstrap({ conversationWorkspaceDir });
      assert.deepEqual(restored.agentWarmupTargets, [{ workspacePath: workspace }]);
      assert.ok(await readFile(join(home, ".codevori/v2/setting.json"), "utf8"));

      process.env.ZCODE_DESKTOP_HOME_DIR = join(home, "invalid-home");
      const invalidLegacy = join(home, "invalid-home/.zcode/v2/setting.json");
      await mkdir(dirname(invalidLegacy), { recursive: true });
      await writeFile(invalidLegacy, "broken legacy JSON");
      const fresh = await resolveStartupWindowBootstrap({ conversationWorkspaceDir });
      assert.equal(fresh.initialWorkspacePath, conversationWorkspaceDir);
      assert.equal(fresh.initialWorkspacePurpose, "conversation");
      assert.equal(await readFile(invalidLegacy, "utf8"), "broken legacy JSON");
    } finally {
      if (previous === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
      else process.env.ZCODE_DESKTOP_HOME_DIR = previous;
      await rm(home, { recursive: true, force: true });
    }
  });
} finally {
  hooks.deregister();
}
