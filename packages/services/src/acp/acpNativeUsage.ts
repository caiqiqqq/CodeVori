import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { AcpSession } from "@zcode/shared";
import {
  AcpUsageHistoryCheckpoint,
  MAX_CACHED_FILES,
  MAX_CACHED_FACTS,
  type CodexUsageHistory,
  type HistoryCacheEntry,
} from "./acpUsageHistoryCheckpoint.js";
import { canonicalPath, parseRollout } from "./acpCodexRolloutParser.js";
export type { CodexUsageHistory } from "./acpUsageHistoryCheckpoint.js";

const MAX_ENTRIES = 30_000;
const TAIL_HASH_BYTES = 64 * 1024;
const MAX_ON_DEMAND_USAGE_BYTES = 64 * 1024 * 1024;
const validId = (id: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
export const codexUsageKey = (session: Pick<AcpSession, "acpSessionId" | "workspacePath">) =>
  JSON.stringify([session.acpSessionId, session.workspacePath]);

interface HistoryReaderState {
  entries: Map<string, HistoryCacheEntry>;
  disposed: boolean;
}

/** 缓存由 owning ACP Host 持有；持久化的仅是可重建的数值解析投影。 */
export function createCodexUsageHistoryReader(cacheFile?: string) {
  const state: HistoryReaderState = { entries: new Map(), disposed: false };
  const checkpoint = cacheFile ? new AcpUsageHistoryCheckpoint(cacheFile) : undefined;
  let hydration: Promise<void> | undefined;
  return {
    async read(sessions: readonly AcpSession[], root: string) {
      if (state.disposed) return new Map<string, CodexUsageHistory>();
      if (checkpoint) {
        hydration ??= checkpoint.load().then((entries) => {
          if (!state.disposed) state.entries = entries;
        });
        await hydration;
      }
      const result = await readUsageHistories(sessions, root, state);
      await checkpoint?.save(state.entries, () => state.disposed);
      return state.disposed ? new Map<string, CodexUsageHistory>() : result;
    },
    dispose() {
      state.disposed = true;
      state.entries.clear();
    },
  };
}

async function fileVersion(file: string) {
  const value = await stat(file, { bigint: true });
  if (!value.isFile() || value.size > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  // 修复原因：mtime/size 相同的覆盖或原子替换也会改变身份或 ctime，不能复用旧计量。
  return {
    version: [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":"),
    identity: [value.dev, value.ino].join(":"),
    size: Number(value.size),
  };
}

async function hashReadTail(file: string, cursor: number): Promise<string | null> {
  const start = Math.max(0, cursor - TAIL_HASH_BYTES);
  const buffer = Buffer.allocUnsafe(cursor - start);
  const handle = await open(file, "r");
  try {
    let read = 0;
    while (read < buffer.length) {
      const chunk = await handle.read(buffer, read, buffer.length - read, start + read);
      if (chunk.bytesRead === 0) return null;
      read += chunk.bytesRead;
    }
    return createHash("sha256").update(buffer).digest("hex");
  } finally {
    await handle.close();
  }
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
      cached.version === version.version &&
      cached.cursor === version.size &&
      cached.history.nativeSessionId === session.acpSessionId
    ) {
      retainHistory(state, key, cached);
      return cached.history;
    }
    const canContinue =
      cached?.root === root &&
      cached.file === file &&
      cached.workspace === workspace &&
      cached.history.nativeSessionId === session.acpSessionId &&
      cached.identity === version.identity &&
      cached.cursor > 0 &&
      cached.cursor < version.size &&
      (cached.turnIndex === null || cached.turnIndex < cached.history.turns.length) &&
      cached.tailHash === (await hashReadTail(file, cached.cursor));
    const sourceTailHash = await hashReadTail(file, version.size);
    const parsed = await parseRollout(
      file,
      session.acpSessionId,
      session.workspacePath,
      version.size,
      canContinue ? cached : undefined,
    );
    // 修复原因：活动日志扫描期间可继续追加；已验证前缀仍可缓存，下一次从完整行边界追平。
    const latest = await fileVersion(file);
    if (
      parsed &&
      sourceTailHash !== null &&
      latest?.identity === version.identity &&
      latest.size >= version.size &&
      sourceTailHash === (await hashReadTail(file, version.size))
    ) {
      const tailHash = await hashReadTail(file, parsed.cursor);
      if (tailHash && (await fileVersion(file))?.version === latest.version)
        retainHistory(state, key, {
          root,
          file,
          workspace,
          version: latest.version,
          identity: version.identity,
          tailHash,
          ...parsed,
        });
    }
    return parsed?.history ?? null;
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
    const version = await fileVersion(candidates[0]!);
    // 回合完成路径没有 Host 检查点，保留原耗时边界；统计页通过增量读取器完整计量。
    if (!version || version.size > MAX_ON_DEMAND_USAGE_BYTES) return null;
    const parsed = await parseRollout(
      candidates[0]!,
      input.sessionId,
      input.workspacePath,
      version.size,
    );
    return parsed ? { nativeSessionId: input.sessionId, usage: parsed.history.usage } : null;
  } catch {
    return null;
  }
}
