import type { SessionId } from "@zcode/contracts";
import { zcodeSessionPurgeParamsSchema, type ZCodeSessionPurgeResult } from "@zcode/shared";
import { parseParams, type ZCodeProtocolAgentServerContext } from "./server-types.js";

export async function purgeSession(
  context: ZCodeProtocolAgentServerContext,
  raw: unknown,
): Promise<ZCodeSessionPurgeResult> {
  const params = parseParams(zcodeSessionPurgeParamsSchema, raw);
  const store = context.deps.sessionStore;
  if (!store?.purgeSession) throw new Error("Session store does not support permanent deletion");
  const operation = async (): Promise<ZCodeSessionPurgeResult> => {
    await context.sessionResidentPool?.waitForDeactivation(params.sessionId);
    const record = context.sessions.get(params.sessionId);
    if (
      record &&
      (record.workspace.workspaceKey !== params.workspace.workspaceKey ||
        record.workspace.workspacePath !== params.workspace.workspacePath)
    )
      throw new Error("Session does not belong to this workspace");
    if (
      (record &&
        (record.activeAbortController ||
          record.residencyFinalizationCount ||
          record.app.runtime.hasResidencyBlockingWork())) ||
      context.v4Interactions.hasPendingForSession(params.sessionId) ||
      context.v4Gateway?.hasResidencyBlockingCommands(params.sessionId)
    )
      return { status: "busy" };
    const input = {
      sessionID: params.sessionId as SessionId,
      workspaceID: params.workspace.workspaceKey,
      directory: params.workspace.workspacePath,
    };
    context.purgingSessionIds ??= new Set();
    context.purgingSessionIds.add(params.sessionId);
    try {
      const preflight = await store.purgeSession!({ ...input, checkOnly: true });
      if (preflight === "busy") return { status: "busy" };
      // 修复原因：app.close 会排空 telemetry 等持久写，必须先完成，不能在删库后写回旧会话。
      await record?.app.close?.();
      const retainedUris = (await store.retainedSessionArtifactUris?.(input.sessionID)) ?? [];
      await context.deps.purgeSessionArtifacts?.(params.sessionId, retainedUris);
      const status = await store.purgeSession!(input);
      if (status === "busy") return { status };
      // 持久事务成功后，先发布 removed 再摘 registry；独立子会话不随父记录删除。
      context.v4Gateway?.purgeSessionState(params.sessionId, params.workspace.workspaceKey);
      if (record) {
        record.unsubscribe?.();
        context.sessions.delete(params.sessionId);
        await record.eventStore.deleteSession(params.sessionId as SessionId);
      }
      context.logger?.info("Conversation permanently deleted", {
        event: "zcode_protocol.session.purged",
        sessionId: params.sessionId,
      });
      return { status: "deleted" };
    } finally {
      context.purgingSessionIds.delete(params.sessionId);
    }
  };
  const lifecycle = () =>
    context.sessionLifecycleGate
      ? context.sessionLifecycleGate.run(params.sessionId, operation)
      : operation();
  return context.v4Gateway
    ? context.v4Gateway.withSessionMaintenance(params.sessionId, lifecycle)
    : lifecycle();
}
