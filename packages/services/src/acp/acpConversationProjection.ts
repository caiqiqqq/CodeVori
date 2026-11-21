import { randomUUID } from "node:crypto";
import { createServiceLogger } from "../logger/serviceLogger.js";
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

const logger = createServiceLogger("acp-conversation-projection");
const PROJECTION_SIZE_LOG_INTERVAL_ROWS = 5_000;

/** 只投影已保存快照；无 admission、Agent 或文件写入能力。 */
export class AcpConversationProjection {
  private snapshot: ConversationSnapshot;
  private lastUserIndex: number;
  private logicalOrdinal = 0;
  private lastReportedRowCount = 0;

  constructor(session: AcpSession, epoch: string) {
    this.lastUserIndex = session.entries.findLastIndex((entry) => entry.kind === "user");
    this.snapshot = createInitialConversationSnapshot(session.id, `${epoch}:${session.id}`);
    const rows = buildAcpConversationRows(session);
    this.replace(session, rows);
    this.reportProjectionSize(session, rows, "initialized");
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
    this.reportProjectionSize(session, this.snapshot.rows.window, "growth");
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

  private reportProjectionSize(
    session: AcpSession,
    rows: readonly ConversationRow[],
    reason: "initialized" | "growth",
  ): void {
    if (
      reason !== "initialized" &&
      rows.length - this.lastReportedRowCount < PROJECTION_SIZE_LOG_INTERVAL_ROWS
    )
      return;
    this.lastReportedRowCount = rows.length;
    const memory = process.memoryUsage();
    logger.info(undefined, "ACP conversation projection size", {
      event: "acp.conversation_projection.size",
      reason,
      sessionId: session.id,
      entryCount: session.entries.length,
      projectedRowCount: rows.length,
      heapUsedBytes: memory.heapUsed,
      rssBytes: memory.rss,
    });
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

  rowsRange(beforeRowId: number | undefined, limit: number, navigationOnly = false) {
    // 修复原因：导航只需身份与短预览，不能经 IPC/relay 重传全部历史工具输出。
    // 倒序扫描到一页+1 即停止，避免每页 filter 整份历史产生临时数组。
    const rows: ConversationRow[] = [];
    const count = Math.min(limit, PROTOCOL_V4_LIMITS.rowsRangeMaxLimit);
    let hasMore = false;
    for (let index = this.snapshot.rows.window.length - 1; index >= 0; index--) {
      const row = this.snapshot.rows.window[index]!;
      if (beforeRowId !== undefined && row.rowId >= beforeRowId) continue;
      if (
        navigationOnly &&
        row.kind !== "assistantText" &&
        !(row.kind === "userInput" && row.origin === "realUser")
      )
        continue;
      if (rows.length === count) {
        hasMore = true;
        break;
      }
      if (navigationOnly && (row.kind === "assistantText" || row.kind === "userInput")) {
        const base = {
          rowId: row.rowId,
          turnId: row.turnId,
          createdAt: row.createdAt,
          createdAtSeq: row.createdAtSeq,
          productTurnId: row.productTurnId,
          text: row.text.slice(0, 220),
        };
        rows.push(
          row.kind === "userInput"
            ? { ...base, kind: "userInput", origin: row.origin }
            : { ...base, kind: "assistantText", state: row.state },
        );
      } else rows.push(row);
    }
    rows.reverse();
    return {
      rows,
      atSeq: this.snapshot.seq,
      atRevision: this.snapshot.revision,
      atLogEpoch: this.snapshot.logEpoch,
      hasMore,
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
