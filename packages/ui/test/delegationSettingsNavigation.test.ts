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

test("collaboration has one independent entry in agent capabilities on desktop and web", () => {
  for (const options of [
    {},
    { isDesktop: true },
    { isMacDesktop: true },
    { isWindowsDesktop: true },
  ]) {
    const { settingsSections, settingsSectionGroups } = createSettingsPageConfig(options);
    const entries = settingsSections.filter((section) => section.id === "delegation");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].titleId, "delegation.settingsTitle");
    assert.ok(
      settingsSectionGroups
        .find((group) => group.id === "agentCapabilities")
        ?.sections.some((section) => section.id === "delegation"),
    );
    assert.equal(resolveSettingsSectionForPlatform("delegation", settingsSections), "delegation");
    assert.equal(resolveSettingsSectionForPlatform("acpAgents", settingsSections), "acpAgents");
  }
  assert.equal(SETTINGS_SECTIONS.filter((section) => section.id === "delegation").length, 1);
  assert.equal(isSettingsSectionEnabled("delegation"), true);
  assert.equal(resolveSettingsSection("delegation"), "delegation");
});

test("collaboration labels and disabled guidance point to the independent settings entry", () => {
  assert.equal(zhCN["delegation.settingsTitle"], "多智能体协同");
  assert.match(zhCN["delegation.disabled"], /设置.*多智能体协同/);
  assert.doesNotMatch(zhCN["delegation.disabled"], /SDK/);
  assert.equal(enUS["delegation.settingsTitle"], "Multi-agent collaboration");
  assert.match(enUS["delegation.disabled"], /Settings.*Multi-agent collaboration/);
  assert.doesNotMatch(enUS["delegation.disabled"], /SDK/);
});
