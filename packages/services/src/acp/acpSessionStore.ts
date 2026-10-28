import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, truncate } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { acpEntrySchema, acpSessionSchema, type AcpSession } from "@zcode/shared";

const metadataSchema = acpSessionSchema.omit({ entries: true });
const recordSchema = z
  .object({
    version: z.literal(1),
    previousRevision: z.number().int().nonnegative(),
    metadata: metadataSchema,
    length: z.number().int().nonnegative(),
    changes: z.array(z.tuple([z.number().int().nonnegative(), acpEntrySchema])),
  })
  .strict();
type Captured = { snapshot: AcpSession; entries: string[] };

function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

/** Host-owned persistence adapter. Call commit/checkpoint/remove through the owner's writes gate.
 * The JSON checkpoint discovers legacy sessions; newline-terminated journal records are atomic revisions.
 * Desktop live frames and mobile recovery both project only successfully committed snapshots.
 */
export class AcpSessionStore {
  private readonly committed = new Map<string, Captured>();
  private readonly captured = new Map<string, Captured>();
  private readonly sizes = new Map<string, number>();
  private readonly encodings = new WeakMap<AcpSession, string[]>();

  constructor(
    private readonly file: (id: string) => string,
    private readonly onCheckpointError?: (error: unknown) => void,
  ) {}

  /** Derived immutable committed view; callers must never mutate it. */
  current(id: string): AcpSession | undefined {
    return this.committed.get(id)?.snapshot;
  }

  capture(session: AcpSession): AcpSession {
    const previous = this.captured.get(session.id) ?? this.committed.get(session.id);
    const { entries: source, ...metadata } = session;
    const entries = source.map((entry) => JSON.stringify(entry));
    const snapshot = {
      ...metadataSchema.parse(metadata),
      // 修复原因：只克隆、校验变化的行，历史行复用不可变副本；不能共享可变 owner 对象。
      entries: source.map((entry, index) =>
        previous && previous.entries[index] === entries[index]
          ? previous.snapshot.entries[index]!
          : acpEntrySchema.parse(entry),
      ),
    };
    freezeSnapshot(snapshot);
    this.captured.set(session.id, { snapshot, entries });
    this.encodings.set(snapshot, entries);
    return snapshot;
  }

  private async atomicWrite(path: string, contents: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(contents);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async read(id: string, { repairTail = true } = {}): Promise<AcpSession> {
    const cached = this.committed.get(id);
    if (cached) return structuredClone(cached.snapshot);
    const path = this.file(id);
    const checkpoint = await open(path, "r");
    const [contents, checkpointInfo] = await (async () => {
      try {
        return await Promise.all([checkpoint.readFile("utf8"), checkpoint.stat()]);
      } finally {
        await checkpoint.close();
      }
    })();
    let snapshot = acpSessionSchema.parse(JSON.parse(contents));
    if (snapshot.id !== id) throw new Error("ACP checkpoint target changed");
    const journal = await readFile(`${path}.journal`).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return Buffer.alloc(0);
      throw error;
    });
    const latest = await stat(path);
    // 只读目录查询可能与 checkpoint 合并并发；不能把旧 base 与已清空的新 journal 拼在一起。
    if (
      latest.ino !== checkpointInfo.ino ||
      latest.mtimeMs !== checkpointInfo.mtimeMs ||
      latest.size !== checkpointInfo.size
    )
      throw new Error("ACP checkpoint changed while reading; retry");
    const end = journal.lastIndexOf(10) + 1;
    // 修复依据：崩溃只允许丢弃未结束的末条记录；下一次 append 前先截掉残留字节。
    if (repairTail && end < journal.length) await truncate(`${path}.journal`, end);
    for (const line of journal.subarray(0, end).toString("utf8").split("\n")) {
      if (!line) continue;
      const record = recordSchema.parse(JSON.parse(line));
      if (record.metadata.id !== id) throw new Error("ACP journal target changed");
      // checkpoint 原子替换后进程可能尚未清 journal；旧 revision 可以安全跳过。
      if (record.metadata.revision <= snapshot.revision) continue;
      if (record.previousRevision !== snapshot.revision)
        throw new Error("ACP journal revision gap");
      const entries = snapshot.entries;
      entries.length = record.length;
      for (const [index, entry] of record.changes) {
        if (index >= record.length) throw new Error("ACP journal entry out of range");
        entries[index] = entry;
      }
      snapshot = { ...record.metadata, entries };
    }
    snapshot = freezeSnapshot(acpSessionSchema.parse(snapshot));
    const value = { snapshot, entries: snapshot.entries.map((entry) => JSON.stringify(entry)) };
    this.committed.set(id, value);
    this.sizes.set(id, end);
    return structuredClone(snapshot);
  }

  async commit(snapshot: AcpSession): Promise<number> {
    const id = snapshot.id;
    const path = this.file(id);
    // Existing sessions are read by the owner before mutation. New sessions have no checkpoint.
    const previous = this.committed.get(id);
    const entries =
      this.encodings.get(snapshot) ?? snapshot.entries.map((entry) => JSON.stringify(entry));
    await mkdir(dirname(path), { recursive: true });
    const exists = await stat(path).then(
      (value) => {
        if (!value.isFile()) throw new Error("ACP checkpoint is not a regular file");
        return true;
      },
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (!previous || !exists) {
      const serialized = JSON.stringify(snapshot);
      if (previous && !exists) await this.atomicWrite(`${path}.journal`, "");
      await this.atomicWrite(path, serialized);
      this.committed.set(id, { snapshot, entries });
      this.sizes.set(id, 0);
      return Buffer.byteLength(serialized);
    }
    if (snapshot.revision <= previous.snapshot.revision)
      throw new Error("ACP persistence revision must advance");
    const { entries: rows, ...metadata } = snapshot;
    const record =
      JSON.stringify({
        version: 1,
        previousRevision: previous.snapshot.revision,
        metadata,
        length: rows.length,
        changes: rows.flatMap((entry, index) =>
          previous.entries[index] === entries[index] ? [] : [[index, entry]],
        ),
      }) + "\n";
    const handle = await open(`${path}.journal`, "a", 0o600);
    const size = this.sizes.get(id) ?? 0;
    try {
      await handle.writeFile(record);
      await handle.sync();
    } catch (error) {
      // 写入失败不能发布半条事实，也不能让下一次成功写入接在坏尾巴后。
      await handle.truncate(size);
      await handle.sync();
      throw error;
    } finally {
      await handle.close();
    }
    this.committed.set(id, { snapshot, entries });
    const bytes = Buffer.byteLength(record);
    this.sizes.set(id, size + bytes);
    // Bounded replay cost, amortized over changed rows rather than a full write per token.
    if (size + bytes >= 8 * 1024 * 1024) {
      // 日志已成功持久化：checkpoint 维护失败不能把已接纳输入报成失败。
      await this.checkpoint(id).catch((error: unknown) => this.onCheckpointError?.(error));
    }
    return bytes;
  }

  async checkpoint(id: string): Promise<void> {
    const value = this.committed.get(id);
    if (!value) throw new Error("ACP checkpoint not loaded");
    const path = this.file(id);
    await this.atomicWrite(path, JSON.stringify(value.snapshot));
    // journal 也原子替换；失败时旧文件与 size 保持一致，重启可按 revision 跳过旧记录。
    await this.atomicWrite(`${path}.journal`, "");
    this.sizes.set(id, 0);
  }

  async remove(id: string): Promise<void> {
    // 删除 checkpoint 失败时，仍必须留下包含全部已接纳事实的可恢复文件。
    if (this.committed.has(id)) await this.checkpoint(id);
    await rm(`${this.file(id)}.journal`, { force: true });
    await rm(this.file(id), { force: true });
    this.committed.delete(id);
    this.captured.delete(id);
    this.sizes.delete(id);
  }
}
