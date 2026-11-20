import assert from "node:assert/strict";
import test from "node:test";
import { DELEGATION_MAIN_AGENT_INSTRUCTION } from "@zcode/shared";
import { createContextBuilder } from "../src/context/builder.js";

const base = {
  workingDirectory: "/workspace",
  envInfo: {
    cwd: "/workspace",
    platform: "linux",
    shell: "/bin/sh",
    osVersion: "test",
    nodeVersion: "24",
  },
};

test("Host delegation guidance appears in the main API system context only when provisioned", () => {
  const withCapability = createContextBuilder({
    ...base,
    hostCapabilityGuidance: DELEGATION_MAIN_AGENT_INSTRUCTION,
  }).build();
  const withoutCapability = createContextBuilder(base).build();
  const guidance = withCapability.sections.filter((section) => section.name === "Host Capability Guidance");
  assert.equal(guidance.length, 1);
  assert.equal(guidance[0]?.injectionTarget, "system");
  assert.equal(guidance[0]?.content, DELEGATION_MAIN_AGENT_INSTRUCTION);
  assert.equal(withoutCapability.sections.some((section) => section.name === "Host Capability Guidance"), false);
});

test("Host main-agent guidance is absent from workflow actor context", () => {
  const result = createContextBuilder({
    ...base,
    hostCapabilityGuidance: DELEGATION_MAIN_AGENT_INSTRUCTION,
    workflowActor: { name: "child" },
  }).build();
  assert.equal(result.sections.some((section) => section.name === "Host Capability Guidance"), false);
});
