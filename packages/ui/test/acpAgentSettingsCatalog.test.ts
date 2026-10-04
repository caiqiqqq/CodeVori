import assert from "node:assert/strict";
import test from "node:test";
import {
  ACP_AGENT_SETTINGS_CATALOG,
  compareAcpAdapterVersions,
  isMatchingAcpWorkspaceTab,
  projectAcpAgentChecks,
  shouldOfferManagedAcpInstall,
} from "../src/settings/acpAgentSettingsCatalog.ts";
import type { AcpAgentInfo } from "@zcode/shared";

test("catalog follows all Codeg builtin ACP Agent identities and their executable names", () => {
  assert.deepEqual(
    ACP_AGENT_SETTINGS_CATALOG.map(({ agent, command }) => [agent, command]),
    [
      ["claude", "claude-agent-acp"],
      ["codex", "codex-acp"],
      ["gemini", "gemini"],
      ["openclaw", "openclaw"],
      ["opencode", "opencode"],
      ["cline", "cline"],
      ["hermes", "hermes"],
      ["codebuddy", "codebuddy"],
      ["kimi-code", "kimi"],
      ["pi", "pi-acp"],
      ["grok", "grok"],
      ["cursor", "cursor-agent"],
      ["deepseek", "deepseek-acp"],
      ["qoder", "qoder"],
      ["antigravity", "agy_acp_server"],
    ],
  );
});

test("adapter versions are compared with the fixed release target", () => {
  assert.equal(compareAcpAdapterVersions("1.13.1", "1.10.0"), 1);
  assert.equal(compareAcpAdapterVersions("0.81.1", "0.75.1"), 1);
  assert.equal(compareAcpAdapterVersions("1.9.9", "1.10.0"), -1);
  assert.equal(compareAcpAdapterVersions("1.10.0", "1.10.0"), 0);
  assert.equal(compareAcpAdapterVersions("1.10.0-beta.1", "1.10.0"), -1);
  assert.equal(compareAcpAdapterVersions("1.10.0", "1.10.0-beta.1"), 1);
  assert.equal(compareAcpAdapterVersions("2026.09.02-c22c1a3", "2026.09.26"), -1);
  assert.equal(compareAcpAdapterVersions("2.0.1+build.2", "2.0.1"), 0);
  assert.equal(compareAcpAdapterVersions("2.0.1-beta.10", "2.0.1-beta.2"), 1);
  assert.equal(compareAcpAdapterVersions(null, "1.10.0"), null);
  assert.equal(compareAcpAdapterVersions("unknown", "1.10.0"), null);
});

test("same path with another remote workspace identity cannot supply ACP routing metadata", () => {
  assert.equal(
    isMatchingAcpWorkspaceTab(
      { workspacePath: "/work", workspaceIdentity: "remote:two" },
      "/work",
      "remote:one",
    ),
    false,
  );
  assert.equal(
    isMatchingAcpWorkspaceTab(
      { workspacePath: "/work", workspaceIdentity: " remote:one " },
      "/work",
      "remote:one",
    ),
    true,
  );
  assert.equal(isMatchingAcpWorkspaceTab({ workspacePath: "/work" }, "/work", undefined), true);
});

test("Agent SDK check rows distinguish adapter readiness, install tools, version gaps, and optional vendor CLI", () => {
  const agent: AcpAgentInfo = {
    agent: "codex",
    command: "codex-acp",
    args: [],
    distribution: "npm",
    platformSupported: true,
    packageName: "@agentclientprotocol/codex-acp",
    registryVersion: "1.10.0",
    enabled: true,
    env: {},
    source: "system",
    ready: true,
    installedVersion: "1.13.1",
    managedVersion: null,
    executablePath: "/usr/bin/codex-acp",
    nativeCommand: "codex",
    nativePath: null,
    nodeVersion: null,
    npmVersion: "10.9.2",
  };
  assert.deepEqual(projectAcpAgentChecks(agent), [
    { id: "adapter", status: "pass" },
    { id: "version", status: "pass" },
    { id: "node", status: "warn" },
    { id: "npm", status: "pass" },
    { id: "native", status: "info" },
  ]);
  assert.deepEqual(
    projectAcpAgentChecks({
      ...agent,
      ready: false,
      source: "missing",
      installedVersion: null,
      executablePath: null,
      nodeVersion: "22.17.0",
    }),
    [
      { id: "adapter", status: "fail" },
      { id: "version", status: "fail" },
      { id: "node", status: "pass" },
      { id: "npm", status: "pass" },
      { id: "native", status: "info" },
    ],
  );
  assert.equal(
    projectAcpAgentChecks({ ...agent, source: "managed", managedVersion: "1.13.1" })[1]?.status,
    "pass",
  );
  assert.equal(projectAcpAgentChecks({ ...agent, installedVersion: null })[1]?.status, "warn");
  assert.equal(projectAcpAgentChecks({ ...agent, installedVersion: "1.9.9" })[1]?.status, "warn");
});

test("system ACP adapter at or above the fixed target keeps its version without a managed install", () => {
  const agent: AcpAgentInfo = {
    agent: "codex",
    command: "codex-acp",
    args: [],
    distribution: "npm",
    platformSupported: true,
    packageName: "@agentclientprotocol/codex-acp",
    registryVersion: "1.10.0",
    enabled: true,
    env: {},
    source: "system",
    ready: true,
    installedVersion: "1.13.1",
    managedVersion: null,
    executablePath: "/usr/bin/codex-acp",
    nativeCommand: "codex",
    nativePath: null,
    nodeVersion: "24.14.0",
    npmVersion: "10.33.2",
  };
  assert.equal(shouldOfferManagedAcpInstall(agent), false);
  assert.equal(shouldOfferManagedAcpInstall({ ...agent, installedVersion: "1.10.0" }), false);
  assert.equal(shouldOfferManagedAcpInstall({ ...agent, installedVersion: "1.9.9" }), true);
  assert.equal(shouldOfferManagedAcpInstall({ ...agent, installedVersion: "unknown" }), true);
  assert.equal(shouldOfferManagedAcpInstall({ ...agent, installedVersion: null }), true);
  assert.equal(shouldOfferManagedAcpInstall({ ...agent, source: "missing", ready: false }), true);
  assert.equal(
    shouldOfferManagedAcpInstall({ ...agent, source: "managed", managedVersion: "1.13.1" }),
    false,
  );
  const updated = {
    ...agent,
    registryVersion: "2.0.1",
    updateCheck: { status: "checked", source: "acp-registry", checkedAt: null },
  } as const;
  assert.equal(shouldOfferManagedAcpInstall(updated), true);
  assert.equal(projectAcpAgentChecks(updated)[1]?.status, "warn");
  assert.equal(projectAcpAgentChecks({ ...updated, installedVersion: "2.0.1" })[1]?.status, "pass");
  assert.equal(
    projectAcpAgentChecks({
      ...updated,
      installedVersion: "2.0.1",
      updateCheck: { ...updated.updateCheck, status: "error" },
    })[1]?.status,
    "warn",
  );
});
