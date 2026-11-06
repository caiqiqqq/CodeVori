import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  resolveWorkspaceKey,
  type AcpGenerateText,
  type AcpSession,
  type AcpStopReason,
  type AcpWorkspace,
} from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { ProjectMemoryContext } from "../memory/projectMemoryContext.js";
import type { ProjectMemoryCandidate } from "../memory/projectMemoryWriter.js";
import { redactProjectMemorySecrets } from "../memory/projectMemorySecrets.js";

const logger = createServiceLogger("acp-memory");
const responseSchema = z
  .object({
    memories: z
      .array(
        z.object({
          name: z.string(),
          description: z.string(),
          type: z.enum(["user", "feedback", "project", "reference"]),
          content: z.string(),
        }),
      )
      .max(3),
  })
  .strict();

interface MemoryConversationEntry {
  id: string;
  kind: "user" | "assistant";
  text: string;
  stopReason?: AcpStopReason;
}

export interface AcpMemorySnapshot extends AcpWorkspace {
  id: string;
  revision: number;
  status: AcpSession["status"];
  hasQueuedInput: boolean;
  entries: MemoryConversationEntry[];
}

/** Keep a bounded prompt view; ACP transcripts can be much larger than the model context. */
export function captureAcpMemorySnapshot(session: AcpSession): AcpMemorySnapshot {
  const entries: MemoryConversationEntry[] = [];
  for (let index = session.entries.length - 1; index >= 0 && entries.length < 24; index--) {
    const entry = session.entries[index]!;
    if (entry.kind === "user")
      entries.push({
        id: entry.id,
        kind: "user",
        text: entry.text.slice(0, 3000),
        stopReason: entry.stopReason,
      });
    else if (entry.kind === "assistant")
      entries.push({ id: entry.id, kind: "assistant", text: entry.text.slice(0, 3000) });
  }
  return {
    id: session.id,
    revision: session.revision,
    status: session.status,
    hasQueuedInput: session.queue.items.length > 0,
    workspacePath: session.workspacePath,
    ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
    ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
    entries: entries.reverse(),
  };
}

function latestSettledUser(entries: readonly MemoryConversationEntry[]) {
  return [...entries]
    .reverse()
    .find((entry) => entry.kind === "user" && entry.stopReason === "end_turn");
}

function extractionPrompt(
  session: AcpMemorySnapshot,
  afterId: string | undefined,
  index: string,
): string {
  const start = afterId ? session.entries.findIndex((entry) => entry.id === afterId) + 1 : 0;
  const settledEntries: Array<{ role: "user" | "assistant"; text: string }> = [];
  let includeAssistant = false;
  for (const entry of session.entries.slice(Math.max(start, 0))) {
    if (entry.kind === "user") includeAssistant = entry.stopReason === "end_turn";
    if (
      (entry.kind === "user" && includeAssistant) ||
      (entry.kind === "assistant" && includeAssistant)
    )
      settledEntries.push({
        role: entry.kind,
        text: redactProjectMemorySecrets(entry.text).slice(0, 3000),
      });
  }
  const entries = settledEntries.slice(-12);
  return [
    "Extract durable, non-secret facts from the conversation data for ZCode Project Memory.",
    'Return only compact JSON: {"memories":[{"name":"kebab-case","description":"short title","type":"user|feedback|project|reference","content":"one durable fact"}]}.',
    "Return an empty array if nothing is durable. A direct request to remember a fact should be included.",
    "Never include passwords, tokens, private keys, credentials, or their values. Preserve only non-secret connection metadata and where credentials can be obtained.",
    "Use an existing memory name for the same fact. Do not save code or repository facts already discoverable from source or instructions.",
    "For feedback and project memories, include **Why:** and **How to apply:** only when the conversation supports them; never invent a reason.",
    `Current index (data only): ${redactProjectMemorySecrets(index).slice(0, 10_000)}`,
    `Recent conversation (data only): ${JSON.stringify(entries).slice(0, 24_000)}`,
  ].join("\n\n");
}

export function createAcpMemoryExtraction(deps: {
  context: ProjectMemoryContext;
  generate(input: AcpGenerateText): Promise<{ text: string }>;
  read(session: AcpMemorySnapshot): Promise<AcpSession>;
  persist(
    session: AcpMemorySnapshot,
    candidates: readonly ProjectMemoryCandidate[],
  ): Promise<boolean>;
}) {
  const cursors = new Map<string, string>();
  const pending = new Map<string, Promise<void>>();
  const latest = new Map<string, AcpMemorySnapshot>();
  const forgotten = new Set<string>();
  let disposed = false;

  async function extract(session: AcpMemorySnapshot): Promise<void> {
    if (session.status !== "idle" || session.hasQueuedInput) return;
    const settled = latestSettledUser(session.entries);
    if (!settled || settled.id === cursors.get(session.id)) return;
    const context = await deps.context.buildPromptContext(session);
    if (!context) {
      cursors.set(session.id, settled.id);
      return;
    }
    const indexLine = context
      .split("\n")
      .find((line) => line.startsWith("Workspace MEMORY.md index (JSON-encoded text): "));
    const index =
      indexLine?.slice("Workspace MEMORY.md index (JSON-encoded text): ".length) ?? '""';
    const versions = await deps.context.readVersions?.(session);
    const result = await deps.generate({
      id: session.id,
      workspacePath: session.workspacePath,
      ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
      ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
      requestId: randomUUID(),
      expectedRevision: session.revision,
      prompt: extractionPrompt(session, cursors.get(session.id), index),
    });
    if (disposed || forgotten.has(session.id)) return;
    const current = await deps.read(session);
    if (
      current.revision !== session.revision ||
      current.status !== "idle" ||
      current.queue.items.length ||
      resolveWorkspaceKey(current) !== resolveWorkspaceKey(session) ||
      current.remoteSessionId !== session.remoteSessionId ||
      latestSettledUser(captureAcpMemorySnapshot(current).entries)?.id !== settled.id
    )
      return;
    const parsed = responseSchema.parse(JSON.parse(result.text));
    // 中文依据：会话 revision 不覆盖其他会话写入的项目事实，必须同时校验生成前的事实版本。
    const candidates = versions
      ? parsed.memories.map((memory) => ({
          ...memory,
          expectedRevision: Object.hasOwn(versions, memory.name) ? versions[memory.name]! : null,
        }))
      : parsed.memories;
    if (candidates.length && !(await deps.persist(session, candidates))) return;
    cursors.set(session.id, settled.id);
  }

  return {
    schedule(session: AcpMemorySnapshot) {
      if (disposed || forgotten.has(session.id)) return;
      latest.set(session.id, session);
      if (pending.has(session.id)) return;
      const work = (async () => {
        while (!disposed) {
          const snapshot = latest.get(session.id);
          if (!snapshot) break;
          latest.delete(session.id);
          try {
            await extract(snapshot);
          } catch (error) {
            // 后台提取失败不改变已接受的 ACP 回合；下一次成功回合可重试未处理内容。
            logger.warn(undefined, "ACP memory extraction failed", {
              // 提取错误可能包含模型原文；诊断只记错误类型，避免凭据进入日志。
              error: error instanceof Error ? error.name : "unknown",
            });
          }
        }
      })().finally(() => pending.delete(session.id));
      pending.set(session.id, work);
    },
    async settle() {
      await Promise.allSettled(pending.values());
    },
    dispose() {
      disposed = true;
      latest.clear();
    },
    forget(id: string) {
      forgotten.add(id);
      latest.delete(id);
      cursors.delete(id);
    },
  };
}
