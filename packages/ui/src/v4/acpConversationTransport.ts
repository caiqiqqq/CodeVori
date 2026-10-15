import type { IAcpService } from "@zcode/services";
import {
  acpConversationChangeSchema,
  createUuid,
  type AcpConversationChange,
  type AcpWorkspace,
} from "@zcode/shared";
import {
  conversationTopicFrameSchema,
  reassembleTopicWireFrames,
  TopicWireFrameAssembler,
  WIRE_FAULT_INVALID_PAYLOAD,
} from "@zcode/shared/zcode-protocol-v4";
import { createAckActivationBarrier } from "@/v4/ackActivationBarrier.js";
import type { ConversationProjectionTransport } from "@/v4/transport.js";
import { ACP_HOST_UPGRADE_REQUIRED } from "@/v4/acpPromptAdmission.js";
import { createTopicWireDecoder } from "@/v4/topicWireDecoder.js";

type RoutedChange = AcpConversationChange & { topic: string; subscriptionId: string };
type FrameListener = Parameters<ConversationProjectionTransport["onFrame"]>[0];
type FaultListener = Parameters<ConversationProjectionTransport["onAssemblyFault"]>[0];

/** ACP→V4 只读 adapter；接纳、配置和权限继续使用原服务命令。 */
export function createAcpConversationTransport(
  service: IAcpService,
  workspace: AcpWorkspace,
  sessionId: string,
  observe: (change: AcpConversationChange) => void,
): ConversationProjectionTransport & { dispose(): void } {
  const topic = `conversation/${sessionId}`;
  const listeners = new Set<FrameListener>();
  const faults = new Set<FaultListener>();
  const subscriptions = new Map<string, { dispose(): void }>();
  const assembler = new TopicWireFrameAssembler(conversationTopicFrameSchema);
  const matches = (change: AcpConversationChange) =>
    change.session.id === sessionId &&
    change.wire.topic === topic &&
    change.session.workspacePath === workspace.workspacePath &&
    (change.session.workspaceIdentity?.trim() || change.session.workspacePath) ===
      (workspace.workspaceIdentity?.trim() || workspace.workspacePath);
  const route = (change: AcpConversationChange): RoutedChange => ({
    ...change,
    topic: change.wire.topic,
    subscriptionId: change.wire.subscriptionId,
  });
  let currentChange: AcpConversationChange | undefined;
  const decoder = createTopicWireDecoder(
    assembler,
    (frame, deliveryKind) => {
      for (const listener of listeners) listener(frame, { deliveryKind });
      // 先原子应用正文，再发布同 revision 元数据和实时诊断，避免 commit 关联旧行。
      if (currentChange?.session.revision === frame.toSeq) observe(currentChange);
    },
    (fault) => {
      for (const listener of faults) listener(fault);
    },
  );
  const barrier = createAckActivationBarrier<RoutedChange>((change) => {
    currentChange = change;
    try {
      decoder.accept(change.wire);
    } finally {
      currentChange = undefined;
    }
  });
  const read = async (subscriptionId: string, recovery = false) => {
    try {
      const frames = (
        await service.readConversation({ ...workspace, id: sessionId, subscriptionId, recovery })
      ).map((value) => route(acpConversationChangeSchema.parse(value)));
      if (!frames.every(matches)) throw new Error("ACP conversation target changed");
      return frames;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/Method not found: readConversation|readConversation is not a function/.test(detail))
        throw new Error(ACP_HOST_UPGRADE_REQUIRED);
      throw error;
    }
  };
  const snapshotEpoch = (frames: readonly RoutedChange[]) => {
    const result = reassembleTopicWireFrames(
      frames.map((change) => change.wire),
      conversationTopicFrameSchema,
    );
    if (result.kind !== "complete" || result.frame.payload.kind !== "snapshot")
      throw new Error("ACP initial snapshot is incomplete");
    return result.frame.payload.snapshot.logEpoch;
  };
  const unsubscribe = async (subscriptionId: string) => {
    subscriptions.get(subscriptionId)?.dispose();
    subscriptions.delete(subscriptionId);
    barrier.forget(subscriptionId);
    decoder.discard(topic, subscriptionId);
  };
  return {
    async subscribe() {
      // 局域网 HTTP 浏览器缺少 randomUUID，订阅 ID 复用共享兼容入口以免会话初始化失败。
      const subscriptionId = createUuid();
      const token = barrier.begin(topic);
      try {
        subscriptions.set(
          subscriptionId,
          service.onDynamicConversationChanged({ ...workspace, id: sessionId, subscriptionId })(
            (value) => {
              const parsed = acpConversationChangeSchema.safeParse(value);
              if (!parsed.success) {
                for (const listener of faults)
                  listener({
                    topic,
                    subscriptionId,
                    deliveryKind: "online",
                    reasonCode: WIRE_FAULT_INVALID_PAYLOAD,
                  });
                return;
              }
              const change = parsed.data;
              if (matches(change) && change.wire.subscriptionId === subscriptionId)
                barrier.accept(route(change));
            },
          ),
        );
        const initial = await read(subscriptionId);
        barrier.bind(token, subscriptionId, initial);
        return {
          ack: { subscriptionId, mode: "snapshot" as const, logEpoch: snapshotEpoch(initial) },
        };
      } catch (error) {
        barrier.cancel(token);
        await unsubscribe(subscriptionId);
        const detail = error instanceof Error ? error.message : String(error);
        if (
          /Method not found: onDynamicConversationChanged|onDynamicConversationChanged is not a function/.test(
            detail,
          )
        )
          throw new Error(ACP_HOST_UPGRADE_REQUIRED);
        throw error;
      }
    },
    activate(subscriptionId) {
      const ownership = barrier.activate(subscriptionId);
      if (ownership?.previousSubscriptionId) void unsubscribe(ownership.previousSubscriptionId);
    },
    async resync({ subscriptionId }) {
      const frames = await read(subscriptionId, true);
      if (!subscriptions.has(subscriptionId)) throw new Error("ACP subscription closed");
      decoder.recover(topic, subscriptionId);
      for (const frame of frames) barrier.accept(frame);
      return {
        ack: { subscriptionId, mode: "snapshot" as const, logEpoch: snapshotEpoch(frames) },
      };
    },
    unsubscribe,
    rowsRange: ({ beforeRowId, limit }) =>
      service.conversationRowsRange({ ...workspace, id: sessionId, beforeRowId, limit }),
    // ACP plans are timeline rows; native plans-directory commands are never routed to ACP.
    plans: async () => ({ plans: [], atSeq: 0, atLogEpoch: "acp" }),
    onFrame(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onAssemblyFault(listener) {
      faults.add(listener);
      return () => faults.delete(listener);
    },
    onRuntimeRestart: () => () => {},
    dispose() {
      for (const subscriptionId of subscriptions.keys()) void unsubscribe(subscriptionId);
      barrier.clear();
      decoder.clear();
      listeners.clear();
      faults.clear();
    },
  };
}
