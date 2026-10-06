import assert from "node:assert/strict";
import test from "node:test";
import { isSettingsSectionEnabled, resolveSettingsSection } from "../src/lib/settingsNavigation.js";
import {
  createSettingsPageConfig,
  resolveSettingsSectionForPlatform,
  SETTINGS_SECTIONS,
} from "../src/settings/settingsPageConfig.js";

test("computer control navigation remains reachable before the plugin is enabled", () => {
  assert.equal(isSettingsSectionEnabled("computerUse"), true);
  assert.equal(resolveSettingsSection("computerUse"), "computerUse");
});

test("desktop settings place computer control after browser control", () => {
  for (const options of [{ isDesktop: true }, { isMacDesktop: true }, { isWindowsDesktop: true }]) {
    const { settingsSections, settingsSectionGroups } = createSettingsPageConfig(options);
    const ids = settingsSections.map((section) => section.id);
    assert.equal(ids.indexOf("computerUse"), ids.indexOf("browser") + 1);
    assert.ok(
      settingsSectionGroups
        .find((group) => group.id === "basics")
        ?.sections.some((section) => section.id === "computerUse"),
    );
    assert.equal(resolveSettingsSectionForPlatform("computerUse", settingsSections), "computerUse");
  }
});

test("web settings do not expose local computer control and reject a direct target", () => {
  const { settingsSections } = createSettingsPageConfig();
  for (const sections of [settingsSections, SETTINGS_SECTIONS]) {
    assert.equal(
      sections.some((section) => section.id === "computerUse"),
      false,
    );
    assert.equal(resolveSettingsSectionForPlatform("computerUse", sections), "general");
  }
});

test("restoring computer control does not restore unrelated hidden sections", () => {
  const { settingsSections } = createSettingsPageConfig({ isDesktop: true });
  for (const section of ["automations", "workspaceFileSearch"] as const) {
    assert.equal(isSettingsSectionEnabled(section), false);
    assert.equal(
      settingsSections.some((candidate) => candidate.id === section),
      false,
    );
  }
});
