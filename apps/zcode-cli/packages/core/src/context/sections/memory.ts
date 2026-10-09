// ============================================================
// Memory Section Builder
// ============================================================

import { buildProjectMemoryInstructions } from "@zcode/shared/node";
import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

export function buildMemorySection(memoryRoot: string | undefined): ContextSection | null {
  if (!memoryRoot) return null;

  const content = buildProjectMemoryInstructions(memoryRoot);

  return {
    name: "Memory",
    source: "memory",
    injectionTarget: "system",
    cacheHint: "dynamic",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
