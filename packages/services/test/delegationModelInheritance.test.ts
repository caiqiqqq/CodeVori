import assert from "node:assert/strict";
import test from "node:test";
import type { AcpAgentConfigSnapshot, AcpSession, WorkTaskExecution } from "@zcode/shared";
import {
  readDelegationAcpModelSelection,
  resolveDelegationAcpExecution,
} from "../src/delegation/delegationModelInheritance.js";

const modelOption = (id: string, currentValue: string, values: string[]) => ({
  id,
  name: "Model",
  category: "model",
  type: "select" as const,
  currentValue,
  options: values.map((value) => ({ value, name: value })),
});

const parent = {
  agent: "codex",
  configOptions: [
    { id: "reasoning", name: "Reasoning", type: "boolean", currentValue: true },
    modelOption("model", "gpt-6-sol", ["gpt-6-sol", "gpt-6-fast"]),
  ],
} as AcpSession;

const execution: Extract<WorkTaskExecution, { kind: "acp" }> = {
  kind: "acp",
  agent: "claude",
  config: [],
};

function target(configOptions: AcpAgentConfigSnapshot["configOptions"]): AcpAgentConfigSnapshot {
  return { agent: "claude", source: "host", configOptions, modeState: null };
}

test("ACP delegation inherits only a model option accepted by the target agent", () => {
  const source = readDelegationAcpModelSelection(parent)!;
  assert.deepEqual(source, { agent: "codex", configId: "model", value: "gpt-6-sol" });

  const resolved = resolveDelegationAcpExecution(
    execution,
    source,
    undefined,
    target([modelOption("model", "claude-sonnet", ["claude-sonnet", "gpt-6-sol"])]),
  );
  assert.deepEqual(resolved.config, [{ configId: "model", value: "gpt-6-sol" }]);
  assert.equal(resolved.modelPreference, undefined);
});

test("incompatible or unknown ACP model catalogs use the target Host preference", () => {
  const source = readDelegationAcpModelSelection(parent);
  const incompatible = resolveDelegationAcpExecution(
    execution,
    source,
    { configId: "model", value: "claude-sonnet" },
    target([modelOption("model", "claude-sonnet", ["claude-sonnet"])]),
  );
  assert.deepEqual(incompatible.config, []);
  assert.deepEqual(incompatible.modelPreference, { configId: "model", value: "claude-sonnet" });

  const unknown = resolveDelegationAcpExecution(
    execution,
    source,
    { configId: "model", value: "claude-sonnet" },
    undefined,
  );
  assert.deepEqual(unknown.modelPreference, { configId: "model", value: "claude-sonnet" });
});

test("an explicit target model config is preserved", () => {
  const explicit = {
    ...execution,
    config: [{ configId: "model", value: "claude-sonnet" }],
  };
  const resolved = resolveDelegationAcpExecution(
    explicit,
    readDelegationAcpModelSelection(parent),
    { configId: "model", value: "claude-sonnet" },
    target([modelOption("model", "claude-sonnet", ["claude-sonnet", "gpt-6-sol"])]),
  );
  assert.deepEqual(resolved.config, explicit.config);
  assert.equal(resolved.modelPreference, undefined);
});
