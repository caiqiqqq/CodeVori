import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSettingService } from "../src/setting/settingService.js";

test("concurrent alias patches merge in the owner queue and survive service recreation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-workspace-alias-"));
  const previous = process.env.ZCODE_DESKTOP_HOME_DIR;
  process.env.ZCODE_DESKTOP_HOME_DIR = directory;
  try {
    const service = createSettingService();
    await Promise.all([
      service.update({ workspaceAliases: { "/repo": " 本地 " } }),
      service.update({ workspaceAliases: { "remote:a:/repo": "远端" } }),
      service.update({ recentProjects: ["/repo"] }),
    ]);
    assert.deepEqual((await createSettingService().get()).workspaceAliases, {
      "/repo": "本地",
      "remote:a:/repo": "远端",
    });
    await assert.rejects(service.update({ workspaceAliases: { "/repo": "bad/name" } }));
    await service.update({ workspaceAliases: { "/repo": "" } });
    const saved = await createSettingService().get();
    assert.deepEqual(saved.workspaceAliases, { "remote:a:/repo": "远端" });
    assert.deepEqual(saved.recentProjects, ["/repo"]);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, ".zcode/v2/setting.json"), "utf8"))
        .workspaceAliases,
      saved.workspaceAliases,
    );
  } finally {
    if (previous === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
    else process.env.ZCODE_DESKTOP_HOME_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
