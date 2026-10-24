import assert from "node:assert/strict";
import test from "node:test";
import {
  createSettingsPageConfig,
  resolveSettingsSectionForPlatform,
  SETTINGS_SECTIONS,
} from "../src/settings/settingsPageConfig.js";
import { resolveSettingsSection } from "../src/lib/settingsNavigation.js";
import { deviceBridgeCommandSchema } from "@zcode/shared";

test("devices settings requires desktop native capability and supports navigation intents", () => {
  for (const options of [{}, { isDesktop: true }, { supportsDeviceBridge: true }]) {
    const { settingsSections } = createSettingsPageConfig(options);
    assert.equal(
      settingsSections.some((s) => s.id === "devices"),
      false,
    );
    assert.equal(resolveSettingsSectionForPlatform("devices", settingsSections), "general");
  }
  for (const platform of [
    { isDesktop: true },
    { isMacDesktop: true },
    { isWindowsDesktop: true },
  ]) {
    const config = createSettingsPageConfig({ ...platform, supportsDeviceBridge: true });
    assert.equal(
      config.settingsSectionGroups
        .find((g) => g.id === "basics")!
        .sections.filter((s) => s.id === "devices").length,
      1,
    );
    assert.equal(resolveSettingsSection("devices"), "devices");
  }
  assert.equal(
    SETTINGS_SECTIONS.some((s) => s.id === "devices"),
    false,
  );
});

test("device commands reject executable arguments and arbitrary login destinations", () => {
  assert.equal(
    deviceBridgeCommandSchema.safeParse({ action: "connect", nodeId: "peer" }).success,
    true,
  );
  for (const value of [
    { action: "connect", nodeId: "" },
    { action: "open-login", url: "https://evil.example" },
    { action: "configure", binaryPath: "/bin/bridge", args: ["shell"] },
  ])
    assert.equal(deviceBridgeCommandSchema.safeParse(value).success, false);
});

test("management commands accept only bounded credentials and a stable node ID", () => {
  for (const value of [
    { action: "configure-management", apiKey: "tskey-api-synthetic" },
    { action: "clear-management" },
    { action: "remove", nodeId: "n123CNTRL" },
  ])
    assert.equal(deviceBridgeCommandSchema.safeParse(value).success, true);
  for (const value of [
    { action: "configure-management", apiKey: "" },
    { action: "configure-management", apiKey: "a:b" },
    { action: "configure-management", apiKey: "key\r\nheader" },
    { action: "configure-management", apiKey: "a".repeat(4097) },
    { action: "remove", nodeId: "../other" },
    { action: "remove", nodeId: "id", url: "https://evil.test" },
  ])
    assert.equal(deviceBridgeCommandSchema.safeParse(value).success, false);
});
