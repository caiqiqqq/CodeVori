import { appendFile, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

interface Options {
  schedule?: boolean;
  maxQueueBytes?: number;
  maxFileBytes?: number;
  prepare?: (path: string) => Promise<number>;
  append?: (path: string, text: string) => Promise<void>;
}

/** Main 是诊断文件的唯一写入者；慢盘和失败只能丢诊断，业务永不等待这个队列。 */
export class DiagnosticLogWriter {
  private queue: Array<{ path: string; line: string; bytes: number }> = [];
  private bytes = 0;
  private dropped = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | undefined;
  private filePath: string | undefined;
  private fileBytes = 0;
  constructor(private readonly options: Options = {}) {}
  get queuedBytes(): number {
    return this.bytes;
  }

  enqueue(path: string, line: string): void {
    const bytes = Buffer.byteLength(line);
    if (bytes > 8192 || this.bytes + bytes > (this.options.maxQueueBytes ?? 256 * 1024)) {
      this.dropped++;
      return;
    }
    this.queue.push({ path, line, bytes });
    this.bytes += bytes;
    this.schedule();
  }

  private schedule(): void {
    if (this.options.schedule === false || this.timer || this.pending) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 100);
    this.timer.unref();
  }

  flush(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = this.drain().finally(() => {
      this.pending = undefined;
      if (this.queue.length) this.schedule();
    });
    return this.pending;
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const path = this.queue[0]!.path;
      const batch: string[] = [];
      let batchBytes = 0;
      let count = 0;
      while (this.queue[0]?.path === path && batchBytes + this.queue[0].bytes <= 32 * 1024) {
        const item = this.queue.shift()!;
        this.bytes -= item.bytes;
        batch.push(item.line);
        batchBytes += item.bytes;
        count++;
      }
      try {
        if (this.filePath !== path) {
          this.fileBytes = await (this.options.prepare ?? prepareFile)(path);
          this.filePath = path;
        }
        const droppedLine = this.dropped ? `[diagnostics] writer dropped=${this.dropped}\n` : "";
        const text = droppedLine + batch.join("");
        const bytes = Buffer.byteLength(text);
        if (this.fileBytes + bytes > (this.options.maxFileBytes ?? 5 * 1024 * 1024)) {
          this.dropped += count;
          continue;
        }
        await (this.options.append ?? appendFile)(path, text);
        this.fileBytes += bytes;
        // await 期间也可能发生溢出，只扣除本批已写入的丢弃计数。
        if (droppedLine) this.dropped -= Number(droppedLine.match(/dropped=(\d+)/)?.[1] ?? 0);
      } catch {
        this.dropped += count;
        this.filePath = undefined;
      }
    }
  }
}

async function prepareFile(path: string): Promise<number> {
  await mkdir(dirname(path), { recursive: true });
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}
