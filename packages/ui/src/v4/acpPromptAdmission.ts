import type { IAcpService } from "@zcode/services";
import {
  acpSessionSchema,
  PhaseTimer,
  type AcpPromptInput,
  type AcpSession,
  type AcpWorkspace,
} from "@zcode/shared";
import { logger } from "../logger.js";

export const ACP_HOST_UPGRADE_REQUIRED = "ACP_HOST_UPGRADE_REQUIRED";

function acceptedSnapshot(
  value: unknown,
  workspace: AcpWorkspace,
  input: AcpWorkspace & { id: string } & AcpPromptInput,
): AcpSession {
  const session = acpSessionSchema.parse(value);
  const matchesTarget =
    session.id === input.id &&
    session.workspacePath === workspace.workspacePath &&
    (session.workspaceIdentity?.trim() || session.workspacePath) ===
      (workspace.workspaceIdentity?.trim() || workspace.workspacePath) &&
    session.remoteSessionId === workspace.remoteSessionId;
  // 修复依据：只有同一 Host 持久化的 user row、排队项或删除凭证可以确认这次 command。
  const commandId = input.commandId.trim();
  const admitted =
    session.entries.some((entry) => entry.id === `user:${commandId}`) ||
    session.queue.items.some((item) => item.commandId === commandId) ||
    session.queue.discardedCommandIds?.includes(commandId);
  if (!matchesTarget || !admitted) throw new Error("ACP prompt was not admitted");
  return session;
}

/** Direct durable Host ACK; session notifications are projections, never the send completion boundary. */
export async function waitForAcpPromptAdmission(
  service: Pick<IAcpService, "submitPrompt" | "read">,
  workspace: AcpWorkspace,
  input: AcpWorkspace & { id: string } & AcpPromptInput,
): Promise<AcpSession> {
  const timing = new PhaseTimer(
    {
      scope: "ui.acp_ack",
      sessionId: input.id,
      commandId: input.commandId,
      commandType: "sendText",
    },
    (record) => logger.lifecycle.info("[latency]", record),
  );
  let status = "failed";
  try {
    timing.phase("host_rpc");
    try {
      const reply = await service.submitPrompt(input);
      timing.phase("receipt_validate");
      const snapshot = acceptedSnapshot(reply, workspace, input);
      timing.setFacts({
        entries: snapshot.entries.length,
        queueItems: snapshot.queue.items.length,
      });
      status = "accepted";
      return snapshot;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // 旧远端缺少接口时不能回退整轮 prompt，更不能生成另一个 command 自动重发。
      if (/Method not found: submitPrompt|submitPrompt is not a function/.test(detail))
        throw new Error(ACP_HOST_UPGRADE_REQUIRED);
      // ACK 丢失不能证明未接受；读权威快照对账，仍未知时保留原 commandId 和草稿。
      try {
        timing.phase("ack_recovery_read");
        const reply = await service.read({ ...workspace, id: input.id });
        timing.phase("recovery_validate");
        const snapshot = acceptedSnapshot(reply, workspace, input);
        status = "recovered";
        return snapshot;
      } catch {
        throw error;
      }
    }
  } finally {
    timing.finish(status);
  }
}
