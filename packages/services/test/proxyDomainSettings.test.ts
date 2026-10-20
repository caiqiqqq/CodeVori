import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettingService } from "../src/setting/settingService.js";

test("proxy domain settings persist/reload, reject malformed updates, and clear without removing other settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-proxy-settings-"));
  const previous = process.env.ZCODE_DESKTOP_HOME_DIR;
  process.env.ZCODE_DESKTOP_HOME_DIR = directory;
  try {
    const service = createSettingService();
    await service.update({
      httpProxy: "http://127.0.0.1:17890",
      httpProxyOnlyDomains: "GitHub.COM, *.Example.com",
    });
    assert.equal(
      (await createSettingService().get()).httpProxyOnlyDomains,
      "github.com,*.example.com",
    );
    await assert.rejects(service.update({ httpProxyOnlyDomains: "https://example.com" }));
    assert.equal((await service.get()).httpProxyOnlyDomains, "github.com,*.example.com");
    await service.update({ httpProxyOnlyDomains: "" });
    const settings = await createSettingService().get();
    assert.equal(settings.httpProxyOnlyDomains, undefined);
    assert.equal(settings.httpProxy, "http://127.0.0.1:17890");
    const persisted = JSON.parse(await readFile(join(directory, ".zcode/v2/setting.json"), "utf8"));
    assert.equal("httpProxyOnlyDomains" in persisted, false);
  } finally {
    if (previous === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
    else process.env.ZCODE_DESKTOP_HOME_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
