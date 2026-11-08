import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createSettingService } from "../src/setting/settingService.js";

async function withHome(run: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "codevori-settings-isolation-"));
  const previous = process.env.ZCODE_DESKTOP_HOME_DIR;
  process.env.ZCODE_DESKTOP_HOME_DIR = home;
  try {
    await run(home);
  } finally {
    if (previous === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
    else process.env.ZCODE_DESKTOP_HOME_DIR = previous;
    await rm(home, { recursive: true, force: true });
  }
}

async function seed(file: string, settings: unknown) {
  await mkdir(dirname(file), { recursive: true });
  const raw = JSON.stringify(settings, null, 2);
  await writeFile(file, raw);
  return raw;
}

const messages = [{ id: "saved", title: "检查", content: "第一行\n第二行  " }];

test("missing CodeVori settings do not import the ZCode settings file", async () => {
  await withHome(async (home) => {
    const legacy = join(home, ".zcode/v2/setting.json");
    const current = join(home, ".codevori/v2/setting.json");
    const raw = await seed(legacy, { quickMessages: messages, locale: "en-US" });
    const service = createSettingService();
    assert.deepEqual((await service.get()).quickMessages, []);
    await assert.rejects(readFile(current), { code: "ENOENT" });
    await service.update({ locale: "zh-CN" });
    assert.equal(await readFile(legacy, "utf8"), raw);
    assert.equal(JSON.parse(await readFile(current, "utf8")).locale, "zh-CN");
  });
});

test("current settings are authoritative when legacy settings change or messages are cleared", async () => {
  await withHome(async (home) => {
    const legacy = join(home, ".zcode/v2/setting.json");
    const current = join(home, ".codevori/v2/setting.json");
    await seed(legacy, { quickMessages: messages, locale: "en-US" });
    await seed(current, { quickMessages: [], locale: "zh-CN" });
    assert.deepEqual((await createSettingService().get()).quickMessages, []);
    const service = createSettingService();
    await service.update({ quickMessages: messages });
    await service.update({ quickMessages: [] });
    await seed(legacy, { quickMessages: messages, locale: "en-US" });
    const saved = await createSettingService().get();
    assert.deepEqual(saved.quickMessages, []);
    assert.equal(saved.locale, "zh-CN");
  });
});

test("fresh settings are created only under the current product directory", async () => {
  await withHome(async (home) => {
    await createSettingService().update({ quickMessages: messages });
    const saved = JSON.parse(await readFile(join(home, ".codevori/v2/setting.json"), "utf8"));
    assert.deepEqual(saved.quickMessages, messages);
    await assert.rejects(readFile(join(home, ".zcode/v2/setting.json")), { code: "ENOENT" });
  });
});
