import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveProjectMemoryRoot as sharedRoot,
  buildProjectMemoryInstructions,
} from "@zcode/shared/node";
import { resolveProjectMemoryRoot } from "../src/memory/project-root.js";
import { buildMemorySection } from "../src/context/sections/memory.js";
import { resolveEnabledProjectMemoryRoot } from "../src/runtime/helpers/project-memory.js";
import type { AgentRuntimeConfig } from "../src/runtime/types.js";

test("API context and ACP share path and instructions without changing runtime gating", () => {
  const input = {
    cliStorageRoot: "store",
    workspacePath: "fixture",
    workspaceIdentity: "fixture:a",
  };
  const root = sharedRoot(input);
  assert.equal(resolveProjectMemoryRoot(input), root);
  assert.equal(buildMemorySection(root)?.content, buildProjectMemoryInstructions(root));
  assert.equal(buildMemorySection(undefined), null);
  const config = {
    memory: {
      enabled: true,
      cliStorageRoot: input.cliStorageRoot,
      workspaceIdentity: input.workspaceIdentity,
    },
  } as AgentRuntimeConfig;
  assert.equal(resolveEnabledProjectMemoryRoot(config, input.workspacePath), root);
  assert.equal(
    resolveEnabledProjectMemoryRoot(
      { ...config, memory: { ...config.memory!, use: false } },
      input.workspacePath,
    ),
    undefined,
  );
  assert.equal(
    resolveEnabledProjectMemoryRoot(
      { ...config, memory: { ...config.memory!, enabled: false } },
      input.workspacePath,
    ),
    undefined,
  );
});
