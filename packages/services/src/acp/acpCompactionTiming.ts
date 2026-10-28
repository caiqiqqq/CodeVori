import { PhaseTimer, type AcpSession, type PhaseTimingRecord } from "@zcode/shared";
import type { AcpCompactionUpdate } from "./acpCompaction.js";
import { createServiceLogger } from "../logger/serviceLogger.js";

const logger = createServiceLogger("acp-compaction");
const MAX_ACTIVE_COMPACTIONS = 64;

/** Observes the external Agent boundary only; Host cannot time its provider's internals. */
export class AcpCompactionTiming {
  private readonly active = new Map<string, { sessionId: string; timer: PhaseTimer }>();

  constructor(
    private readonly write: (record: PhaseTimingRecord) => void = (record) =>
      logger.info(undefined, "[latency]", record),
    private readonly now: () => number = () => performance.now(),
  ) {}

  update(session: AcpSession, commandId: string, update: AcpCompactionUpdate): void {
    if (update.kind !== "compaction") return;
    const id = `compaction:${commandId}:${update.id}`;
    const entry = session.entries.find((entry) => entry.id === id);
    if (entry?.kind !== "compaction") return;
    const key = `${session.id}:${id}`;
    let observed = this.active.get(key);
    if (!observed && entry.status === "running") {
      if (this.active.size >= MAX_ACTIVE_COMPACTIONS) {
        const oldest = this.active.entries().next().value!;
        oldest[1].timer.finish("evicted");
        this.active.delete(oldest[0]);
      }
      const timer = new PhaseTimer(
        { scope: "acp.compact", sessionId: session.id, commandId, operationId: update.id },
        this.write,
        this.now,
      );
      observed = { sessionId: session.id, timer };
      this.active.set(key, observed);
      timer.phase("external_agent");
      timer.report();
    }
    if (!observed) return;
    observed.timer.setFacts({
      tokensBefore: entry.tokensBefore ?? null,
      tokensAfter: entry.tokensAfter ?? null,
      summaryChars: entry.summary?.length ?? 0,
    });
    if (entry.status !== "running") {
      observed.timer.finish(entry.status);
      this.active.delete(key);
    }
  }

  removeSession(sessionId: string): void {
    for (const [key, observed] of this.active) {
      if (observed.sessionId !== sessionId) continue;
      observed.timer.finish("interrupted");
      this.active.delete(key);
    }
  }

  dispose(): void {
    for (const observed of this.active.values()) observed.timer.finish("interrupted");
    this.active.clear();
  }
}
