import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { acpTokenUsageSchema } from "@zcode/shared";
import { z } from "zod";

export const MAX_CACHED_FILES = 1024;
export const MAX_CACHED_FACTS = 100_000;
const MAX_CHECKPOINT_BYTES = 32 * 1024 * 1024;
const time = z.number().finite().nullable();
const historySchema = z.object({
  nativeSessionId: z.string().uuid(),
  usage: acpTokenUsageSchema,
  records: z
    .array(
      z.object({
        timestamp: time,
        modelId: z.string().max(256).nullable(),
        usage: acpTokenUsageSchema,
      }),
    )
    .max(50_000),
  turns: z
    .array(
      z.object({
        startedAt: time,
        complete: z.boolean(),
        measured: z.boolean(),
        finishedAt: time,
      }),
    )
    .max(50_000),
});
export type CodexUsageHistory = z.infer<typeof historySchema>;
const entrySchema = z.object({
  root: z.string(),
  file: z.string(),
  workspace: z.string(),
  version: z.string(),
  history: historySchema,
});
export type HistoryCacheEntry = z.infer<typeof entrySchema>;
const checkpointSchema = z
  .object({
    // 修改解析语义时递增版本，旧投影必须从原始日志重新生成。
    version: z.literal(1),
    entries: z.array(z.tuple([z.string(), entrySchema])).max(MAX_CACHED_FILES),
  })
  .refine(
    ({ entries }) =>
      entries.reduce(
        (sum, [, entry]) => sum + entry.history.records.length + entry.history.turns.length,
        0,
      ) <= MAX_CACHED_FACTS,
  );

function fingerprint(entries: Map<string, HistoryCacheEntry>): string {
  return JSON.stringify(
    [...entries]
      .map(([key, entry]) => [key, entry.root, entry.file, entry.workspace, entry.version])
      .sort((a, b) => a[0]!.localeCompare(b[0]!)),
  );
}

/** Host 所有的可丢弃数值投影；读写失败均不影响原生事实读取。 */
export class AcpUsageHistoryCheckpoint {
  private previous = "";

  constructor(private readonly file: string) {}

  async load(): Promise<Map<string, HistoryCacheEntry>> {
    try {
      const handle = await open(this.file, "r");
      let content: string;
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_CHECKPOINT_BYTES) return new Map();
        content = await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
      const checkpoint = checkpointSchema.parse(JSON.parse(content));
      const entries = new Map(checkpoint.entries);
      this.previous = fingerprint(entries);
      return entries;
    } catch {
      return new Map();
    }
  }

  async save(entries: Map<string, HistoryCacheEntry>, isDisposed: () => boolean): Promise<void> {
    const identity = fingerprint(entries);
    if (isDisposed() || identity === this.previous) return;
    // 修复原因：内存缓存更新重启即丢失；持久化经过版本核对的数值投影，
    // 避免每次更新都重扫数 GB 正文。原子替换允许多 Host 安全重建同一派生缓存。
    const content = JSON.stringify({ version: 1, entries: [...entries] });
    if (Buffer.byteLength(content) > MAX_CHECKPOINT_BYTES) return;
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      if (isDisposed()) return;
      await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
      if (isDisposed()) return;
      await rename(temporary, this.file);
      this.previous = identity;
    } catch {
      // 缓存目录只读、磁盘不足等情况退化为内存缓存，不中断统计。
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
}
