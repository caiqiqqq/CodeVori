import type { IAcpService } from "@zcode/services";
import type { AcpPromptInput, AcpSession, AcpWorkspace } from "@zcode/shared";

function wasAdmitted(session: AcpSession, commandId: string): boolean {
  // 修复依据：排队快照与已发送 user row 都是同一 Host 的持久接受事实。
  return (
    session.entries.some((entry) => entry.id === `user:${commandId}`) ||
    Boolean(
      session.queue?.items.some((item) => item.commandId === commandId) ||
      session.queue?.discardedCommandIds?.includes(commandId),
    )
  );
}

/** Wait for Host admission, not the Agent's potentially long session/prompt turn. */
export function waitForAcpPromptAdmission(
  service: Pick<IAcpService, "onDynamicSessionChanged" | "prompt" | "read">,
  workspace: AcpWorkspace,
  input: AcpWorkspace & { id: string } & AcpPromptInput,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      subscription.dispose();
      if (error !== undefined) reject(error);
      else resolve();
    };
    // 修复原因：Host prompt RPC 要等 Agent 整轮结束；先订阅持久化用户行的 revision，
    // 以 Host admission 为清空输入的边界，避免把运行中失败当作未发送的草稿。
    const subscription = service.onDynamicSessionChanged(workspace)((change) => {
      if (
        change.kind === "updated" &&
        change.session.id === input.id &&
        wasAdmitted(change.session, input.commandId)
      ) {
        finish();
      }
    });
    try {
      void service.prompt(input).then(
        (session) => {
          if (wasAdmitted(session, input.commandId)) finish();
          else finish(new Error("ACP prompt was not admitted"));
        },
        (error: unknown) => {
          // 修复原因：Agent 已接纳后报错时，RPC reject 可能比 renderer 的 revision 通知先到。
          // 先读 Host 权威快照，避免把已发送正文错误地留在草稿中。
          void service.read({ ...workspace, id: input.id }).then(
            (session) => finish(wasAdmitted(session, input.commandId) ? undefined : error),
            () => finish(error),
          );
        },
      );
    } catch (error) {
      finish(error);
    }
  });
}
