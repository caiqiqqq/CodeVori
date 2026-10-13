import { linkedRepositoriesSchema, type LinkedRepository } from "@zcode/shared";

const START = "<zcode-linked-repositories>";
const END = "</zcode-linked-repositories>";
const GUIDANCE =
  "Related repositories selected for this conversation. Use each executionPath for file changes, tests and Git commands. sourcePath identifies the original directory; do not modify it when executionPath differs. Manage commits and merges separately per repository. This directory guidance does not grant additional filesystem permissions.";

export function buildPromptWithLinkedRepositories(
  text: string,
  repositories: readonly LinkedRepository[],
): string {
  if (!repositories.length || text.trimStart().startsWith("/")) return text;
  if (repositories.some((row) => !row.prepared))
    throw new Error("Linked repositories must be prepared before sending");
  // JSON 转义尖括号，避免合法目录名提前关闭上下文块。
  const data = JSON.stringify(repositories).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
  return `${text}\n\n${START}\n${GUIDANCE}\n${data}\n${END}`;
}

export function parsePromptLinkedRepositories(content: string): {
  visibleContent: string;
  repositories: LinkedRepository[];
} {
  const start = content.lastIndexOf(`\n\n${START}\n`);
  if (start < 0 || !content.endsWith(`\n${END}`))
    return { visibleContent: content, repositories: [] };
  const block = content.slice(start + 2 + START.length + 1, -END.length - 1);
  if (!block.startsWith(`${GUIDANCE}\n`)) return { visibleContent: content, repositories: [] };
  try {
    const parsed = linkedRepositoriesSchema.safeParse(JSON.parse(block.slice(GUIDANCE.length + 1)));
    if (!parsed.success || parsed.data.some((row) => !row.prepared))
      return { visibleContent: content, repositories: [] };
    return { visibleContent: content.slice(0, start), repositories: parsed.data };
  } catch {
    return { visibleContent: content, repositories: [] };
  }
}
