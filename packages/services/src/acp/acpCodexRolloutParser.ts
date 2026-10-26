import { createReadStream } from "node:fs";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import type { AcpTokenUsage } from "@zcode/shared";
import type { CodexUsageHistory, HistoryCacheEntry } from "./acpUsageHistoryCheckpoint.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const rawUsage = z.object({
  input_tokens: count,
  output_tokens: count,
  total_tokens: count,
  cached_input_tokens: count.optional(),
});
const MAX_LINE_BYTES = 8 * 1024 * 1024;

export interface ParsedRollout {
  history: CodexUsageHistory;
  cursor: number;
  turnIndex: number | null;
  modelId: string | null;
  turnIncomplete: boolean;
}

export async function parseRollout(
  file: string,
  sessionId: string,
  workspacePath: string,
  size: number,
  cached?: HistoryCacheEntry,
): Promise<ParsedRollout | null> {
  try {
    if (size === 0) return null;
    const workspace = await canonicalPath(workspacePath);
    let matched = Boolean(cached);
    let usage: AcpTokenUsage | null = cached?.history.usage ?? null;
    const history = cached ? structuredClone(cached.history) : null;
    const records: CodexUsageHistory["records"] = history?.records ?? [];
    const turns: CodexUsageHistory["turns"] = history?.turns ?? [];
    let turnIndex: number | null = cached?.turnIndex ?? null;
    let turn = turnIndex === null ? null : turns[turnIndex]!;
    let modelId: string | null = cached?.modelId ?? null;
    let turnIncomplete = cached?.turnIncomplete ?? false;
    let pending = "";
    let cursor = cached?.cursor ?? 0;
    const decoder = new StringDecoder("utf8");
    const stream = createReadStream(file, {
      start: cursor,
      end: size - 1,
      highWaterMark: 64 * 1024,
    });
    try {
      for await (const chunk of stream) {
        pending += decoder.write(chunk);
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          cursor += Buffer.byteLength(line, "utf8") + 1;
          if (line.length > MAX_LINE_BYTES) return null;
          if (!line.trim()) continue;
          const row = JSON.parse(line);
          const time = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
          const timestamp = Number.isFinite(time) ? time : null;
          if (row.type === "session_meta") {
            if (
              row.payload?.id !== sessionId ||
              typeof row.payload?.cwd !== "string" ||
              (await canonicalPath(row.payload.cwd)) !== workspace
            )
              return null;
            matched = true;
          } else if (row.type === "turn_context") {
            if (!turn) {
              turn = { startedAt: timestamp, complete: false, measured: false, finishedAt: null };
              turns.push(turn);
              turnIndex = turns.length - 1;
              turnIncomplete = false;
              if (turns.length > 50_000) return null;
            }
            const model = row.payload?.model;
            modelId =
              typeof model === "string" && model.trim() && model.length <= 256
                ? model.trim()
                : null;
          } else if (row.type === "event_msg" && row.payload?.type === "task_started") {
            turn = { startedAt: timestamp, complete: false, measured: false, finishedAt: null };
            turns.push(turn);
            turnIndex = turns.length - 1;
            turnIncomplete = false;
            if (turns.length > 50_000) return null;
            modelId = null;
          } else if (row.type === "event_msg" && row.payload?.type === "task_complete") {
            if (turn) {
              turn.complete = true;
              turn.finishedAt = timestamp;
            }
            turn = null;
            turnIndex = null;
            turnIncomplete = false;
            modelId = null;
          } else if (row.type === "event_msg" && row.payload?.type === "token_count") {
            if (!matched) return null;
            const raw = row.payload.info?.total_token_usage;
            if (raw == null) continue;
            const parsed = rawUsage.safeParse(raw);
            if (!parsed.success) return null;
            const value = parsed.data;
            if (
              value.total_tokens !== value.input_tokens + value.output_tokens ||
              (value.cached_input_tokens ?? 0) > value.input_tokens
            )
              return null;
            // 修复原因：total_token_usage 已累计，重复 token_count/压缩重置不能相加；
            // reasoning 是 output 的子集，原生 Codex 未提供 cache write，不能伪造 0。
            const current: AcpTokenUsage = {
              totalTokens: value.total_tokens,
              inputTokens: value.input_tokens,
              outputTokens: value.output_tokens,
              ...(value.cached_input_tokens !== undefined
                ? { cacheReadTokens: value.cached_input_tokens }
                : {}),
            };
            // 修复原因：设置页按原生请求时间/模型求累计差值；重置段仅重建基线，
            // 重复通知不计数，不把会话累计或 API 默认模型塞给当前请求。
            const continuous =
              !usage ||
              (current.inputTokens >= usage.inputTokens &&
                current.outputTokens >= usage.outputTokens);
            if (continuous) {
              const delta: AcpTokenUsage = {
                totalTokens: current.totalTokens - (usage?.totalTokens ?? 0),
                inputTokens: current.inputTokens - (usage?.inputTokens ?? 0),
                outputTokens: current.outputTokens - (usage?.outputTokens ?? 0),
              };
              if (
                current.cacheReadTokens !== undefined &&
                (!usage || usage.cacheReadTokens !== undefined) &&
                current.cacheReadTokens >= (usage?.cacheReadTokens ?? 0)
              )
                delta.cacheReadTokens = current.cacheReadTokens - (usage?.cacheReadTokens ?? 0);
              if (delta.totalTokens > 0) {
                records.push({ timestamp, modelId, usage: delta });
                if (turn && !turnIncomplete && timestamp !== null) turn.measured = true;
                if (turn && timestamp === null) {
                  turn.measured = false;
                  turnIncomplete = true;
                }
              }
            } else if (turn) {
              turn.measured = false;
              turnIncomplete = true;
            }
            usage = current;
            if (records.length > 50_000 || turns.length > 50_000) return null;
          }
        }
        if (pending.length > MAX_LINE_BYTES) return null;
      }
      // 文件正在写入时最后一行可能不完整，仅使用已提交的完整 JSONL 行。
      return matched && usage
        ? {
            history: { nativeSessionId: sessionId, usage, records, turns },
            cursor,
            turnIndex,
            modelId,
            turnIncomplete,
          }
        : null;
    } finally {
      stream.destroy();
    }
  } catch {
    // 原生文件缺失、被清理或格式变化都不应阻断 ACP 对话。
    return null;
  }
}

export async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    // 修复原因：已删除工作树的会话仍需统计历史；仅路径不存在时使用归一化绝对路径，
    // 权限/IO 异常仍拒绝，metadata.cwd 必须与登记的 workspacePath 一致。
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolve(path);
    throw error;
  }
}
