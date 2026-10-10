import assert from "node:assert/strict";
import test from "node:test";
import {
  appSettingsSchema,
  appSettingsPatchSchema,
} from "../../shared/src/validationAppSettings.js";
import { createSettingsPageConfig } from "../src/settings/settingsPageConfig.js";

const messages = [
  { id: "one", title: "检查", content: "第一行\n第二行  " },
  { id: "two", title: "提交", content: "请检查变更" },
];

test("quick messages round trip without losing order or content whitespace", () => {
  assert.deepEqual(appSettingsSchema.parse({}).quickMessages, []);
  const patch = appSettingsPatchSchema.parse({ quickMessages: messages });
  assert.deepEqual(patch.quickMessages, messages);
  assert.deepEqual(appSettingsSchema.parse(patch).quickMessages, messages);
  assert.deepEqual(appSettingsPatchSchema.parse({ quickMessages: [] }).quickMessages, []);
  assert.equal(
    Object.hasOwn(appSettingsPatchSchema.parse({ locale: "en-US" }), "quickMessages"),
    false,
  );
});

test("quick messages reject invalid and duplicate identifiers and blank/oversized text", () => {
  for (const quickMessages of [
    [{ ...messages[0], id: " " }],
    [{ ...messages[0], title: "\n " }],
    [{ ...messages[0], content: "\n " }],
    [{ ...messages[0], title: "a".repeat(101) }],
    [{ ...messages[0], content: "a".repeat(20001) }],
    [messages[0], messages[0]],
    Array.from({ length: 201 }, (_, index) => ({ ...messages[0], id: String(index) })),
  ]) {
    assert.equal(appSettingsPatchSchema.safeParse({ quickMessages }).success, false);
  }
});

test("quick messages settings entry exists on desktop and web", () => {
  for (const options of [{}, { isDesktop: true }, { isWindowsDesktop: true }]) {
    assert.equal(
      createSettingsPageConfig(options).settingsSections.filter((s) => s.id === "quickMessages")
        .length,
      1,
    );
  }
});
