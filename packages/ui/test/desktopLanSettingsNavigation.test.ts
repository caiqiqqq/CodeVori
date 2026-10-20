import assert from "node:assert/strict";
import test from "node:test";
import { resolveSettingsSection } from "../src/lib/settingsNavigation.js";
import {
  createSettingsPageConfig,
  resolveSettingsSectionForPlatform,
  SETTINGS_SECTIONS,
} from "../src/settings/settingsPageConfig.js";

test("LAN access has an independent basics entry only with desktop platform capability", () => {
  for (const platform of [
    { isDesktop: true },
    { isMacDesktop: true },
    { isWindowsDesktop: true },
  ]) {
    const supported = createSettingsPageConfig({ ...platform, supportsDesktopLanAccess: true });
    const entries = supported.settingsSectionGroups
      .find((group) => group.id === "basics")!
      .sections.filter((section) => section.id === "desktopLan");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].titleId, "settings.desktopLan.title");
    assert.equal(resolveSettingsSection("desktopLan"), "desktopLan");
    assert.equal(
      resolveSettingsSectionForPlatform("desktopLan", supported.settingsSections),
      "desktopLan",
    );
  }
  for (const options of [{}, { isDesktop: true }, { supportsDesktopLanAccess: true }]) {
    const { settingsSections } = createSettingsPageConfig(options);
    assert.ok(!settingsSections.some((section) => section.id === "desktopLan"));
    assert.equal(resolveSettingsSectionForPlatform("desktopLan", settingsSections), "general");
  }
  assert.ok(!SETTINGS_SECTIONS.some((section) => section.id === "desktopLan"));
});
