import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** 仅复用未变化的 JSON 结构；删除字段、数组缩短和新值始终以权威输入为准。 */
function shareValue(previous: unknown, next: unknown): unknown {
  if (Object.is(previous, next)) return previous;
  if (Array.isArray(next)) {
    if (!Array.isArray(previous)) return next;
    let unchanged = previous.length === next.length;
    let shared = false;
    const values = next.map((value, index) => {
      const result = index < previous.length ? shareValue(previous[index], value) : value;
      if (result !== value) shared = true;
      if (index >= previous.length || result !== previous[index]) unchanged = false;
      return result;
    });
    return unchanged ? previous : shared ? values : next;
  }
  if (isPlainRecord(next)) {
    if (!isPlainRecord(previous)) return next;
    const keys = Object.keys(next);
    let unchanged = keys.length === Object.keys(previous).length;
    let shared = false;
    // 展开生成 own data properties，避免工具 input 的 __proto__ 键触发原型 setter。
    const values = { ...next };
    for (const key of keys) {
      const value = next[key];
      const existed = Object.hasOwn(previous, key);
      const result = existed ? shareValue(previous[key], value) : value;
      if (result !== value) shared = true;
      if (!existed || result !== previous[key]) unchanged = false;
      values[key] = result;
    }
    return unchanged ? previous : shared ? values : next;
  }
  return next;
}

/**
 * 修复依据：官方 3.16.3 对重解码的相同行做结构复用，避免恢复/分页反复创建正文对象。
 * 池只保留弱引用，不拥有会话事实；连接 scope 由 SessionDataLayer 隔离，行按 topic 隔离。
 */
export class ConversationRowPool {
  private readonly rows = new Map<string, WeakRef<ConversationRow>>();
  private readonly registry = new FinalizationRegistry<{
    key: string;
    ref: WeakRef<ConversationRow>;
  }>(({ key, ref }) => {
    // 同 rowId 后续可能已有新版本；旧对象回收不能删掉新引用。
    if (this.rows.get(key) === ref) this.rows.delete(key);
  });

  private key(topic: string, rowId: number): string {
    return `${topic}\u0000${rowId}`;
  }

  remember(topic: string, row: ConversationRow): void {
    const key = this.key(topic, row.rowId);
    if (this.rows.get(key)?.deref() === row) return;
    const ref = new WeakRef(row);
    this.rows.set(key, ref);
    this.registry.register(row, { key, ref });
  }

  shareRow<T extends ConversationRow>(topic: string, row: T): T {
    const previous = this.rows.get(this.key(topic, row.rowId))?.deref();
    const shared = previous ? (shareValue(previous, row) as T) : row;
    this.remember(topic, shared);
    return shared;
  }

  shareWindow(
    topic: string,
    rows: ConversationRow[],
    previous?: ConversationRow[],
  ): ConversationRow[] {
    let unchanged = previous !== undefined && previous.length === rows.length;
    let shared = false;
    const window = rows.map((row, index) => {
      const result = this.shareRow(topic, row);
      if (result !== row) shared = true;
      if (unchanged && result !== previous?.[index]) unchanged = false;
      return result;
    });
    return unchanged ? previous! : shared ? window : rows;
  }
}
