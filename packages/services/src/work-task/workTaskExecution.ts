import { commitWorkTaskExecution as commit } from "./workTaskExecutionState.js";
import { prepareWorkTaskWorktree } from "./workTaskWorktree.js";
import { uuidv7, type WorkTask } from "@zcode/shared";
import {
  applyConversationDeltas,
  conversationTopicFrameSchema,
  TopicWireFrameAssembler,
  type CommandEnvelope,
  type ConversationSnapshot,
} from "@zcode/shared/zcode-protocol-v4";
import type { IAcpService } from "../acp/acpService.js";
import type { IGitService } from "../git/git.js";
import type { ISettingService } from "../setting/setting.js";
import type { WorkTaskExecutionContext, WorkTaskExecutionPort } from "../session/contract.js";
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import {
  createZCodeAgentConnectionScope,
  type ZCodeAgentConnectionScope,
} from "../zcode-agent/zcodeAgentConnectionScope.js";

interface Dependencies {
  git: IGitService;
  settings: ISettingService;
  acp: IAcpService;
  agent: IZCodeAgentService;
  ensureWorkspaceSubscription(target: { workspacePath: string }): void;
  homeDirectory?: string;
  /** Tests can replace the transport, not the task ownership/admission rules. */
  createNativeConnection?: (task: WorkTask) => ZCodeAgentConnectionScope;
}

function abortError() {
  return new Error("work-task.canceled");
}

async function executeAcp(
  deps: Dependencies,
  task: WorkTask,
  context: WorkTaskExecutionContext,
  workspacePath: string,
) {
  if (task.execution.kind !== "acp") throw new Error("work-task.executor-invalid");
  const target = { workspacePath };
  context.signal.throwIfAborted();
  if (task.session) {
    const existing = (await deps.acp.list(target)).find(
      (session) => session.id === task.session?.id,
    );
    if (!existing) throw new Error("work-task.session-not-found");
    if (existing.agent !== task.execution.agent) throw new Error("work-task.binding-invalid");
    if (existing.status === "running" || existing.pendingPermission)
      throw new Error("work-task.session-busy");
    context.signal.throwIfAborted();
  }
  const id =
    task.session?.id ??
    (
      await deps.acp.create({
        ...target,
        agent: task.execution.agent,
        requestId: task.sessionRequestId,
      })
    ).id;
  let stop: Promise<void> | undefined;
  let rejectAbort!: (reason: Error) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  void aborted.catch(() => {});
  const onAbort = () => {
    stop ??= deps.acp.stop({ ...target, id });
    void stop.catch(() => {});
    rejectAbort(abortError());
  };
  context.signal.addEventListener("abort", onAbort, { once: true });
  const listener = deps.acp.onDynamicSessionChanged(target)((change) => {
    if (change.kind !== "updated" || change.session.id !== id || context.signal.aborted) return;
    if (change.session.status === "running") {
      void commit(context, {
        status: change.session.pendingPermission ? "awaiting_input" : "running",
      }).catch(rejectAbort);
    }
  });
  try {
    if (context.signal.aborted) {
      onAbort();
      throw abortError();
    }
    if (!task.session) await commit(context, { session: { kind: "acp", id } });
    for (const option of task.execution.config) {
      context.signal.throwIfAborted();
      await deps.acp.setConfigOption({ ...target, id, ...option });
    }
    await commit(context, { status: "running" });
    const session = await Promise.race([
      deps.acp.prompt({
        ...target,
        id,
        text: task.runText,
        commandId: task.commandId,
        attachments: [],
        workspaceFiles: [],
      }),
      aborted,
    ]);
    context.signal.throwIfAborted();
    if (session.error || session.status === "interrupted")
      throw new Error(session.error || "work-task.agent-interrupted");
    if (session.status !== "idle") throw new Error("work-task.session-busy");
  } finally {
    listener.dispose();
    context.signal.removeEventListener("abort", onAbort);
    if (stop) await stop;
  }
}

async function executeApi(
  deps: Dependencies,
  task: WorkTask,
  context: WorkTaskExecutionContext,
  workspacePath: string,
) {
  if (task.execution.kind !== "api") throw new Error("work-task.executor-invalid");
  const target = { workspacePath };
  const clientId = `work-task-${task.id}`;
  const connection =
    deps.createNativeConnection?.(task) ??
    createZCodeAgentConnectionScope(deps.agent, {
      connectionId: `${clientId}:${task.runSeq}`,
      clientMode: "desktop-continuous",
    });
  try {
    await executeApiConnection(deps, task, context, target, clientId, connection);
  } finally {
    await connection.dispose();
  }
}

async function executeApiConnection(
  deps: Dependencies,
  task: WorkTask,
  context: WorkTaskExecutionContext,
  target: { workspacePath: string },
  clientId: string,
  connection: ZCodeAgentConnectionScope,
) {
  if (task.execution.kind !== "api") throw new Error("work-task.executor-invalid");
  const agent = connection.service;
  context.signal.throwIfAborted();
  const hello = await agent.helloConversationV4();
  await agent.initializeConversationV4({
    kind: "clientHello",
    protocolVersion: hello.protocolVersion,
    clientId,
    clientKind: "desktop",
    appVersion: "work-tasks",
  });
  const command = (
    type: CommandEnvelope["type"],
    commandId: string,
    sessionId: string | null,
    payload: unknown,
  ) =>
    agent.sendConversationCommandV4({
      ...target,
      envelope: { type, commandId, sessionId, clientId, issuedAt: Date.now(), payload },
    });
  let id = task.session?.id;
  let stop: Promise<unknown> | undefined;
  let dispatched = false;
  let settled = false;
  let foregroundExecutionId: string | undefined;
  let ownedTurnId: string | undefined;
  let resolveTerminal!: () => void;
  let rejectTerminal!: (error: Error) => void;
  const terminal = new Promise<void>((resolveResult, reject) => {
    resolveTerminal = resolveResult;
    rejectTerminal = reject;
  });
  void terminal.catch(() => {});
  let resolveInitial!: (snapshot: ConversationSnapshot) => void;
  let rejectInitial!: (error: Error) => void;
  const initial = new Promise<ConversationSnapshot>((resolveResult, reject) => {
    resolveInitial = resolveResult;
    rejectInitial = reject;
  });
  void initial.catch(() => {});
  const fail = (cause: unknown) => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    rejectInitial(error);
    rejectTerminal(error);
  };
  const onAbort = () => {
    if (id && dispatched && !settled) {
      // 只停止实际看见的前台执行；不能用无条件 Stop 误杀晚到的用户新轮次。
      stop ??= foregroundExecutionId
        ? command("stop", uuidv7(), id, {
            expectedForegroundExecutionId: foregroundExecutionId,
          }).then((ack) => {
            if (
              !["accepted", "duplicate"].includes(ack.status) &&
              ack.reasonCode !== "guard.stopTargetChanged"
            )
              throw new Error(ack.message || ack.reasonCode || "work-task.stop-rejected");
          })
        : Promise.reject(new Error("work-task.stop-target-unavailable"));
      void stop.catch(() => {});
    }
    fail(abortError());
  };
  const telemetry = agent.onDynamicConversationTelemetryFact(target)((fact) => {
    if (settled || context.signal.aborted || fact.sessionId !== id) return;
    if (fact.kind === "turn.started" && fact.sourceCommandId === task.commandId)
      ownedTurnId = fact.turnId;
    const owned =
      fact.sourceCommandId === task.commandId || (ownedTurnId && fact.turnId === ownedTurnId);
    if (!owned || fact.kind !== "turn.terminal") return;
    settled = true;
    if (fact.status === "success") resolveTerminal();
    else
      rejectTerminal(
        new Error(fact.errorMessage || fact.errorCode || "work-task.agent-interrupted"),
      );
  });
  const lifecycle = deps.agent.onAgentRuntimeLifecycle?.((event) => {
    if (event.workspaceKey === target.workspacePath && event.state === "unavailable")
      fail(new Error("work-task.agent-disconnected"));
  });
  const assembler = new TopicWireFrameAssembler(conversationTopicFrameSchema);
  let snapshot: ConversationSnapshot | null = null;
  const readSnapshot = () => snapshot;
  let subscriptionId: string | undefined;
  let resync: Promise<unknown> | null = null;
  const requestSnapshot = () => {
    if (!subscriptionId || resync || settled || context.signal.aborted) return;
    resync = agent
      .resyncConversationV4({ ...target, subscriptionId, base: null, forceSnapshot: true })
      .catch(fail)
      .finally(() => {
        resync = null;
      });
  };
  const frames = agent.onDynamicConversationFrame(target)((wire) => {
    if (
      settled ||
      context.signal.aborted ||
      wire.topic !== `conversation/${id}` ||
      (subscriptionId && wire.subscriptionId !== subscriptionId)
    )
      return;
    for (const event of assembler.accept(wire)) {
      if (event.kind === "fault") {
        requestSnapshot();
        continue;
      }
      const frame = event.frame;
      if (frame.payload.kind === "snapshot") {
        if (frame.payload.snapshot.sessionId !== id || frame.payload.snapshot.seq !== frame.toSeq) {
          fail(new Error("work-task.snapshot-invalid"));
          continue;
        }
        snapshot = frame.payload.snapshot;
        resolveInitial(snapshot);
      } else if (snapshot && frame.fromSeq === snapshot.seq)
        snapshot = { ...applyConversationDeltas(snapshot, frame.payload.deltas), seq: frame.toSeq };
      else {
        requestSnapshot();
        continue;
      }
      if (dispatched && snapshot) {
        foregroundExecutionId ??= snapshot.control.activeWorks.find(
          (work) => work.foregroundExecutionId,
        )?.foregroundExecutionId;
        const waiting =
          snapshot.pendingInteractions.length > 0 ||
          (snapshot.workspaceHookAdmission?.pendingCount ?? 0) > 0;
        void commit(context, { status: waiting ? "awaiting_input" : "running" }).catch(fail);
      }
    }
  });
  context.signal.addEventListener("abort", onAbort, { once: true });
  try {
    context.signal.throwIfAborted();
    if (!id) {
      const ack = await command("createSession", task.sessionRequestId, null, {
        workspaceId: target.workspacePath,
        config: { modelSelection: task.execution.modelSelection, mode: task.execution.mode },
      });
      if (!["accepted", "duplicate"].includes(ack.status) || ack.result?.type !== "createSession")
        throw new Error(ack.message || ack.reasonCode || "work-task.create-rejected");
      id = ack.result.sessionId;
      await commit(context, { session: { kind: "api", id } });
    }
    deps.ensureWorkspaceSubscription(target);
    const subscription = await agent.subscribeConversationV4({
      ...target,
      sessionId: id,
      visibility: "background",
    });
    subscriptionId = subscription.ack.subscriptionId;
    // Subscribe 只返回 ACK，快照在后续通知到达；不能在空投影上判断会话空闲。
    const firstSnapshot = await initial;
    context.signal.throwIfAborted();
    const current = readSnapshot() ?? firstSnapshot;
    if (
      current.control.phase === "running" ||
      current.control.phase === "prewarming" ||
      current.control.activeWorks.length ||
      current.inputRouting.mode !== "startNow" ||
      current.queue.items.length ||
      current.pendingInteractions.length
    )
      throw new Error("work-task.session-busy");
    await commit(context, { status: "running" });
    dispatched = true;
    const ack = await command("sendText", task.commandId, id, {
      text: task.runText,
      modelSelection: task.execution.modelSelection,
      mode: task.execution.mode,
      planEnabled: task.execution.mode === "plan",
    });
    if (!["accepted", "duplicate"].includes(ack.status))
      throw new Error(ack.message || ack.reasonCode || "work-task.prompt-rejected");
    if (context.signal.aborted) onAbort();
    await terminal;
    context.signal.throwIfAborted();
  } finally {
    telemetry.dispose();
    frames.dispose();
    lifecycle?.dispose();
    context.signal.removeEventListener("abort", onAbort);
    if (stop) await stop;
  }
}

export function createWorkTaskExecution(deps: Dependencies): WorkTaskExecutionPort {
  return {
    async execute(task, context) {
      if (task.workspaceIdentity || task.remoteSessionId)
        throw new Error("work-task.remote-unsupported");
      context.signal.throwIfAborted();
      const worktree = await prepareWorkTaskWorktree(deps, task, context);
      if (task.execution.kind === "acp") await executeAcp(deps, task, context, worktree.path);
      else await executeApi(deps, task, context, worktree.path);
    },
  };
}
