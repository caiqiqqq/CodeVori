import { StreamDiagnostics, type StreamDiagnostic } from "@zcode/rpc";
import type { AcpStreamDiagnostic } from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";

type Receipt = Omit<AcpStreamDiagnostic, "snapshotStartedAt" | "broadcastAt">;
interface Observed {
  receipt: Receipt;
  received: number;
  receivedSample: number;
  receivedSampleRevision: number;
  broadcastSample?: number;
  broadcastEntry?: number;
  broadcastRevision?: number;
}
const logger = createServiceLogger("acp-stream");

/** Host 唯一观察器：只记最新分片的元数据，正文仍由 IAcpService 持有。 */
export class AcpStreamDiagnostics {
  private readonly sessions = new Map<string, Observed>();
  private readonly writer: StreamDiagnostics;

  constructor(
    write: (record: StreamDiagnostic) => void = (record) =>
      logger.info(undefined, "[diagnostics]", record),
    private readonly now: () => number = () => performance.now(),
  ) {
    this.writer = new StreamDiagnostics(write, "acp-host-stream", { now });
  }

  get trackedCount(): number {
    return this.sessions.size;
  }

  received(id: string, receipt: Receipt): void {
    const now = this.now();
    const previous = this.sessions.get(id);
    const gapMs = previous ? Math.max(0, now - previous.received) : 0;
    const sample =
      !previous ||
      previous.receipt.entryIndex !== receipt.entryIndex ||
      now - previous.receivedSample >= 1000 ||
      gapMs >= 1000;
    const next: Observed = {
      ...previous,
      receipt,
      received: now,
      receivedSample: sample ? now : previous!.receivedSample,
      receivedSampleRevision: sample ? receipt.receivedRevision : previous!.receivedSampleRevision,
    };
    this.sessions.delete(id);
    this.sessions.set(id, next);
    if (this.sessions.size > 64) this.sessions.delete(this.sessions.keys().next().value!);
    if (sample) this.writer.record("received", id, receipt.receivedRevision, { ...receipt, gapMs });
  }

  capture(id: string, revision: number): Receipt | undefined {
    const receipt = this.sessions.get(id)?.receipt;
    return receipt && receipt.receivedRevision <= revision ? receipt : undefined;
  }

  broadcast(
    id: string,
    revision: number,
    receipt: Receipt | undefined,
    snapshotStartedAt: number,
    broadcastAt: number,
    terminal: boolean,
  ): AcpStreamDiagnostic | undefined {
    const observed = this.sessions.get(id);
    if (!receipt || !observed) return undefined;
    const now = this.now();
    const sample =
      terminal ||
      observed.broadcastEntry !== receipt.entryIndex ||
      (observed.receivedSampleRevision <= receipt.receivedRevision &&
        observed.receivedSampleRevision > (observed.broadcastRevision ?? -1)) ||
      (observed.broadcastRevision !== receipt.receivedRevision &&
        now - (observed.broadcastSample ?? -Infinity) >= 1000);
    if (terminal && observed.receipt.receivedRevision <= revision) this.sessions.delete(id);
    if (!sample) return undefined;
    observed.broadcastSample = now;
    observed.broadcastEntry = receipt.entryIndex;
    observed.broadcastRevision = receipt.receivedRevision;
    const trace = { ...receipt, snapshotStartedAt, broadcastAt };
    return this.writer.record("broadcast", id, revision, trace) ? trace : undefined;
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }
  clear(): void {
    this.sessions.clear();
  }
}
