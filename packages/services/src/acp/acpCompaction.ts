import type { AcpEntry, AcpSession } from "@zcode/shared";
import type { CompactionUpdate, ToolCallUpdate } from "@agentclientprotocol/sdk";
import { finishAcpThoughts } from "./acpConversationEntries.js";

type Compaction = Extract<AcpEntry, { kind: "compaction" }>;
const MAX_TEXT = 32_000;
export type AcpCompactionUpdate =
  | {
      kind: "compaction";
      id: string;
      status?: Compaction["status"];
      origin?: Compaction["origin"] | null;
      tokensBefore?: number | null;
      tokensAfter?: number | null;
      summary?: string | null;
      error?: string | null;
    }
  | { kind: "compaction_summary"; id: string; text: string };

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function status(value: string): Compaction["status"] {
  switch (value) {
    case "completed":
    case "success":
      return "success";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      // 修复原因：扩展状态不代表压缩成功；只接受明确终态，其余等待确认或中断。
      return "running";
  }
}

function facts(meta: Record<string, unknown> | undefined) {
  const trigger = meta?.trigger ?? meta?.origin;
  const origin =
    trigger === "auto" ? "auto" : trigger === "manual" || trigger === "user" ? "manual" : undefined;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  const tokensBefore = count(meta?.preTokens ?? meta?.tokensBefore);
  const tokensAfter = count(meta?.postTokens ?? meta?.tokensAfter);
  return {
    ...(origin ? { origin: origin as Compaction["origin"] } : {}),
    ...(tokensBefore !== undefined ? { tokensBefore } : {}),
    ...(tokensAfter !== undefined ? { tokensAfter } : {}),
  };
}

export function projectTypedCompaction(update: CompactionUpdate): AcpCompactionUpdate {
  const meta = update._meta;
  const projected = facts(object(meta?.contextCompaction) ?? meta ?? undefined);
  return {
    kind: "compaction",
    id: update.compactionId,
    status: status(update.status),
    ...(meta !== undefined
      ? {
          origin: projected.origin ?? null,
          tokensBefore: projected.tokensBefore ?? null,
          tokensAfter: projected.tokensAfter ?? null,
        }
      : {}),
    ...(update.summary !== undefined && (update.status === "completed" || !update.summary?.length)
      ? {
          summary:
            update.summary
              ?.flatMap((part) => (part.type === "text" ? [part.text] : []))
              .join("\n")
              .slice(0, MAX_TEXT) ?? null,
        }
      : {}),
    ...(update.error !== undefined ? { error: update.error?.slice(0, MAX_TEXT) ?? null } : {}),
  };
}

export function projectLegacyCompaction(
  update: ToolCallUpdate,
  recognized = false,
): AcpCompactionUpdate | undefined {
  const air = object(object(update._meta?.jetbrains)?.air);
  // 错误能力协商启用 AIR 后，旧适配器的压缩元数据也可能进入版本化 AIR 命名空间。
  const raw =
    update._meta?.contextCompaction ??
    (typeof air?.version === "number" && Number.isInteger(air.version) && air.version >= 1
      ? air.contextCompaction
      : undefined);
  const meta = object(raw);
  const version = meta?.version;
  const explicit =
    raw === true || (typeof version === "number" && Number.isInteger(version) && version >= 1);
  if (!explicit && !recognized) return undefined;
  return {
    kind: "compaction",
    id: update.toolCallId,
    ...(update.status ? { status: status(update.status) } : {}),
    ...facts(raw === true ? (update._meta ?? undefined) : meta),
    ...(typeof meta?.error === "string" ? { error: meta.error.slice(0, MAX_TEXT) } : {}),
  };
}

export function applyAcpCompaction(
  session: Pick<AcpSession, "entries">,
  commandId: string,
  update: AcpCompactionUpdate,
  receivedAt: number,
): void {
  const id = `compaction:${commandId}:${update.id}`;
  const index = session.entries.findIndex(
    (entry) => entry.id === id || entry.id === `tool:${commandId}:${update.id}`,
  );
  const previous = session.entries[index];
  if (update.kind === "compaction_summary") {
    if (previous?.kind === "compaction" && previous.status === "running")
      previous.summary = ((previous.summary ?? "") + update.text.slice(0, MAX_TEXT)).slice(
        0,
        MAX_TEXT,
      );
    return;
  }
  // 修复原因：压缩完成后迟到的 started/chunk 不能重开记录或覆盖已确认终态。
  if (
    previous?.kind === "compaction" &&
    previous.status !== "running" &&
    update.status !== undefined &&
    update.status !== previous.status
  )
    return;
  const entry: Compaction =
    previous?.kind === "compaction"
      ? previous
      : {
          id,
          kind: "compaction",
          status: "running",
          createdAt: previous?.createdAt ?? receivedAt,
        };
  if (update.status !== undefined) entry.status = update.status;
  for (const key of ["origin", "tokensBefore", "tokensAfter", "summary", "error"] as const) {
    if (update[key] === null) delete entry[key];
    else if (update[key] !== undefined)
      Object.assign(entry, {
        [key]: typeof update[key] === "string" ? update[key].slice(0, MAX_TEXT) : update[key],
      });
  }
  if (entry.status !== "failed") delete entry.error;
  if (previous?.kind !== "compaction") {
    finishAcpThoughts(session, "complete", receivedAt);
    if (index < 0) session.entries.push(entry);
    else session.entries[index] = entry;
  }
}

export function interruptAcpCompactions(session: Pick<AcpSession, "entries">): void {
  for (const entry of session.entries) {
    if (entry.kind === "compaction" && entry.status === "running") entry.status = "cancelled";
  }
}
