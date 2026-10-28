import type { IAcpService } from "@zcode/services";
import {
  acpCommandReceiptSchema,
  PhaseTimer,
  type AcpPromptInput,
  type AcpCommandReceipt,
  type AcpWorkspace,
} from "@zcode/shared";
import { logger } from "../logger.js";

export const ACP_HOST_UPGRADE_REQUIRED = "ACP_HOST_UPGRADE_REQUIRED";

function acceptedReceipt(
  value: unknown,
  workspace: AcpWorkspace,
  input: AcpWorkspace & { id: string } & AcpPromptInput,
): AcpCommandReceipt {
  const session = acpCommandReceiptSchema.parse(value);
  const matchesTarget =
    session.id === input.id &&
    session.workspacePath === workspace.workspacePath &&
    (session.workspaceIdentity?.trim() || session.workspacePath) ===
      (workspace.workspaceIdentity?.trim() || workspace.workspacePath) &&
    session.remoteSessionId === workspace.remoteSessionId;
  // 修复依据：Host 只在持久化后返回命令回执；不能再把整段历史作为接受凭证传输。
  const commandId = input.commandId.trim();
  const admitted =
    session.commandId === commandId &&
    session.ack.commandId === commandId &&
    (session.ack.status === "accepted" || session.ack.status === "duplicate");
  if (!matchesTarget || !admitted) throw new Error("ACP prompt was not admitted");
  return session;
}

/** Direct durable Host ACK; session notifications are projections, never the send completion boundary. */
export async function waitForAcpPromptAdmission(
  service: Pick<IAcpService, "sendConversationCommand" | "queryConversationCommand">,
  workspace: AcpWorkspace,
  input: AcpWorkspace & { id: string } & AcpPromptInput,
): Promise<AcpCommandReceipt> {
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
      const { commandId, id, workspacePath, workspaceIdentity, remoteSessionId, ...payload } =
        input;
      const reply = await service.sendConversationCommand({
        id,
        workspacePath,
        workspaceIdentity,
        remoteSessionId,
        commandId,
        type: "sendText",
        payload,
      });
      timing.phase("receipt_validate");
      const receipt = acceptedReceipt(reply, workspace, input);
      status = "accepted";
      return receipt;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // 旧远端缺少接口时不能回退整轮 prompt，更不能生成另一个 command 自动重发。
      if (
        /Method not found: sendConversationCommand|sendConversationCommand is not a function/.test(
          detail,
        )
      )
        throw new Error(ACP_HOST_UPGRADE_REQUIRED);
      // ACK 丢失不能证明未接受；按原 commandId 查询持久凭证，未知时保留草稿。
      try {
        timing.phase("ack_recovery_read");
        const reply = await service.queryConversationCommand({
          ...workspace,
          id: input.id,
          commandId: input.commandId.trim(),
        });
        timing.phase("recovery_validate");
        const receipt = acceptedReceipt(reply, workspace, input);
        status = "recovered";
        return receipt;
      } catch {
        throw error;
      }
    }
  } finally {
    timing.finish(status);
  }
}
