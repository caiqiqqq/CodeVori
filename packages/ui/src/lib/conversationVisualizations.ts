import { isAbsoluteFilePath, joinFilePath } from "@zcode/shared";
import { findMarkdownCodeRanges, overlapsAssistantTextRanges } from "./assistantDirectiveParser.js";

export interface ConversationVisualizationReference {
  path: string;
  mode: "normal" | "wide";
  title?: string;
}

export type ConversationVisualizationBlock =
  | { kind: "markdown"; text: string; start: number }
  | {
      kind: "visualization";
      reference: ConversationVisualizationReference;
      start: number;
      end: number;
    };

const PREFIX = "\uE200visualize\uE202";
const END = "\uE201";

function validHtmlPath(path: string): boolean {
  for (const character of path) if (character.charCodeAt(0) < 32) return false;
  return (
    Boolean(path.trim()) &&
    !path.replaceAll("\\", "/").split("/").includes("..") &&
    !(/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) &&
    /\.html?$/i.test(path)
  );
}

function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

/** 同一规则同时校验引用路径和 Host realpath，阻止前缀相近目录及符号链接越界。 */
export function resolveVisualizationFilePath(workspacePath: string, path: string): string | null {
  if (!isAbsoluteFilePath(workspacePath) || !validHtmlPath(path)) return null;
  const absolutePath = isAbsoluteFilePath(path) ? path : joinFilePath(workspacePath, path);
  const root = normalizePath(workspacePath);
  return normalizePath(absolutePath).startsWith(`${root}/`) ? absolutePath : null;
}

function parseReference(source: string): ConversationVisualizationReference | null {
  try {
    const value: unknown = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.path !== "string" || !validHtmlPath(candidate.path)) return null;
    if (candidate.mode !== undefined && candidate.mode !== "normal" && candidate.mode !== "wide")
      return null;
    if (candidate.title !== undefined && typeof candidate.title !== "string") return null;
    return {
      path: candidate.path,
      mode: candidate.mode === "wide" ? "wide" : "normal",
      ...(typeof candidate.title === "string" ? { title: candidate.title } : {}),
    };
  } catch {
    return null;
  }
}

export function projectConversationVisualizations(
  content: string,
  streaming: boolean,
): ConversationVisualizationBlock[] {
  if (!content.includes(PREFIX[0]!)) return [{ kind: "markdown", text: content, start: 0 }];
  const protectedRanges = findMarkdownCodeRanges(content);
  const blocks: ConversationVisualizationBlock[] = [];
  let cursor = 0;
  let searchFrom = 0;
  for (;;) {
    const start = content.indexOf(PREFIX[0]!, searchFrom);
    if (start < 0) break;
    searchFrom = start + 1;
    const lineStart = content.lastIndexOf("\n", start - 1) + 1;
    const indentation = content.slice(lineStart, start);
    if (
      indentation.trim() ||
      indentation.length >= 4 ||
      indentation.includes("\t") ||
      overlapsAssistantTextRanges(start, start + 1, protectedRanges)
    )
      continue;
    const tail = content.slice(start);
    // 修复原因：ACP/API 都逐块输出私有标记；半截引用不能泄露 JSON 或提前执行文件。
    if (
      streaming &&
      (PREFIX.startsWith(tail) || (tail.startsWith(PREFIX) && !tail.includes(END)))
    ) {
      if (start > cursor)
        blocks.push({ kind: "markdown", text: content.slice(cursor, start), start: cursor });
      return blocks;
    }
    if (!tail.startsWith(PREFIX)) continue;
    const closing = content.indexOf(END, start + PREFIX.length);
    if (closing < 0) continue;
    const end = closing + END.length;
    const newline = content.indexOf("\n", end);
    if (content.slice(end, newline < 0 ? content.length : newline).trim()) continue;
    const reference = parseReference(content.slice(start + PREFIX.length, closing));
    if (!reference) continue;
    if (start > cursor)
      blocks.push({ kind: "markdown", text: content.slice(cursor, start), start: cursor });
    blocks.push({ kind: "visualization", reference, start, end });
    cursor = end;
    searchFrom = end;
  }
  if (cursor < content.length || blocks.length === 0)
    blocks.push({ kind: "markdown", text: content.slice(cursor), start: cursor });
  return blocks;
}
