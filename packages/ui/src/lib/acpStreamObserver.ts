import {
  acpStreamDiagnosticSchema,
  type AcpSession,
  type AcpStreamDiagnostic,
} from "@zcode/shared";
import { StreamDiagnostics, type StreamDiagnostic } from "@zcode/rpc";
import { logger } from "@/logger.js";

interface Received {
  trace: AcpStreamDiagnostic;
  uiReceivedAt: number;
  committed: boolean;
}
interface Options {
  write?: (record: StreamDiagnostic) => void;
  now?: () => number;
  visible?: () => boolean;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (id: number) => void;
  listenVisibility?: (changed: () => void) => () => void;
}
const streamWriter = new StreamDiagnostics(
  (record) => logger.lifecycle.info("[diagnostics]", record),
  "renderer-acp-stream",
);

/** 快照对象上的取证元数据；不缓存正文、不写 React/store 状态。 */
export class AcpStreamObserver {
  private readonly receivedSnapshots = new WeakMap<AcpSession, Received>();
  private latest?: { id: string; revision: number };
  private frame?: number;
  private pendingCleanup?: () => void;
  private readonly writer: StreamDiagnostics;
  private readonly now: () => number;
  private readonly visible: () => boolean;
  private readonly requestFrame: (callback: () => void) => number;
  private readonly cancelFrame: (id: number) => void;
  private readonly listenVisibility: (changed: () => void) => () => void;

  constructor(options: Options = {}) {
    this.now = options.now ?? Date.now;
    this.visible =
      options.visible ??
      (() => typeof document !== "undefined" && document.visibilityState === "visible");
    this.requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
    this.listenVisibility =
      options.listenVisibility ??
      ((changed) => {
        if (typeof document === "undefined") return () => {};
        document.addEventListener("visibilitychange", changed);
        return () => document.removeEventListener("visibilitychange", changed);
      });
    this.writer = options.write
      ? new StreamDiagnostics(options.write, "renderer-acp-stream", { wallNow: this.now })
      : streamWriter;
  }

  received(session: AcpSession, raw: unknown): void {
    if (this.latest?.id === session.id && this.latest.revision >= session.revision) return;
    this.cancelPendingFrame();
    this.latest = { id: session.id, revision: session.revision };
    const parsed = acpStreamDiagnosticSchema.safeParse(raw);
    if (!parsed.success || parsed.data.receivedRevision > session.revision) return;
    const observation = { trace: parsed.data, uiReceivedAt: this.now(), committed: false };
    this.receivedSnapshots.set(session, observation);
    this.writer.record("ui-received", session.id, session.revision, {
      ...observation.trace,
      uiReceivedAt: observation.uiReceivedAt,
    });
  }

  commit(session: AcpSession | null, isCurrent: () => boolean = () => true): () => void {
    this.cancelPendingFrame();
    const observation = session ? this.receivedSnapshots.get(session) : undefined;
    if (
      !session ||
      !observation ||
      observation.committed ||
      !isCurrent() ||
      this.latest?.id !== session.id ||
      this.latest.revision !== session.revision
    )
      return () => {};
    observation.committed = true;
    const commitAt = this.now();
    this.writer.record("ui-commit", session.id, session.revision, {
      ...observation.trace,
      uiReceivedAt: observation.uiReceivedAt,
      commitAt,
      elapsedMs: Math.max(0, commitAt - observation.uiReceivedAt),
    });
    let live = true;
    let removeVisibility: (() => void) | undefined;
    const cleanup = () => {
      live = false;
      try {
        removeVisibility?.();
      } catch {
        /* diagnostics only */
      }
      if (this.pendingCleanup === cleanup) {
        this.pendingCleanup = undefined;
        if (this.frame !== undefined) {
          try {
            this.cancelFrame(this.frame);
          } catch {
            /* diagnostics only */
          }
          this.frame = undefined;
        }
      }
    };
    this.pendingCleanup = cleanup;
    const current = () =>
      live &&
      isCurrent() &&
      this.visible() &&
      this.latest?.id === session.id &&
      this.latest.revision === session.revision;
    try {
      removeVisibility = this.listenVisibility(() => {
        if (!this.visible()) cleanup();
      });
      if (current())
        this.frame = this.requestFrame(() => {
          this.frame = undefined;
          if (!current()) {
            cleanup();
            return;
          }
          // 两次 rAF 是提交后的帧机会；不能把这个时间点称为真实像素 paint。
          try {
            this.frame = this.requestFrame(() => {
              this.frame = undefined;
              if (!current()) {
                cleanup();
                return;
              }
              const frameAt = this.now();
              this.writer.record("frame-opportunity", session.id, session.revision, {
                ...observation.trace,
                uiReceivedAt: observation.uiReceivedAt,
                commitAt,
                frameAt,
                elapsedMs: Math.max(0, frameAt - observation.uiReceivedAt),
              });
              cleanup();
            });
          } catch {
            cleanup();
          }
        });
      else cleanup();
    } catch {
      cleanup();
    }
    return cleanup;
  }

  private cancelPendingFrame(): void {
    this.pendingCleanup?.();
    if (this.frame !== undefined) {
      try {
        this.cancelFrame(this.frame);
      } catch {
        /* diagnostics only */
      }
    }
    this.frame = undefined;
  }
}
