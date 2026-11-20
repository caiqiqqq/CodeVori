import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeInitialSettingsSection,
  consumePendingAgentSettingsView,
  isSettingsSectionEnabled,
  resolveSettingsSection,
  setPendingSettingsSectionIntent,
} from "../src/lib/settingsNavigation.js";
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

test("agent profiles and squads share one settings entry with legacy squad routing", () => {
  const { settingsSections } = createSettingsPageConfig();
  assert.equal(settingsSections.filter((section) => section.id === "agentProfiles").length, 1);
  assert.equal(settingsSections.some((section) => section.id === "squads"), false);
  assert.equal(settingsSections.some((section) => section.id === "subagents"), true);
  assert.equal(resolveSettingsSection("squads"), "agentProfiles");
  assert.equal(resolveSettingsSectionForPlatform("squads", settingsSections), "agentProfiles");

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
    setPendingSettingsSectionIntent("squads");
    assert.equal(consumeInitialSettingsSection(), "agentProfiles");
    assert.equal(consumePendingAgentSettingsView(), "squads");
    setPendingSettingsSectionIntent("agentProfiles");
    assert.equal(consumeInitialSettingsSection(), "agentProfiles");
    assert.equal(consumePendingAgentSettingsView(), "agents");
    assert.equal(resolveSettingsSection("delegation"), "general");
  } finally {
    globalThis.window = previous;
  }
});
