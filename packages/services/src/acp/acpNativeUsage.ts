import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import type { AcpSession, AcpTokenUsage } from "@zcode/shared";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const rawUsage = z.object({
  input_tokens: count,
  output_tokens: count,
  total_tokens: count,
  cached_input_tokens: count.optional(),
});
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 30_000;
const MAX_CACHED_FILES = 128;
const MAX_CACHED_FACTS = 100_000;

export type CodexUsageHistory = {
  nativeSessionId: string;
  usage: AcpTokenUsage;
  records: Array<{ timestamp: number | null; modelId: string | null; usage: AcpTokenUsage }>;
  turns: Array<{
    startedAt: number | null;
    complete: boolean;
    measured: boolean;
    finishedAt: number | null;
  }>;
};
const validId = (id: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
export const codexUsageKey = (session: Pick<AcpSession, "acpSessionId" | "workspacePath">) =>
  JSON.stringify([session.acpSessionId, session.workspacePath]);

interface HistoryCacheEntry {
  root: string;
  file: string;
  workspace: string;
  version: string;
  history: CodexUsageHistory;
}

interface HistoryReaderState {
  entries: Map<string, HistoryCacheEntry>;
  disposed: boolean;
}

/** 缓存由 owning ACP Host 持有；只复用数值解析，不持久化另一份用量事实。 */
export function createCodexUsageHistoryReader() {
  const state: HistoryReaderState = { entries: new Map(), disposed: false };
  return {
    read: (sessions: readonly AcpSession[], root: string) =>
      readUsageHistories(sessions, root, state),
    dispose() {
      state.disposed = true;
      state.entries.clear();
    },
  };
}

async function fileVersion(file: string): Promise<string | null> {
  const value = await stat(file, { bigint: true });
  if (!value.isFile() || value.size > BigInt(MAX_FILE_BYTES)) return null;
  // 修复原因：mtime/size 相同的覆盖或原子替换也会改变身份或 ctime，不能复用旧计量。
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":");
}

function retainHistory(state: HistoryReaderState, key: string, entry: HistoryCacheEntry): void {
  if (state.disposed) return;
  const facts = (value: HistoryCacheEntry) =>
    value.history.records.length + value.history.turns.length;
  if (facts(entry) > MAX_CACHED_FACTS) return;
  state.entries.set(key, entry);
  let total = [...state.entries.values()].reduce((sum, value) => sum + facts(value), 0);
  for (const [oldest, value] of state.entries) {
    if (state.entries.size <= MAX_CACHED_FILES && total <= MAX_CACHED_FACTS) break;
    state.entries.delete(oldest);
    total -= facts(value);
  }
}

async function readCachedRollout(
  state: HistoryReaderState,
  key: string,
  root: string,
  file: string,
  session: AcpSession,
): Promise<CodexUsageHistory | null> {
  try {
    const workspace = await canonicalPath(session.workspacePath);
    const version = await fileVersion(file);
    const cached = state.entries.get(key);
    state.entries.delete(key);
    if (version === null) return null;
    if (
      cached?.root === root &&
      cached.file === file &&
      cached.workspace === workspace &&
      cached.version === version
    ) {
      retainHistory(state, key, cached);
      return cached.history;
    }
    const history = await parseRollout(file, session.acpSessionId, session.workspacePath);
    // 修复原因：活动日志可能边读边追加；读取期间版本变化的投影不能成为下次查询的缓存。
    if (history && (await fileVersion(file)) === version)
      retainHistory(state, key, { root, file, workspace, version, history });
    return history;
  } catch {
    state.entries.delete(key);
    return null;
  }
}

async function indexRollouts(root: string): Promise<Map<string, string[]>> {
  const files = new Map<string, string[]>();
  let entries = 0;
  async function visit(directory: string, depth: number): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++entries > MAX_ENTRIES) throw new Error("native usage scan limit");
      if (entry.isDirectory() && depth < 3) await visit(join(directory, entry.name), depth + 1);
      else if (entry.isFile()) {
        const id = entry.name.match(/-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i)?.[1];
        if (id) files.set(id, [...(files.get(id) ?? []), join(directory, entry.name)]);
      }
    }
  }
  await visit(join(root, "sessions"), 0);
  return files;
}

/** One bounded index scan for the Host's registered sessions; no Agent process is started. */
export async function readCodexUsageHistories(
  sessions: readonly AcpSession[],
  root: string,
): Promise<Map<string, CodexUsageHistory>> {
  return createCodexUsageHistoryReader().read(sessions, root);
}

async function readUsageHistories(
  sessions: readonly AcpSession[],
  root: string,
  state: HistoryReaderState,
): Promise<Map<string, CodexUsageHistory>> {
  const result = new Map<string, CodexUsageHistory>();
  if (state.disposed) return result;
  try {
    const registered = sessions.filter(
      (session) => session.agent === "codex" && validId(session.acpSessionId),
    );
    if (!isAbsolute(root) || !registered.length) {
      state.entries.clear();
      return result;
    }
    const canonicalRoot = await canonicalPath(root);
    const keys = new Set(registered.map(codexUsageKey));
    for (const [key, value] of state.entries)
      if (!keys.has(key) || value.root !== canonicalRoot) state.entries.delete(key);
    const files = await indexRollouts(canonicalRoot);
    const seen = new Set<string>();
    for (const session of registered) {
      if (state.disposed) return new Map();
      const key = codexUsageKey(session);
      if (seen.has(key)) continue;
      seen.add(key);
      const candidates = files.get(session.acpSessionId);
      if (candidates?.length !== 1) {
        state.entries.delete(key);
        continue;
      }
      const history = await readCachedRollout(state, key, canonicalRoot, candidates[0]!, session);
      if (history) result.set(key, history);
    }
  } catch {
    state.entries.clear();
    /* 不可读取的原生目录不能阻断设置页的其它来源。 */
  }
  return state.disposed ? new Map() : result;
}

/** Adapter-only read: the owning Host receives numeric facts, never native messages. */
export async function readCodexNativeUsage(input: {
  sessionId: string;
  workspacePath: string;
  env: NodeJS.ProcessEnv;
}): Promise<NonNullable<AcpSession["nativeUsage"]> | null> {
  if (!validId(input.sessionId)) return null;
  const home = input.env.HOME || input.env.USERPROFILE || homedir();
  const configured = input.env.CODEX_HOME?.trim();
  const root = !configured
    ? join(home, ".codex")
    : configured === "~"
      ? home
      : configured.startsWith("~/")
        ? join(home, configured.slice(2))
        : configured;
  if (!isAbsolute(root)) return null;
  try {
    const candidates = (await indexRollouts(root)).get(input.sessionId);
    if (candidates?.length !== 1) return null;
    const history = await parseRollout(candidates[0]!, input.sessionId, input.workspacePath);
    return history ? { nativeSessionId: input.sessionId, usage: history.usage } : null;
  } catch {
    return null;
  }
}

async function parseRollout(
  file: string,
  sessionId: string,
  workspacePath: string,
): Promise<CodexUsageHistory | null> {
  try {
    if ((await stat(file)).size > MAX_FILE_BYTES) return null;
    const workspace = await canonicalPath(workspacePath);
    let matched = false;
    let usage: NonNullable<AcpSession["nativeUsage"]>["usage"] | null = null;
    const records: CodexUsageHistory["records"] = [];
    const turns: CodexUsageHistory["turns"] = [];
    let turn: CodexUsageHistory["turns"][number] | null = null;
    let modelId: string | null = null;
    const incomplete = new Set<CodexUsageHistory["turns"][number]>();
    let pending = "";
    let bytes = 0;
    const decoder = new StringDecoder("utf8");
    const stream = createReadStream(file, { highWaterMark: 64 * 1024 });
    try {
      for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > MAX_FILE_BYTES) return null;
        pending += decoder.write(chunk);
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
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
            if (turns.length > 50_000) return null;
            modelId = null;
          } else if (row.type === "event_msg" && row.payload?.type === "task_complete") {
            if (turn) {
              turn.complete = true;
              turn.finishedAt = timestamp;
            }
            turn = null;
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
                if (turn && !incomplete.has(turn) && timestamp !== null) turn.measured = true;
                if (turn && timestamp === null) {
                  turn.measured = false;
                  incomplete.add(turn);
                }
              }
            } else if (turn) {
              turn.measured = false;
              incomplete.add(turn);
            }
            usage = current;
            if (records.length > 50_000 || turns.length > 50_000) return null;
          }
        }
        if (pending.length > MAX_LINE_BYTES) return null;
      }
      // 文件正在写入时最后一行可能不完整，仅使用已提交的完整 JSONL 行。
      return matched && usage ? { nativeSessionId: sessionId, usage, records, turns } : null;
    } finally {
      stream.destroy();
    }
  } catch {
    // 原生文件缺失、被清理或格式变化都不应阻断 ACP 对话。
    return null;
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    // 修复原因：已删除工作树的会话仍需统计历史；仅路径不存在时使用归一化绝对路径，
    // 权限/IO 异常仍拒绝，metadata.cwd 必须与登记的 workspacePath 一致。
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolve(path);
    throw error;
  }
}
