import assert from "node:assert/strict";
import test from "node:test";
import { isSettingsSectionEnabled, resolveSettingsSection } from "../src/lib/settingsNavigation.js";
import {
  createSettingsPageConfig,
  resolveSettingsSectionForPlatform,
  SETTINGS_SECTIONS,
} from "../src/settings/settingsPageConfig.js";
import zhCN from "../src/i18n/locales/zh-CN.js";
import enUS from "../src/i18n/locales/en-US.js";

test("collaboration settings are hidden and legacy navigation falls back safely", () => {
  for (const options of [
    {},
    { isDesktop: true },
    { isMacDesktop: true },
    { isWindowsDesktop: true },
  ]) {
    const { settingsSections, settingsSectionGroups } = createSettingsPageConfig(options);
    assert.equal(
      settingsSections.some((section) => section.id === "delegation"),
      false,
    );
    assert.equal(
      settingsSectionGroups
        .find((group) => group.id === "agentCapabilities")
        ?.sections.some((section) => section.id === "delegation"),
      false,
    );
    assert.equal(resolveSettingsSectionForPlatform("delegation", settingsSections), "general");
    assert.equal(resolveSettingsSectionForPlatform("acpAgents", settingsSections), "acpAgents");
  }
  assert.equal(
    SETTINGS_SECTIONS.some((section) => section.id === "delegation"),
    false,
  );
  assert.equal(isSettingsSectionEnabled("delegation"), false);
  assert.equal(resolveSettingsSection("delegation"), "general");
  assert.equal(resolveSettingsSection("delegation", "acpAgents"), "acpAgents");
});

test("collaboration settings title remains localized while the section is hidden", () => {
  assert.equal(zhCN["delegation.settingsTitle"], "多智能体协同");
  assert.equal(enUS["delegation.settingsTitle"], "Multi-agent collaboration");
});
