import type { IFileService } from "@zcode/services";
import { resolveVisualizationFilePath } from "@/lib/conversationVisualizations.js";

export const VISUALIZATION_MAX_BYTES = 1_000_000;

export async function readConversationVisualization(
  files: Pick<IFileService, "resolvePath" | "stat" | "readFileRange">,
  workspacePath: string,
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const absolutePath = resolveVisualizationFilePath(workspacePath, path);
  if (!absolutePath) throw new Error("Invalid visualization path");
  signal?.throwIfAborted();
  const [canonicalRoot, canonicalPath] = await Promise.all([
    files.resolvePath({ path: workspacePath }),
    files.resolvePath({ path: absolutePath }),
  ]);
  signal?.throwIfAborted();
  if (!resolveVisualizationFilePath(canonicalRoot, canonicalPath))
    throw new Error("Visualization outside workspace");
  const stat = await files.stat({ path: canonicalPath });
  signal?.throwIfAborted();
  if (
    stat.type !== "file" ||
    (stat.size !== undefined && (stat.size <= 0 || stat.size > VISUALIZATION_MAX_BYTES))
  )
    throw new Error("Invalid visualization size");
  const bytes = await files.readFileRange({
    path: canonicalPath,
    offset: 0,
    length: VISUALIZATION_MAX_BYTES + 1,
  });
  signal?.throwIfAborted();
  if (
    !bytes.length ||
    bytes.length > VISUALIZATION_MAX_BYTES ||
    (stat.size !== undefined && bytes.length !== stat.size)
  )
    throw new Error("Incomplete visualization file");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
