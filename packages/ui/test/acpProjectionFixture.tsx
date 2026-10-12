// Existing synthetic Host fixtures adapt to the new read-only contract. Production has no legacy fallback.
import { createElement } from "react";
import type { IAcpService } from "@zcode/services";
import {
  acpSessionSchema,
  buildAcpConversationRows,
  projectAcpStatusPanel,
  summarizeAcpSession,
  type AcpSession,
} from "@zcode/shared";
import {
  createInitialConversationSnapshot,
  encodeTopicWireFrames,
  measureTopicNotificationEnvelopeBytes,
  PROTOCOL_V4_LIMITS,
  type TopicFrameDeliveryKind,
} from "@zcode/shared/zcode-protocol-v4";
import { ServiceProvider as ActualServiceProvider } from "../src/hooks/useServices.js";
import { useAcpConversation as actualUseAcpConversation } from "../src/v4/useAcpConversation.js";

const adapted = new WeakSet<object>();
export function withAcpProjectionFixture(service: IAcpService): IAcpService {
  if (adapted.has(service) || typeof service.readConversation === "function") return service;
  adapted.add(service);
  const sessions = new Map<string, AcpSession>();
  const sessionKey = (value: { id: string; workspacePath: string; workspaceIdentity?: string }) =>
    JSON.stringify([
      value.workspaceIdentity?.trim() || value.workspacePath,
      value.workspacePath,
      value.id,
    ]);
  const normalize = (value: AcpSession) =>
    acpSessionSchema.parse({
      agent: "codex",
      title: "fixture",
      status: "idle",
      revision: 0,
      entries: [],
      pendingPermission: null,
      error: null,
      ...value,
      acpSessionId: value.acpSessionId || "fixture-native",
    });
  const remember = (value: unknown) => {
    if (value && typeof value === "object" && "id" in value) {
      const session = normalize(value as AcpSession);
      if ((sessions.get(sessionKey(session))?.revision ?? -1) <= session.revision)
        sessions.set(sessionKey(session), session);
    }
  };
  for (const method of [
    "create",
    "refresh",
    "read",
    "submitPrompt",
    "setConfigOption",
    "updateRow",
  ] as const) {
    const original = service[method];
    if (!original) continue;
    (service as unknown as Record<string, unknown>)[method] = async (input: never) => {
      const result = await (original as (input: never) => Promise<unknown>)(input);
      remember(result);
      return result;
    };
  }
  const list = service.list?.bind(service) ?? (async () => [...sessions.values()]);
  const changed = service.onDynamicSessionChanged.bind(service);
  service.listSummaries = async (workspace) =>
    (await list(workspace)).map((value) => {
      remember(value);
      return summarizeAcpSession(normalize(value));
    });
  service.onDynamicSessionSummaryChanged = (workspace) => (listener) =>
    changed(workspace)((change) => {
      if (change.kind === "removed") {
        sessions.delete(sessionKey({ ...workspace, id: change.id }));
        listener(change);
      } else {
        remember(change.session);
        listener({ kind: "updated", session: summarizeAcpSession(normalize(change.session)) });
      }
    });
  const snapshot = (value: AcpSession) => {
    const rows = buildAcpConversationRows(value);
    const status = projectAcpStatusPanel(value);
    return {
      ...createInitialConversationSnapshot(value.id, `fixture:${value.id}`),
      plan: status.plan,
      backgroundWorks: status.backgroundWorks,
      seq: value.revision,
      revision: value.revision,
      rows: {
        window: rows.slice(-PROTOCOL_V4_LIMITS.snapshotTailWindowRows),
        totalCount: rows.length,
        firstRowId: rows[0]?.rowId ?? null,
      },
    };
  };
  let ordinal = 0;
  const frames = (
    value: AcpSession,
    subscriptionId: string,
    deliveryKind: TopicFrameDeliveryKind,
    previous?: AcpSession,
  ) => {
    const topic = `conversation/${value.id}`;
    const older = new Map(
      previous ? buildAcpConversationRows(previous).map((row) => [row.rowId, row]) : [],
    );
    const deltas: import("@zcode/shared/zcode-protocol-v4").ConversationDelta[] = [];
    for (const row of buildAcpConversationRows(value)) {
      const old = older.get(row.rowId);
      older.delete(row.rowId);
      if (!old) deltas.push({ op: "row.appended", row });
      else if (JSON.stringify(old) !== JSON.stringify(row))
        deltas.push({ op: "row.upserted", row });
    }
    if (older.size) deltas.push({ op: "row.removed", fromRowId: Math.min(...older.keys()) });
    const state = snapshot(value);
    deltas.push({
      op: "state.updated",
      patch: { revision: value.revision, plan: state.plan, backgroundWorks: state.backgroundWorks },
    });
    const frame = {
      topic,
      subscriptionId,
      fromSeq: previous?.revision ?? 0,
      toSeq: value.revision,
      sentAt: Date.now(),
      payload: previous
        ? { kind: "deltas" as const, deltas }
        : { kind: "snapshot" as const, snapshot: state },
    };
    return encodeTopicWireFrames(frame, {
      topic,
      subscriptionId,
      deliveryKind,
      logicalFrameId: crypto.randomUUID(),
      logicalFrameOrdinal: ++ordinal,
      measurePhysicalFrameBytes: (wire) => measureTopicNotificationEnvelopeBytes(wire).maxBytes,
    }).map((wire) => ({ session: summarizeAcpSession(value), wire }));
  };
  service.readConversation = async (input) => {
    const value = sessions.get(sessionKey(input)) ?? normalize(await service.read(input));
    return frames(value, input.subscriptionId, input.recovery ? "recovery" : "initial");
  };
  service.onDynamicConversationChanged = (input) => (listener) => {
    let previous = sessions.get(sessionKey(input));
    return changed(input)((change) => {
      if (change.kind === "updated" && change.session.id === input.id) {
        const value = normalize(change.session);
        for (const frame of frames(value, input.subscriptionId, "online", previous))
          listener(frame);
        previous = value;
      }
    });
  };
  service.conversationRowsRange = async (input) => {
    const value = sessions.get(sessionKey(input))!;
    const rows = buildAcpConversationRows(value).filter(
      (row) => input.beforeRowId === undefined || row.rowId < input.beforeRowId,
    );
    return {
      rows: rows.slice(-input.limit),
      atSeq: value.revision,
      atRevision: value.revision,
      atLogEpoch: `fixture:${value.id}`,
      hasMore: rows.length > input.limit,
    };
  };
  return service;
}

export function useAcpConversation(...args: Parameters<typeof actualUseAcpConversation>) {
  return actualUseAcpConversation(
    withAcpProjectionFixture(args[0]),
    ...(args.slice(1) as [(typeof args)[1], (typeof args)[2], (typeof args)[3]]),
  );
}
export function ServiceProvider(props: Parameters<typeof ActualServiceProvider>[0]) {
  if (props.services.acpService) withAcpProjectionFixture(props.services.acpService);
  return createElement(ActualServiceProvider, props);
}
