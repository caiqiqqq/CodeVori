export type StreamDiagnosticStage =
  | "received"
  | "broadcast"
  | "ui-received"
  | "ui-commit"
  | "frame-opportunity";

const factKeys = [
  "receivedRevision",
  "receivedAt",
  "snapshotStartedAt",
  "broadcastAt",
  "chunkChars",
  "entryIndex",
  "entryCount",
  "gapMs",
  "uiReceivedAt",
  "commitAt",
  "frameAt",
  "elapsedMs",
] as const;
type Facts = Partial<Record<(typeof factKeys)[number], number>>;
type StreamKind = "text" | "thought" | "compaction_summary";
export interface StreamDiagnostic {
  scope: "acp-host-stream" | "renderer-acp-stream";
  stage: StreamDiagnosticStage;
  sessionId: string;
  revision: number;
  timestamp: number;
  kind?: StreamKind;
  suppressed: number;
  facts: Facts;
}

/** 有界元数据旁路；不读取业务载荷，不创建 timer，不等待日志 IO。 */
export class StreamDiagnostics {
  private started: number;
  private written = 0;
  private suppressed = 0;
  private readonly now: () => number;
  private readonly wallNow: () => number;

  constructor(
    private readonly write: (record: StreamDiagnostic) => void,
    private readonly scope: StreamDiagnostic["scope"],
    options: { now?: () => number; wallNow?: () => number } = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.wallNow = options.wallNow ?? Date.now;
    this.started = this.now();
  }

  record(
    stage: StreamDiagnosticStage,
    sessionId: string,
    revision: number,
    facts: Facts & { kind?: StreamKind },
  ): boolean {
    // 修复依据：记录只能关联 Host 生成的 UUID；不能把路径或上游 messageId 当日志 key。
    if (
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId) ||
      !Number.isSafeInteger(revision) ||
      revision < 0
    )
      return false;
    try {
      const now = this.now();
      if (now - this.started >= 60000) {
        this.started = now;
        this.written = 0;
      }
      if (this.written >= 240) {
        this.suppressed++;
        return false;
      }
      this.written++;
      const safeFacts: Facts = {};
      for (const key of factKeys) {
        const value = facts[key];
        if (typeof value === "number" && Number.isFinite(value)) safeFacts[key] = value;
      }
      this.write({
        scope: this.scope,
        stage,
        sessionId,
        revision,
        timestamp: this.wallNow(),
        suppressed: this.suppressed,
        facts: safeFacts,
        ...(["text", "thought", "compaction_summary"].includes(facts.kind ?? "")
          ? { kind: facts.kind }
          : {}),
      });
      this.suppressed = 0;
      return true;
    } catch {
      // 诊断 sink 失败不能改变正文保存、通知派发或 React commit。
      return false;
    }
  }
}
