import type { CommandAck } from "@zcode/shared/zcode-protocol-v4";

/** 队列操作只走原命令通道；过期时恢复投影，不自动重放有副作用的用户操作。 */
export async function runQueueCommand(options: {
  dispatch(): Promise<CommandAck>;
  isCurrent(): boolean;
  recover(): void;
  onFailure(kind: "stale" | "rejected" | "transport"): void;
}): Promise<CommandAck | null> {
  try {
    const ack = await options.dispatch();
    // 切换会话后的迟到 ACK 不能恢复新 owner，也不能在新会话提示旧操作失败。
    if (!options.isCurrent()) return null;
    if (ack.status === "stale") {
      options.recover();
      options.onFailure("stale");
    } else if (!["accepted", "duplicate", "noop"].includes(ack.status)) {
      options.onFailure("rejected");
    }
    return ack;
  } catch {
    if (options.isCurrent()) options.onFailure("transport");
    return null;
  }
}
