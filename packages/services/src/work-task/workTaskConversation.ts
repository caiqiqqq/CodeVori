import type { WorkTask } from "@zcode/shared";
import { uuidv7, workTaskExecutionPath } from "@zcode/shared";
import type { ConversationTelemetryFact } from "@zcode/shared/zcode-protocol-v4";
import type { WorkTaskConversationEvent, WorkTaskConversationPort } from "../session/contract.js";
import type { IAcpService } from "../acp/acpService.js";
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import {
  createZCodeAgentConnectionScope,
  type ZCodeAgentConnectionScope,
} from "../zcode-agent/zcodeAgentConnectionScope.js";

interface Dependencies {
  acp: IAcpService;
  agent: IZCodeAgentService;
  createNativeConnection?: (task: WorkTask) => ZCodeAgentConnectionScope;
}

export function createWorkTaskConversation(deps: Dependencies): WorkTaskConversationPort {
  return {
    watch(task, listener) {
      const workspacePath = workTaskExecutionPath(task);
      const session = task.session;
      if (!workspacePath || !session || task.workspaceIdentity || task.remoteSessionId)
        return { dispose() {} };
      const target = { workspacePath };
      if (session.kind === "acp") {
        let revision = -1;
        return deps.acp.onDynamicSessionChanged(target)((change) => {
          if (change.kind !== "updated") return;
          const snapshot = change.session;
          if (
            snapshot.id !== session.id ||
            snapshot.workspacePath !== workspacePath ||
            snapshot.workspaceIdentity ||
            snapshot.remoteSessionId ||
            task.execution.kind !== "acp" ||
            snapshot.agent !== task.execution.agent ||
            snapshot.revision <= revision
          )
            return;
          revision = snapshot.revision;
          const user = snapshot.entries.findLast((entry) => entry.kind === "user");
          if (!user?.id.startsWith("user:") || typeof user.createdAt !== "number") return;
          // status/工具更新不代表新输入；真实 user command 是本轮幂等和迟到事件的边界。
          listener({
            commandId: user.id.slice("user:".length),
            startedAt: user.createdAt,
            status:
              snapshot.status === "running"
                ? snapshot.pendingPermission
                  ? "awaiting_input"
                  : "running"
                : snapshot.status === "interrupted" || snapshot.error
                  ? "failed"
                  : "review",
            ...(snapshot.error ? { error: snapshot.error } : {}),
          });
        });
      }
      let current: (WorkTaskConversationEvent & { turnId?: string }) | null = null;
      const permissions = new Set<string>();
      const facts = deps.agent.onDynamicConversationTelemetryFact(target)(
        (fact: ConversationTelemetryFact) => {
          if (fact.sessionId !== session.id) return;
          if (fact.kind === "turn.started") {
            if (
              !fact.sourceCommandId ||
              fact.executionKind === "controlOnly" ||
              fact.backgroundSource
            )
              return;
            if (current && fact.occurredAt < current.startedAt) return;
            permissions.clear();
            current = {
              commandId: fact.sourceCommandId,
              turnId: fact.turnId,
              startedAt: fact.occurredAt,
              foregroundExecutionId: fact.foregroundExecutionId,
              status: "running",
            };
            listener(current);
            return;
          }
          if (
            !current ||
            (fact.sourceCommandId
              ? fact.sourceCommandId !== current.commandId
              : !fact.turnId || fact.turnId !== current.turnId)
          )
            return;
          if (fact.kind === "permission.lifecycle" && !fact.background && !fact.childSessionId) {
            const key = fact.requestId ?? fact.toolCallId;
            if (fact.phase === "requested") permissions.add(key);
            else permissions.delete(key);
            listener({ ...current, status: permissions.size ? "awaiting_input" : "running" });
          } else if (fact.kind === "turn.terminal") {
            listener({
              ...current,
              status: fact.status === "success" ? "review" : "failed",
              ...(fact.status !== "success"
                ? { error: fact.errorMessage || fact.errorCode || "work-task.agent-interrupted" }
                : {}),
            });
          }
        },
      );
      const lifecycle = deps.agent.onAgentRuntimeLifecycle?.((event) => {
        if (event.workspaceKey === workspacePath && event.state === "unavailable" && current) {
          listener({ ...current, status: "failed", error: "work-task.agent-disconnected" });
          current = null;
          permissions.clear();
        }
      });
      return {
        dispose() {
          facts.dispose();
          lifecycle?.dispose();
        },
      };
    },
    async stop(task, event) {
      const workspacePath = workTaskExecutionPath(task);
      const session = task.session;
      if (!workspacePath || !session) throw new Error("work-task.binding-invalid");
      if (session.kind === "acp") {
        await deps.acp.stop({ workspacePath, id: session.id, expectedCommandId: event.commandId });
        return;
      }
      // 普通会话发送的 runtime 身份来自实际开始事实，不用无条件 stop 误杀后续轮次。
      if (!event.foregroundExecutionId) throw new Error("work-task.stop-target-unavailable");
      const clientId = `work-task-observer-${task.id}`;
      const connection =
        deps.createNativeConnection?.(task) ??
        createZCodeAgentConnectionScope(deps.agent, {
          connectionId: `${clientId}:${task.runSeq}`,
          clientMode: "desktop-continuous",
        });
      try {
        const agent = connection.service;
        const hello = await agent.helloConversationV4();
        await agent.initializeConversationV4({
          kind: "clientHello",
          protocolVersion: hello.protocolVersion,
          clientId,
          clientKind: "desktop",
          appVersion: "work-tasks",
        });
        const ack = await agent.sendConversationCommandV4({
          workspacePath,
          envelope: {
            type: "stop",
            commandId: uuidv7(),
            sessionId: session.id,
            clientId,
            issuedAt: Date.now(),
            payload: { expectedForegroundExecutionId: event.foregroundExecutionId },
          },
        });
        if (
          !["accepted", "duplicate"].includes(ack.status) &&
          ack.reasonCode !== "guard.stopTargetChanged"
        )
          throw new Error(ack.message || ack.reasonCode || "work-task.stop-rejected");
      } finally {
        await connection.dispose();
      }
    },
  };
}
