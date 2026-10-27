import { Emitter } from "@zcode/rpc";

/** TerminalService 的订阅空窗缓冲；不保存已交付的终端历史。 */
export class TerminalOutput {
  private pending: string[] = [];
  private pendingChars = 0;
  private hasListener = false;
  private replaying = false;
  private disposed = false;
  private readonly emitter = new Emitter<string>({
    onWillAddFirstListener: () => {
      this.hasListener = true;
      this.flush();
    },
    onDidRemoveLastListener: () => {
      this.hasListener = false;
    },
  });

  readonly event = this.emitter.event;

  constructor(private readonly maxChars = 1_048_576) {
    if (!Number.isSafeInteger(maxChars) || maxChars < 1) {
      throw new Error("Terminal output buffer size must be a positive integer");
    }
  }

  fire(data: string): void {
    if (this.disposed || data.length === 0) return;
    // create 与 RPC 订阅之间存在空窗，普通 Emitter 会丢首段输出；在唯一输出源缓存。
    // 单 chunk 也截断到上限，避免无监听时超大输出绕过总量限制。
    const chunk = this.hasListener ? data : data.slice(-this.maxChars);
    this.pending.push(chunk);
    this.pendingChars += chunk.length;
    while (!this.hasListener && this.pendingChars > this.maxChars) {
      const first = this.pending[0]!;
      const excess = this.pendingChars - this.maxChars;
      if (first.length <= excess) {
        this.pending.shift();
        this.pendingChars -= first.length;
      } else {
        this.pending[0] = first.slice(excess);
        this.pendingChars -= excess;
      }
    }
    this.flush();
  }

  private flush(): void {
    if (this.replaying) return;
    this.replaying = true;
    try {
      while (this.hasListener && this.pending.length > 0) {
        const chunk = this.pending.shift()!;
        this.pendingChars -= chunk.length;
        this.emitter.fire(chunk);
      }
    } finally {
      this.replaying = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.hasListener = false;
    this.pending = [];
    this.pendingChars = 0;
    this.emitter.dispose();
  }
}
