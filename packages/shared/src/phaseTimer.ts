export interface PhaseTimingRecord {
  event: "latency.phases";
  scope: string;
  commandId?: string;
  sessionId?: string;
  operationId?: string;
  commandType?: string;
  status: "started" | "completed" | "failed" | "cancelled";
  outcome: string;
  phase: string;
  durationMs: number;
  phasesMs: Record<string, number>;
  phaseCounts: Record<string, number>;
  facts: Record<string, number | boolean | null>;
}

type Correlation = Pick<
  PhaseTimingRecord,
  "scope" | "commandId" | "sessionId" | "operationId" | "commandType"
>;
const MAX_PHASES = 32;
const label = (value: string) => (/^[\w.-]{1,80}$/.test(value) ? value : "unknown");
const opaqueId = (value: string | undefined) =>
  value !== undefined && /^[\w.:-]{1,200}$/.test(value) ? value : undefined;

/**
 * Low-frequency send/compact lifecycle timing. No payloads, timers, retained sessions or IO.
 * Each owner measures its own monotonic clock; IDs correlate processes without clock subtraction.
 * Nested operations use their own scope so a parent wait is not mistaken for additional cost.
 */
export class PhaseTimer {
  private readonly started: number;
  private phaseStarted: number;
  private current = "start";
  private done = false;
  private readonly phases: Record<string, number> = {};
  private readonly counts: Record<string, number> = { start: 1 };
  private readonly facts: PhaseTimingRecord["facts"] = {};

  constructor(
    private readonly correlation: Correlation,
    private readonly write: (record: PhaseTimingRecord) => void,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.started = this.phaseStarted = now();
  }

  phase(name: string): void {
    if (this.done) return;
    this.closePhase();
    const next = label(name);
    this.current =
      next in this.phases || Object.keys(this.phases).length < MAX_PHASES ? next : "other";
    this.counts[this.current] = (this.counts[this.current] ?? 0) + 1;
  }

  setFacts(facts: PhaseTimingRecord["facts"]): void {
    if (this.done) return;
    for (const [key, value] of Object.entries(facts)) {
      if (Object.keys(this.facts).length >= MAX_PHASES && !(key in this.facts)) continue;
      if (value === null || typeof value === "boolean" || Number.isFinite(value))
        this.facts[label(key)] = value;
    }
  }

  report(): void {
    if (!this.done) this.emit("progress");
  }

  finish(status: string): void {
    if (this.done) return;
    this.done = true;
    this.emit(label(status));
  }

  private closePhase(): void {
    const now = this.now();
    this.phases[this.current] =
      (this.phases[this.current] ?? 0) + Math.max(0, now - this.phaseStarted);
    this.phaseStarted = now;
  }

  private emit(status: string): void {
    const phase = this.current;
    this.closePhase();
    try {
      this.write({
        scope: label(this.correlation.scope),
        ...(this.correlation.commandType
          ? { commandType: label(this.correlation.commandType) }
          : {}),
        ...(opaqueId(this.correlation.commandId) ? { commandId: this.correlation.commandId } : {}),
        ...(opaqueId(this.correlation.sessionId) ? { sessionId: this.correlation.sessionId } : {}),
        ...(opaqueId(this.correlation.operationId)
          ? { operationId: this.correlation.operationId }
          : {}),
        event: "latency.phases",
        status:
          status === "progress"
            ? "started"
            : status === "failed"
              ? "failed"
              : ["cancelled", "interrupted", "evicted"].includes(status)
                ? "cancelled"
                : "completed",
        outcome: status,
        phase,
        durationMs: Math.round(Math.max(0, this.now() - this.started)),
        phasesMs: Object.fromEntries(
          Object.entries(this.phases).map(([name, ms]) => [name, Math.round(ms)]),
        ),
        phaseCounts: { ...this.counts },
        facts: { ...this.facts },
      });
    } catch {
      // 诊断出口失败不能改变接受凭证、队列或模型请求的结果。
    }
  }
}
