import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettingService } from "../src/setting/settingService.js";

test("LAN startup preference defaults off, persists true/false and rejects malformed updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-lan-settings-"));
  const previous = process.env.ZCODE_DESKTOP_HOME_DIR;
  process.env.ZCODE_DESKTOP_HOME_DIR = directory;
  try {
    const service = createSettingService();
    assert.equal((await service.get()).desktopLanAccessEnabled, false);
    await service.update({ desktopLanAccessEnabled: true, locale: "en-US" });
    assert.equal((await createSettingService().get()).desktopLanAccessEnabled, true);
    await assert.rejects(service.update({ desktopLanAccessEnabled: "true" } as never));
    assert.equal((await service.get()).desktopLanAccessEnabled, true);
    await service.update({ desktopLanAccessEnabled: false });
    const reloaded = await createSettingService().get();
    assert.equal(reloaded.desktopLanAccessEnabled, false);
    assert.equal(reloaded.locale, "en-US");
    const persisted = JSON.parse(await readFile(join(directory, ".zcode/v2/setting.json"), "utf8"));
    assert.equal(persisted.desktopLanAccessEnabled, false);
    assert.equal("desktopLanAccessToken" in persisted, false);
  } finally {
    if (previous === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
    else process.env.ZCODE_DESKTOP_HOME_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
