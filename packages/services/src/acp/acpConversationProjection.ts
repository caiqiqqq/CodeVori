import { randomUUID } from "node:crypto";
import { buildAcpConversationRows, projectAcpStatusPanel, type AcpSession } from "@zcode/shared";
import {
  coalesceConversationDeltas,
  createInitialConversationSnapshot,
  encodeTopicWireFrames,
  measureTopicNotificationEnvelopeBytes,
  PROTOCOL_V4_LIMITS,
  type ConversationDelta,
  type ConversationRow,
  type ConversationSnapshot,
  type ConversationTopicFrame,
  type TopicFrameDeliveryKind,
} from "@zcode/shared/zcode-protocol-v4";

/** 只投影已保存快照；无 admission、Agent 或文件写入能力。 */
export class AcpConversationProjection {
  private snapshot: ConversationSnapshot;
  private lastUserIndex: number;
  private logicalOrdinal = 0;

  constructor(session: AcpSession, epoch: string) {
    this.lastUserIndex = session.entries.findLastIndex((entry) => entry.kind === "user");
    this.snapshot = createInitialConversationSnapshot(session.id, `${epoch}:${session.id}`);
    this.replace(session, buildAcpConversationRows(session));
  }

  private replace(session: AcpSession, rows: ConversationRow[]): void {
    const status = projectAcpStatusPanel(session);
    this.snapshot = {
      ...this.snapshot,
      seq: session.revision,
      revision: session.revision,
      meta: { title: session.title, titleSource: "default" },
      plan: status.plan,
      backgroundWorks: status.backgroundWorks,
      rows: { window: rows, totalCount: rows.length, firstRowId: rows[0]?.rowId ?? null },
    };
  }

  update(session: AcpSession, streaming = false): ConversationDelta[] {
    if (session.revision <= this.snapshot.seq) return [];
    // 修复依据：流式正文只改变当前轮；避免逐字重新序列化已结束的几千行历史。
    const start = streaming ? Math.max(0, this.lastUserIndex) : 0;
    const prefix = this.snapshot.rows.window.filter((row) => row.createdAtSeq < start);
    const suffix = buildAcpConversationRows(session, start);
    const previous = new Map(
      this.snapshot.rows.window.slice(prefix.length).map((row) => [row.rowId, row]),
    );
    const deltas: ConversationDelta[] = [];
    for (const row of suffix) {
      const older = previous.get(row.rowId);
      previous.delete(row.rowId);
      if (!older) {
        deltas.push({ op: "row.appended", row });
        continue;
      }
      if (
        (row.kind === "assistantText" || row.kind === "reasoning") &&
        older.kind === row.kind &&
        row.text.startsWith(older.text) &&
        JSON.stringify({ ...older, text: undefined }) ===
          JSON.stringify({ ...row, text: undefined })
      ) {
        const append = row.text.slice(older.text.length);
        if (append) deltas.push({ op: "row.delta", rowId: row.rowId, path: "text", append });
      } else if (JSON.stringify(older) !== JSON.stringify(row)) {
        deltas.push({ op: "row.upserted", row });
      }
    }
    if (previous.size) deltas.push({ op: "row.removed", fromRowId: Math.min(...previous.keys()) });
    const oldSnapshot = this.snapshot;
    this.lastUserIndex = session.entries.findLastIndex((entry) => entry.kind === "user");
    this.replace(session, [...prefix, ...suffix]);
    deltas.push({
      op: "state.updated",
      patch: {
        revision: session.revision,
        ...(session.title !== oldSnapshot.meta.title ? { meta: this.snapshot.meta } : {}),
        ...(JSON.stringify(this.snapshot.plan) !== JSON.stringify(oldSnapshot.plan)
          ? { plan: this.snapshot.plan }
          : {}),
        ...(JSON.stringify(this.snapshot.backgroundWorks) !==
        JSON.stringify(oldSnapshot.backgroundWorks)
          ? { backgroundWorks: this.snapshot.backgroundWorks }
          : {}),
      },
    });
    return coalesceConversationDeltas(deltas);
  }

  tail(): ConversationSnapshot {
    return {
      ...this.snapshot,
      rows: {
        ...this.snapshot.rows,
        window: this.snapshot.rows.window.slice(-PROTOCOL_V4_LIMITS.snapshotTailWindowRows),
      },
    };
  }

  rowsRange(beforeRowId: number | undefined, limit: number) {
    const candidates = this.snapshot.rows.window.filter(
      (row) => beforeRowId === undefined || row.rowId < beforeRowId,
    );
    const rows = candidates.slice(-Math.min(limit, PROTOCOL_V4_LIMITS.rowsRangeMaxLimit));
    return {
      rows,
      atSeq: this.snapshot.seq,
      atRevision: this.snapshot.revision,
      atLogEpoch: this.snapshot.logEpoch,
      hasMore: candidates.length > rows.length,
    };
  }

  frame(
    subscriptionId: string,
    deliveryKind: TopicFrameDeliveryKind,
    update?: { fromSeq: number; deltas: ConversationDelta[] },
  ) {
    const frame: ConversationTopicFrame = {
      topic: `conversation/${this.snapshot.sessionId}`,
      subscriptionId,
      fromSeq: update?.fromSeq ?? 0,
      toSeq: this.snapshot.seq,
      sentAt: Date.now(),
      payload: update
        ? { kind: "deltas", deltas: update.deltas }
        : { kind: "snapshot", snapshot: this.tail() },
    };
    return encodeTopicWireFrames(frame, {
      topic: frame.topic,
      subscriptionId,
      deliveryKind,
      logicalFrameId: randomUUID(),
      // recovery 即使没有新 token 也是新帧；复用 seq 会被 assembler 的 tombstone 吞掉。
      logicalFrameOrdinal: ++this.logicalOrdinal,
      measurePhysicalFrameBytes: (wire) => measureTopicNotificationEnvelopeBytes(wire).maxBytes,
    });
  }
}
