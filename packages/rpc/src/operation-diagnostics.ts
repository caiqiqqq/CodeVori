export interface DiagnosticErrorSummary {
  errorName: string;
  cause: string;
  line?: number;
  column?: number;
}

/** 只输出固定原因和行列号；错误正文可能包含用户输入、路径或凭据。 */
export function summarizeDiagnosticError(error: unknown): DiagnosticErrorSummary {
  try {
    if (!(error instanceof Error)) return { errorName: "Error", cause: "unknown" };
    const errorName =
      /^(Error|TypeError|RangeError|SyntaxError|ReferenceError|AbortError|NetworkError)$/.test(
        error.name,
      )
        ? error.name
        : "Error";
    const message = error.message.slice(0, 4096);
    const cause = /Maximum update depth/i.test(message)
      ? "maximum-update-depth"
      : /out of memory|heap limit/i.test(message)
        ? "out-of-memory"
        : /call stack|recursion/i.test(message)
          ? "stack-overflow"
          : /chunk|dynamically imported module/i.test(message)
            ? "module-load"
            : /timeout|超时/i.test(message)
              ? "timeout"
              : "unknown";
    const location = error.stack?.slice(0, 4096).match(/:(\d+):(\d+)\)?(?:\n|$)/);
    return {
      errorName,
      cause,
      ...(location ? { line: Number(location[1]), column: Number(location[2]) } : {}),
    };
  } catch {
    return { errorName: "Error", cause: "unknown" };
  }
}

export interface OperationDiagnostic {
  scope: string;
  id: string;
  operation: string;
  startedAt: number;
  timestamp: number;
  durationMs: number;
  phase: string;
  phasesMs: Record<string, number>;
  status: "pending" | "success" | "failure" | "expired" | "event";
  suppressed: number;
  error?: DiagnosticErrorSummary;
  facts?: Record<string, number | boolean | null>;
}

interface Span {
  phase(name: string): void;
  finish(status: "success" | "failure", error?: unknown): void;
}
interface ActiveOperation {
  operation: string;
  started: number;
  startedAt: number;
  phase: string;
  phaseStarted: number;
  phasesMs: Record<string, number>;
  pending: boolean;
}
let nextOwnerId = 0;
const inertSpan: Span = { phase() {}, finish() {} };
const label = (value: string) => (/^[a-zA-Z0-9_.-]{1,100}$/.test(value) ? value : "unknown");

/** 有界旁路，不读取请求/结果，不接管业务的 timeout、取消或重试。 */
export class OperationDiagnostics {
  private readonly active = new Map<string, ActiveOperation>();
  private readonly ownerId = ++nextOwnerId;
  private sequence = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private budgetStarted: number;
  private written = 0;
  private suppressed = 0;
  private readonly now: () => number;
  private readonly wallNow: () => number;

  constructor(
    private readonly write: (record: OperationDiagnostic) => void,
    private readonly options: {
      scope: string;
      now?: () => number;
      wallNow?: () => number;
      schedule?: boolean;
    },
  ) {
    this.now = options.now ?? (() => performance.now());
    this.wallNow = options.wallNow ?? Date.now;
    this.budgetStarted = this.now();
  }

  get activeCount(): number {
    return this.active.size;
  }

  start(operation: string): Span {
    if (this.disposed || this.active.size >= 64) {
      this.suppressed++;
      return inertSpan;
    }
    const id = `${this.ownerId}.${++this.sequence}`;
    const started = this.now();
    const item: ActiveOperation = {
      operation: label(operation),
      started,
      startedAt: this.wallNow(),
      phase: "start",
      phaseStarted: started,
      phasesMs: {},
      pending: false,
    };
    this.active.set(id, item);
    if (!this.timer && this.options.schedule !== false) {
      this.timer = setInterval(() => this.sample(), 1000);
      // 浏览器 timer 是数字，Node timer 才有 unref；诊断不能延长进程生命周期。
      (this.timer as unknown as { unref?: () => void }).unref?.();
    }
    return {
      phase: (name) => {
        if (!this.active.has(id) || Object.keys(item.phasesMs).length >= 16) return;
        const now = this.now();
        item.phasesMs[item.phase] =
          (item.phasesMs[item.phase] ?? 0) + Math.max(0, now - item.phaseStarted);
        item.phase = label(name);
        item.phaseStarted = now;
      },
      finish: (status, error) => {
        if (!this.active.delete(id)) return;
        if (status === "failure" || item.pending || this.now() - started >= 1000)
          this.emit(id, item, status, error);
        if (this.active.size === 0) this.stopTimer();
      },
    };
  }

  async run<T>(operation: string, action: (span: Span) => Promise<T>): Promise<T> {
    const span = this.start(operation);
    try {
      const result = await action(span);
      span.finish("success");
      return result;
    } catch (error) {
      span.finish("failure", error);
      throw error;
    }
  }

  event(operation: string, facts: Record<string, number | boolean | null>, error?: unknown): void {
    if (this.disposed) return;
    const now = this.now();
    this.emit(
      `${this.ownerId}.${++this.sequence}`,
      {
        operation: label(operation),
        started: now,
        startedAt: this.wallNow(),
        phase: "event",
        phaseStarted: now,
        phasesMs: {},
        pending: false,
      },
      "event",
      error,
      facts,
    );
  }

  sample(): void {
    const now = this.now();
    for (const [id, item] of this.active) {
      if (now - item.started >= 300000) {
        this.active.delete(id);
        this.emit(id, item, "expired");
      } else if (!item.pending && now - item.started >= 5000) {
        item.pending = true;
        this.emit(id, item, "pending");
      }
    }
    if (this.active.size === 0) this.stopTimer();
  }

  private emit(
    id: string,
    item: ActiveOperation,
    status: OperationDiagnostic["status"],
    error?: unknown,
    facts?: OperationDiagnostic["facts"],
  ): void {
    // 修复依据：诊断失败只能丢样本，不能把 RPC/Agent 成功改成失败。
    try {
      const now = this.now();
      if (now - this.budgetStarted >= 60000) {
        this.budgetStarted = now;
        this.written = 0;
      }
      if (this.written >= 20) {
        this.suppressed++;
        return;
      }
      this.written++;
      const phasesMs = Object.fromEntries(
        Object.entries(item.phasesMs).map(([phase, ms]) => [phase, Math.round(ms)]),
      );
      phasesMs[item.phase] = Math.round(
        (phasesMs[item.phase] ?? 0) + Math.max(0, now - item.phaseStarted),
      );
      this.write({
        scope: label(this.options.scope),
        id,
        operation: item.operation,
        startedAt: item.startedAt,
        timestamp: this.wallNow(),
        durationMs: Math.round(Math.max(0, now - item.started)),
        phase: item.phase,
        phasesMs,
        status,
        suppressed: this.suppressed,
        ...(error !== undefined ? { error: summarizeDiagnosticError(error) } : {}),
        ...(facts ? { facts } : {}),
      });
      this.suppressed = 0;
    } catch {
      /* best effort */
    }
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
  dispose(): void {
    this.disposed = true;
    this.active.clear();
    this.stopTimer();
  }
}
