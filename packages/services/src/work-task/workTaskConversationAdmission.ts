import type { WorkTask } from "@zcode/shared";
import {
  conversationTopicFrameSchema,
  TopicWireFrameAssembler,
  type ConversationSnapshot,
  type ConversationTopicWireCandidate,
} from "@zcode/shared/zcode-protocol-v4";
import type { IAcpService } from "../acp/acpService.js";
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import {
  createZCodeAgentConnectionScope,
  type ZCodeAgentConnectionScope,
} from "../zcode-agent/zcodeAgentConnectionScope.js";

export function assertWorkTaskNativeIdle(current: ConversationSnapshot) {
  if (
    current.control.phase === "running" ||
    current.control.phase === "prewarming" ||
    current.control.activeWorks.length ||
    current.inputRouting.mode !== "startNow" ||
    current.queue.items.length ||
    current.pendingInteractions.length
  )
    throw new Error("work-task.session-busy");
}

export async function assertWorkTaskSourceIdle(
  deps: {
    acp: IAcpService;
    agent: IZCodeAgentService;
    createNativeConnection?: (task: WorkTask) => ZCodeAgentConnectionScope;
  },
  task: WorkTask,
  signal: AbortSignal,
) {
  if (!task.session || !task.worktree) throw new Error("work-task.binding-invalid");
  const target = { workspacePath: task.worktree.path };
  signal.throwIfAborted();
  if (task.session.kind === "acp") {
    const session = (await deps.acp.list(target)).find((item) => item.id === task.session?.id);
    if (!session) throw new Error("work-task.session-not-found");
    if (task.execution.kind !== "acp" || session.agent !== task.execution.agent)
      throw new Error("work-task.binding-invalid");
    if (session.status === "running" || session.pendingPermission || session.pendingElicitation)
      throw new Error("work-task.session-busy");
    signal.throwIfAborted();
    return;
  }
  const clientId = `work-task-merge-check-${task.id}:${task.runSeq}`;
  const connection =
    deps.createNativeConnection?.(task) ??
    createZCodeAgentConnectionScope(deps.agent, {
      connectionId: clientId,
      clientMode: "desktop-continuous",
    });
  const service = connection.service;
  let reject!: (error: Error) => void;
  let accept!: (snapshot: ConversationSnapshot) => void;
  const snapshot = new Promise<ConversationSnapshot>((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  void snapshot.catch(() => {});
  const stop = () => reject(new Error("work-task.canceled"));
  signal.addEventListener("abort", stop, { once: true });
  const assembler = new TopicWireFrameAssembler(conversationTopicFrameSchema);
  let subscriptionId: string | undefined;
  let earlyFrames: ConversationTopicWireCandidate[] = [];
  const acceptFrame = (wire: ConversationTopicWireCandidate) => {
    if (signal.aborted || wire.subscriptionId !== subscriptionId) return;
    for (const event of assembler.accept(wire)) {
      if (event.kind === "fault") {
        reject(new Error("work-task.snapshot-invalid"));
        continue;
      }
      if (event.frame.payload.kind === "snapshot") {
        const value = event.frame.payload.snapshot;
        if (value.sessionId !== task.session!.id || value.seq !== event.frame.toSeq)
          reject(new Error("work-task.snapshot-invalid"));
        else accept(value);
      } else reject(new Error("work-task.snapshot-invalid"));
    }
  };
  const frames = service.onDynamicConversationFrame(target)((wire) => {
    if (wire.topic !== `conversation/${task.session!.id}` || signal.aborted) return;
    // 通知可先于 ACK；必须等本次订阅身份确定，避免旧空闲快照让合并越过忙碌校验。
    if (!subscriptionId) earlyFrames.push(wire);
    else acceptFrame(wire);
  });
  const lifecycle = deps.agent.onAgentRuntimeLifecycle?.((event) => {
    if (event.workspaceKey === target.workspacePath && event.state === "unavailable")
      reject(new Error("work-task.agent-disconnected"));
  });
  try {
    signal.throwIfAborted();
    const hello = await service.helloConversationV4();
    await service.initializeConversationV4({
      kind: "clientHello",
      protocolVersion: hello.protocolVersion,
      clientId,
      clientKind: "desktop",
      appVersion: "work-tasks",
    });
    const subscription = await service.subscribeConversationV4({
      ...target,
      sessionId: task.session.id,
      visibility: "background",
    });
    subscriptionId = subscription.ack.subscriptionId;
    for (const wire of earlyFrames) acceptFrame(wire);
    earlyFrames = [];
    const current = await snapshot;
    signal.throwIfAborted();
    assertWorkTaskNativeIdle(current);
    if (
      current.pendingCommands.length ||
      current.backgroundWorks.some(
        (work) => work.status === "running" || work.status === "resultPending",
      )
    )
      throw new Error("work-task.session-busy");
  } finally {
    frames.dispose();
    lifecycle?.dispose();
    signal.removeEventListener("abort", stop);
    await connection.dispose();
  }
}
