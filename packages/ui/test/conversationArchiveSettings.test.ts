import assert from "node:assert/strict";
import test from "node:test";
import {
  createSettingsPageConfig,
  resolveSettingsSectionForPlatform,
} from "../src/settings/settingsPageConfig.ts";
import {
  consumeInitialSettingsSection,
  setPendingSettingsSectionIntent,
  writeLastSettingsSectionPreference,
} from "../src/lib/settingsNavigation.ts";

test("archive has one data menu entry on all platforms", () => {
  for (const options of [
    {},
    { isDesktop: true },
    { isMacDesktop: true },
    { isWindowsDesktop: true },
  ]) {
    const { settingsSections, settingsSectionGroups } = createSettingsPageConfig(options);
    const entries = settingsSections.filter((section) => section.id === "conversationArchive");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].titleId, "workspaceSidebar.archivedTasks");
    assert.ok(
      settingsSectionGroups
        .find((group) => group.id === "dataAndStats")
        ?.sections.includes(entries[0]),
    );
    assert.equal(
      resolveSettingsSectionForPlatform("conversationArchive", settingsSections),
      "conversationArchive",
    );
  }
});

test("archive uses settings preference and explicit navigation intent", () => {
  const storage = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    };
  };
  const previous = globalThis.window;
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: storage(),
    sessionStorage: storage(),
  }) as never;
  try {
    writeLastSettingsSectionPreference("conversationArchive");
    assert.equal(consumeInitialSettingsSection(), "conversationArchive");
    setPendingSettingsSectionIntent("general");
    assert.equal(consumeInitialSettingsSection(), "general");
    setPendingSettingsSectionIntent("conversationArchive");
    assert.equal(consumeInitialSettingsSection(), "conversationArchive");
  } finally {
    globalThis.window = previous;
  }
});
