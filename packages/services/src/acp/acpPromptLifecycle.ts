import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { AcpStopReason } from "@zcode/shared";
import type { AcpUpdate } from "./acpServiceImpl.js";
import { projectAcpSessionFailure } from "./acpSessionFailures.js";

/** 仅隔离同一 stdio 连接的协议回调；Host 仍唯一拥有轮次、队列和持久终态。 */
export class AcpPromptLifecycle {
  private token: object | undefined;
  lastStopReason: AcpStopReason | undefined;
  private readonly pendingUpdates = new Set<Promise<void>>();

  constructor(private readonly onUpdate: (update: AcpUpdate) => Promise<void>) {}

  get accepting(): boolean {
    return this.token !== undefined;
  }

  update(update: AcpUpdate): Promise<void> {
    const sessionMetadata =
      update.kind === "config" || update.kind === "mode" || update.kind === "context_usage";
    // 修复原因：复用连接时空闲/取消期间的正文必须隔离，会话配置与容量仍持续更新。
    if (!this.token && !sessionMetadata) return Promise.resolve();
    const task = this.onUpdate(update);
    this.pendingUpdates.add(task);
    void task.finally(() => this.pendingUpdates.delete(task)).catch(() => {});
    return task;
  }

  cancel(): void {
    this.token = undefined;
  }

  async authorize(update: AcpUpdate, ask: () => Promise<string | null>): Promise<string | null> {
    const token = this.token;
    if (!token) return null;
    await this.update(update);
    // 工具信息写盘可能跨越取消/终态；旧权限不能在下一轮重新成为可回答的请求。
    return this.token === token ? ask() : null;
  }

  async run(request: () => Promise<PromptResponse>): Promise<PromptResponse> {
    const token = {};
    this.token = token;
    this.lastStopReason = undefined;
    try {
      const response = await request();
      this.lastStopReason = response.stopReason;
      const failure = projectAcpSessionFailure(response._meta);
      if (failure && this.token === token) await this.update({ kind: "failure", failure });
      return response;
    } finally {
      if (this.token === token) this.token = undefined;
      // 修复原因：SDK 并发派发通知与响应；终态必须等待此前已进入的异步工具/正文回调。
      await Promise.allSettled(this.pendingUpdates);
    }
  }
}
