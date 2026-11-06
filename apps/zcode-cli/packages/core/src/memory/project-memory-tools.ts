import { projectMemoryTools } from "@zcode/shared";
import { openProjectMemoryStore, type ProjectMemoryRootInput } from "@zcode/shared/node";
import type { ToolEntry } from "../tool/types.js";

export function createProjectMemoryToolEntries(
  resolveScope: () => ProjectMemoryRootInput,
): ToolEntry[] {
  return projectMemoryTools.map((tool) => ({
    capability: tool.description,
    metadata: {
      name: tool.name,
      description: tool.description,
      readOnly: tool.name === "ReadProjectMemory",
      allowedInPlanMode: true,
      destructive: false,
      concurrentSafe: false,
      sideEffectScope: tool.name === "ReadProjectMemory" ? "none" : "workspace",
      riskLevel: "low",
      needsApproval: false,
    },
    inputSchema: tool.inputSchema,
    outputSchema: { type: "object" },
    permission: {
      permission: tool.name === "ReadProjectMemory" ? "memory.read" : "memory.write",
      reason: "Session-bound CodeVori project memory",
      riskLevel: "low",
      sideEffectScope: tool.name === "ReadProjectMemory" ? "none" : "workspace",
      needsApproval: false,
      patternSources: ["toolName"],
      alwaysAllowPatternSources: ["toolName"],
      denyPriority: "beforeAsk",
    },
    resultBudget: {
      maxInlineBytes: 30_000,
      maxModelBytes: 30_000,
      strategy: "truncate",
      preview: { maxBytes: 30_000, direction: "head" },
    },
    timeout: { defaultMs: 30_000, maxMs: 30_000, allowCallOverride: false },
    cancellation: {
      supported: false,
      cleanup: "none",
      userVisibleMessage: "Project memory save interrupted; verify the latest revision",
    },
    trace: {
      required: true,
      propagateToAdapters: true,
      recordInput: "summary",
      recordOutput: "summary",
    },
    async handler(input, context) {
      context.abortSignal.throwIfAborted();
      const store = await openProjectMemoryStore({
        ...resolveScope(),
        assertActive: () => context.abortSignal.throwIfAborted(),
      });
      return tool.name === "ReadProjectMemory" ? store.read(input) : store.save(input);
    },
  }));
}
