import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSettingService } from "../src/setting/settingService.js";

test("quick messages persist across service recreation and unrelated patches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-quick-message-settings-"));
  const previous = process.env.ZCODE_DESKTOP_HOME_DIR;
  process.env.ZCODE_DESKTOP_HOME_DIR = directory;
  try {
    const messages = [{ id: "snippet", title: "检查", content: "第一行\n第二行  " }];
    const service = createSettingService();
    assert.deepEqual((await service.get()).quickMessages, []);
    await service.update({ quickMessages: messages });
    await service.update({ locale: "en-US" });
    assert.deepEqual((await createSettingService().get()).quickMessages, messages);
    const file = join(directory, ".zcode", "v2", "setting.json");
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")).quickMessages, messages);
    await assert.rejects(service.update({ quickMessages: [messages[0], messages[0]] }));
    assert.deepEqual((await service.get()).quickMessages, messages);
    await service.update({ quickMessages: [] });
    assert.deepEqual((await createSettingService().get()).quickMessages, []);
  } finally {
    if (previous === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
    else process.env.ZCODE_DESKTOP_HOME_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
