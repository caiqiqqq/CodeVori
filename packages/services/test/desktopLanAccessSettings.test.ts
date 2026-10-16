import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettingService } from "../src/setting/settingService.js";
import { desktopLanAccessConfigurationSchema } from "@zcode/shared";

test("LAN startup preference defaults off, persists true/false and rejects malformed updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-lan-settings-"));
  const previous = process.env.ZCODE_DESKTOP_HOME_DIR;
  process.env.ZCODE_DESKTOP_HOME_DIR = directory;
  try {
    const service = createSettingService();
    assert.equal((await service.get()).desktopLanAccessEnabled, false);
    assert.equal((await service.get()).desktopLanAccessConfiguration, undefined);
    const configuration = { address: "my-codevori.local", port: 49152 };
    await service.update({ desktopLanAccessConfiguration: configuration });
    assert.deepEqual(
      (await createSettingService().get()).desktopLanAccessConfiguration,
      configuration,
    );
    for (const invalid of [
      { address: "http://192.168.1.100", port: 3030 },
      { address: "192.168.1.100:3030", port: 3030 },
      { address: "0.0.0.0", port: 3030 },
      { address: "192.168.1.999", port: 3030 },
      { address: "169.254.1.10", port: 3030 },
      { address: "example.com", port: 3030 },
      { address: "192.168.1.100", port: 0 },
      { address: "192.168.1.100", port: 65536 },
      { address: "192.168.1.100", port: 3.5 },
      { address: "192.168.1.100", port: "3030" },
      { address: "192.168.1.100", port: 3030, token: "unexpected" },
    ])
      await assert.rejects(service.update({ desktopLanAccessConfiguration: invalid } as never));
    assert.deepEqual(
      (await createSettingService().get()).desktopLanAccessConfiguration,
      configuration,
    );
    for (const address of ["10.0.0.3", "172.16.1.2", "192.168.1.100", "CodeVori.local"]) {
      assert.equal(
        desktopLanAccessConfigurationSchema.safeParse({ address, port: 65535 }).success,
        true,
      );
    }
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
    assert.deepEqual(persisted.desktopLanAccessConfiguration, configuration);
    assert.equal("desktopLanAccessToken" in persisted, false);
  } finally {
    if (previous === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
    else process.env.ZCODE_DESKTOP_HOME_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
