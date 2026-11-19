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

test("agents and squads share one entry in agent capabilities on desktop and web", () => {
  for (const options of [
    {},
    { isDesktop: true },
    { isMacDesktop: true },
    { isWindowsDesktop: true },
  ]) {
    const { settingsSections, settingsSectionGroups } = createSettingsPageConfig(options);
    const entries = settingsSections.filter((section) => section.id === "subagents");
    assert.equal(entries.length, 1);
    assert.equal(settingsSections.some((section) => section.id === "delegation"), false);
    assert.equal(entries[0].titleId, "settings.agentsAndSquads.title");
    assert.ok(
      settingsSectionGroups
        .find((group) => group.id === "agentCapabilities")
        ?.sections.some((section) => section.id === "subagents"),
    );
    assert.equal(resolveSettingsSectionForPlatform("delegation", settingsSections), "subagents");
    assert.equal(resolveSettingsSectionForPlatform("subagents", settingsSections), "subagents");
    assert.equal(resolveSettingsSectionForPlatform("acpAgents", settingsSections), "acpAgents");
  }
  assert.equal(SETTINGS_SECTIONS.filter((section) => section.id === "subagents").length, 1);
  assert.equal(isSettingsSectionEnabled("delegation"), true);
  assert.equal(resolveSettingsSection("delegation"), "subagents");
});

test("collaboration labels remain available inside the merged settings entry", () => {
  assert.equal(zhCN["settings.agentsAndSquads.title"], "智能体与小队");
  assert.equal(zhCN["delegation.settingsTitle"], "多智能体协同");
  assert.match(zhCN["delegation.disabled"], /设置.*智能体与小队.*多智能体协同/);
  assert.doesNotMatch(zhCN["delegation.disabled"], /SDK/);
  assert.equal(enUS["delegation.settingsTitle"], "Multi-agent collaboration");
  assert.match(enUS["delegation.disabled"], /Settings.*Agents & Squads.*Multi-agent collaboration/);
  assert.doesNotMatch(enUS["delegation.disabled"], /SDK/);
});
