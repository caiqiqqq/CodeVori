import type { DelegationTask } from "@zcode/shared";

interface Entry {
  parent: string;
  data: string;
  task: DelegationTask;
  bytes: number;
}
interface Bucket {
  entries: Map<string, Entry>;
  bytes: number;
}

/** 仅保存可丢弃的已完成快照；调用方先读 SQLite，再用完整版本匹配缓存。 */
export class DelegationResultCache {
  private readonly entries = new Map<string, Entry>();
  private readonly parents = new Map<string, Bucket>();

  get(id: string, data: string): DelegationTask | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.data !== data) {
      this.delete(id);
      return undefined;
    }
    return structuredClone(entry.task);
  }
  set(parent: string, task: DelegationTask, data: string, maxMb: number) {
    let bucket = this.parents.get(parent);
    const cap = maxMb * 1024 * 1024;
    if (bucket && cap > 0)
      while (bucket.bytes > cap) this.delete(bucket.entries.keys().next().value!);
    const current = this.entries.get(task.id);
    if (current?.data === data) return;
    this.delete(task.id);
    const bytes = Buffer.byteLength(data, "utf8");
    if (task.status !== "completed" || (cap > 0 && bytes > cap)) return;
    bucket = this.parents.get(parent);
    if (!bucket) {
      bucket = { entries: new Map(), bytes: 0 };
      this.parents.set(parent, bucket);
    }
    const entry = { parent, task: structuredClone(task), data, bytes };
    bucket.entries.set(task.id, entry);
    bucket.bytes += bytes;
    this.entries.set(task.id, entry);
    while (cap > 0 && bucket.bytes > cap) this.delete(bucket.entries.keys().next().value!);
  }
  delete(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    const bucket = this.parents.get(entry.parent)!;
    bucket.entries.delete(id);
    bucket.bytes -= entry.bytes;
    this.entries.delete(id);
    if (!bucket.entries.size) this.parents.delete(entry.parent);
  }
  clearParent(parent: string) {
    const bucket = this.parents.get(parent);
    if (bucket) for (const id of bucket.entries.keys()) this.entries.delete(id);
    this.parents.delete(parent);
  }
  clear() {
    this.entries.clear();
    this.parents.clear();
  }
}
