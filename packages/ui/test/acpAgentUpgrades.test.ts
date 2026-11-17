import assert from "node:assert/strict";
import test from "node:test";
import type { AcpAgentInfo } from "@zcode/shared";
import { getAcpAgentUpgradePlan } from "../src/settings/acpAgentUpgrades.ts";

const installed: AcpAgentInfo = {
  agent: "gemini",
  command: "gemini",
  args: [],
  distribution: "npm",
  registryVersion: "2.0.0",
  installedVersion: "1.0.0",
  managedVersion: "1.0.0",
  enabled: true,
  env: {},
  source: "managed",
  ready: true,
  executablePath: "/fake/gemini",
  nativeCommand: "gemini",
  nativePath: null,
  nodeVersion: "24.22.1",
  npmVersion: "10.9.2",
  nodeVersionCompatible: true,
  platformSupported: true,
  updateCheck: { status: "checked", source: "acp-registry", checkedAt: null },
};

test("upgrade plans distinguish managed upgrades from system adoption without changing enablement", () => {
  const plan = getAcpAgentUpgradePlan([
    installed,
    { ...installed, agent: "codex", enabled: false, source: "system", managedVersion: null },
  ]);
  assert.deepEqual(
    plan.map(({ agent, action, expectedVersion }) => ({ agent, action, expectedVersion })),
    [
      { agent: "gemini", action: "upgrade", expectedVersion: "2.0.0" },
      { agent: "codex", action: "install", expectedVersion: "2.0.0" },
    ],
  );
});

test("only confirmed upgrades with a usable target environment are included", () => {
  const excluded: Partial<AcpAgentInfo>[] = [
    { updateCheck: { ...installed.updateCheck!, status: "unchecked" } },
    { updateCheck: { ...installed.updateCheck!, status: "error" } },
    { installedVersion: null, source: "missing", managedVersion: null },
    { installedVersion: "unknown" },
    { installedVersion: "2.0.0" },
    { installedVersion: "3.0.0" },
    { managedVersion: "3.0.0" },
    { platformSupported: false },
    { nodeVersion: null },
    { npmVersion: null },
    { nodeVersionCompatible: false },
  ];
  for (const override of excluded) {
    assert.deepEqual(
      getAcpAgentUpgradePlan([{ ...installed, ...override }]),
      [],
      JSON.stringify(override),
    );
  }
  assert.equal(
    getAcpAgentUpgradePlan([
      { ...installed, distribution: "binary", nodeVersion: null, npmVersion: null },
    ]).length,
    1,
  );
});
