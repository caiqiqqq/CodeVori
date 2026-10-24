/* oxlint-disable eslint(max-lines) -- ACP 面板的连接、草稿和已提交会话投影共用同一个生命周期。 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { IAcpService } from "@zcode/services";
import {
  summarizeAcpSession,
  createUuid,
  type AcpAgent,
  type AcpPromptInput,
  type AcpQueueItem,
  type AcpSession,
  type AcpWorkspace,
  type AcpConversationChange,
} from "@zcode/shared";
import {
  ConversationProjectionStore,
  hasOlderRows,
  shouldAutoLoadIncompleteLeadingTurn,
} from "@/v4/conversationProjectionStore.js";
import { acquireAcpConversationProjection } from "@/v4/acpConversationDataLayer.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { selectAcpSession } from "@/v4/composer/acpModelSelection.js";
import { ACP_HOST_UPGRADE_REQUIRED, waitForAcpPromptAdmission } from "@/v4/acpPromptAdmission.js";
import { visibleAcpQueueSubmission, type AcpQueueSubmission } from "@/v4/acpQueueProjection.js";
import { OperationDiagnostics } from "@zcode/rpc";
import { logger } from "@/logger.js";
import { AcpStreamObserver } from "@/lib/acpStreamObserver.js";

const diagnostics = new OperationDiagnostics(
  (record) => logger.lifecycle.warn("[diagnostics]", record),
  { scope: "renderer-acp" },
);

function messageOf(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return /(?:Method not found: |is not a function).*?(?:listSummaries|onDynamicSessionSummaryChanged)|(?:listSummaries|onDynamicSessionSummaryChanged).*?is not a function/.test(
    detail,
  )
    ? ACP_HOST_UPGRADE_REQUIRED
    : detail;
}

/** Host owns accepted ACP turns and history; the hook keeps only the pane's target and draft-side projection. */
export function useAcpConversation(
  service: IAcpService,
  workspace: AcpWorkspace,
  agent: AcpAgent | null,
  onArchived?: (sessionId: string) => void,
) {
  const { intl } = useZCodeIntl();
  const { workspacePath, workspaceIdentity, remoteSessionId } = workspace;
  const target = useMemo(
    () => ({ workspacePath, workspaceIdentity, remoteSessionId }),
    [workspacePath, workspaceIdentity, remoteSessionId],
  );
  const targetRef = useRef(target);
  targetRef.current = target;
  const [sessions, setSessions] = useState<AcpSession[]>([]);
  const [activated, setActivated] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Partial<Record<AcpAgent, string>>>({});
  const [loadedTargetKey, setLoadedTargetKey] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{ agent: AcpAgent | null; message: string } | null>(
    null,
  );
  const error =
    errorState && (!errorState.agent || errorState.agent === agent) ? errorState.message : null;
  const [sendingInputs, setSendingInputs] = useState<
    Map<string, AcpQueueSubmission & { queueing: boolean }>
  >(() => new Map());
  const [reloadKey, setReloadKey] = useState(0);
  const submitting = useRef(new Set<string>());
  const retries = useRef(
    new Map<string, { input: Omit<AcpPromptInput, "commandId">; commandId: string }>(),
  );
  const attempted = useRef(new Set<AcpAgent>());
  const refreshed = useRef(new Set<string>());
  const refreshRequests = useRef(new Map<string, object>());
  const readyIds = useRef(new Set<string>());
  const ownedDraftIds = useRef(new Set<string>());
  const retainedDraftIds = useRef(new Map<AcpAgent, string>());
  const createRequestIds = useRef(new Map<string, string>());
  const previousAgentRef = useRef(agent);
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const targetKey = JSON.stringify([
    workspaceIdentity?.trim() || workspacePath,
    workspacePath,
    remoteSessionId,
  ]);
  const [draftEpoch, setDraftEpoch] = useState(0);
  const [busyCounts, setBusyCounts] = useState<Record<string, number>>({});
  const changeBusy = useCallback(
    (activeAgent: AcpAgent | null, delta: number, sessionId?: string) => {
      if (!activeAgent) return;
      const key = `${targetKey}:${draftEpoch}:${activeAgent}:${sessionId ?? "draft"}`;
      // 修复原因：旧智能体、工作区或草稿的迟到连接不能阻塞当前目标的配置和输入。
      setBusyCounts((previous) => {
        const count = Math.max(0, (previous[key] ?? 0) + delta);
        if (count === 0) {
          const next = { ...previous };
          delete next[key];
          return next;
        }
        return { ...previous, [key]: count };
      });
    },
    [draftEpoch, targetKey],
  );
  const targetKeyRef = useRef(targetKey);
  targetKeyRef.current = targetKey;
  const streamObserver = useMemo(() => new AcpStreamObserver(), [service, targetKey]);
  const [projectionLease, setProjectionLease] = useState<{
    key: string;
    store: ConversationProjectionStore;
  } | null>(null);
  const workspaceKey = JSON.stringify([workspaceIdentity?.trim() || workspacePath, workspacePath]);
  const selectedWorkspaceKeyRef = useRef(workspaceKey);
  const loaded = loadedTargetKey === targetKey;
  const scopedSessions = sessions.filter(
    (session) =>
      (session.workspaceIdentity?.trim() || session.workspacePath) ===
        (workspaceIdentity?.trim() || workspacePath) && session.workspacePath === workspacePath,
  );
  const selected = agent
    ? selectAcpSession(scopedSessions, agent, selectedIds[agent] ?? null)
    : null;
  // 修复原因：同 Agent 的 A 恢复可能迟迟不返回；切到 B 后只等待 B 的操作，
  // 不能让 A 的计数占住 B 的配置/发送按钮。草稿连接仍绑定独立 epoch。
  const busy = Boolean(
    agent && busyCounts[`${targetKey}:${draftEpoch}:${agent}:${selected?.id ?? "draft"}`],
  );
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const projectionKey = selected && agent ? `${targetKey}:${selected.id}` : null;
  const projection = useConversationProjection(
    projectionLease?.key === projectionKey ? projectionLease : null,
  );
  useEffect(() => {
    if (!projectionKey || !selected) return;
    let live = true;
    const id = selected.id;
    let store: ConversationProjectionStore;
    const observe = (change: AcpConversationChange) => {
      if (!live || targetKeyRef.current !== targetKey || selectedRef.current?.id !== id) return;
      if (store.getState().snapshot?.seq !== change.session.revision) return;
      if (
        (sessionsRef.current.find((item) => item.id === id)?.revision ?? -1) >
        change.session.revision
      )
        return;
      if (change.wire.deliveryKind === "online")
        streamObserver.received(change.session, change.streamDiagnostics);
      setSessions((previous) =>
        previous.map((item) =>
          item.id === id && item.revision <= change.session.revision ? change.session : item,
        ),
      );
    };
    const lease = acquireAcpConversationProjection(service, target, id, observe);
    store = lease.store;
    setProjectionLease({ key: projectionKey, store });
    return () => {
      live = false;
      lease.release();
    };
    // 会话的高频 revision 不创建新 store；生命周期只绑定精确目标和会话。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectionKey, service, target, targetKey, streamObserver]);
  const incompleteCursorRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      projectionLease?.key !== projectionKey ||
      !shouldAutoLoadIncompleteLeadingTurn(projection.snapshot, projection.loadingOlder)
    )
      return;
    const cursor = `${projectionKey}:${projection.subscriptionId}:${projection.snapshot?.rows.window[0]?.rowId}`;
    if (incompleteCursorRef.current === cursor) return;
    incompleteCursorRef.current = cursor;
    void projectionLease?.store.loadOlder();
  }, [projection, projectionKey, projectionLease]);
  useLayoutEffect(
    () =>
      streamObserver.commit(
        selected,
        () =>
          targetKeyRef.current === targetKey &&
          selectedRef.current?.id === selected?.id &&
          agentRef.current === selected?.agent &&
          (!selected ||
            !selectedIdsRef.current[selected.agent] ||
            selectedIdsRef.current[selected.agent] === selected.id),
      ),
    [streamObserver, selected, targetKey],
  );
  const archivedOpenIds = useRef(new Map<AcpAgent, string>());
  const onArchivedRef = useRef(onArchived);
  onArchivedRef.current = onArchived;

  const closeArchivedSelection = useCallback(
    (session: AcpSession) => {
      if (
        session.workspacePath !== workspacePath ||
        (session.workspaceIdentity?.trim() || session.workspacePath) !==
          (workspaceIdentity?.trim() || workspacePath) ||
        selectedIdsRef.current[session.agent] !== session.id
      )
        return;
      if (!session.archived) {
        archivedOpenIds.current.delete(session.agent);
        return;
      }
      // 修复原因：归档页的显式打开意图允许查看历史；普通选择不能在 Host 归档后继续显示。
      if (archivedOpenIds.current.get(session.agent) === session.id) return;
      const isVisible = agentRef.current === session.agent;
      selectedIdsRef.current = { ...selectedIdsRef.current, [session.agent]: undefined };
      setSelectedIds(selectedIdsRef.current);
      createRequestIds.current.delete(`${targetKey}:${session.agent}`);
      refreshRequests.current.delete(session.id);
      refreshed.current.delete(session.id);
      readyIds.current.delete(session.id);
      retries.current.delete(`${targetKey}:${session.agent}:${session.id}`);
      if (isVisible) {
        // 先同步废弃选择和请求守卫，再通知 pane 退出，迟到 refresh/create 不能恢复旧正文。
        selectedRef.current = null;
        attempted.current.add(session.agent);
        setErrorState(null);
        onArchivedRef.current?.(session.id);
      } else {
        attempted.current.delete(session.agent);
      }
    },
    [targetKey, workspaceIdentity, workspacePath],
  );

  useEffect(() => {
    if (selectedWorkspaceKeyRef.current === workspaceKey) return;
    // 首次跨工作区打开历史时，延迟激活的订阅曾清掉刚选中的 id。
    // 作用域清理先于 pane 消费打开意图，且不依赖激活；仅 attachment 重连不清选择。
    selectedWorkspaceKeyRef.current = workspaceKey;
    selectedIdsRef.current = {};
    selectedRef.current = null;
    archivedOpenIds.current.clear();
    setSelectedIds({});
  }, [workspaceKey]);

  useEffect(() => {
    if (agent) setActivated(true);
  }, [agent]);

  useEffect(() => {
    if (!activated) return;
    let live = true;
    const updated = new Map<string, AcpSession>();
    const removed = new Set<string>();
    setLoadedTargetKey(null);
    setSessions([]);
    attempted.current.clear();
    refreshed.current.clear();
    refreshRequests.current.clear();
    readyIds.current.clear();
    let subscription: { dispose(): void };
    try {
      subscription = service.onDynamicSessionSummaryChanged(target)((change) => {
        if (!live || targetKeyRef.current !== targetKey) return;
        if (change.kind === "removed") {
          ownedDraftIds.current.delete(change.id);
          for (const [draftAgent, draftId] of retainedDraftIds.current) {
            if (draftId === change.id) retainedDraftIds.current.delete(draftAgent);
          }
          readyIds.current.delete(change.id);
          removed.add(change.id);
          updated.delete(change.id);
          setSessions((previous) => previous.filter((item) => item.id !== change.id));
          setSelectedIds((previous) => {
            const selectedAgent = Object.keys(previous).find(
              (agent) => previous[agent as AcpAgent] === change.id,
            ) as AcpAgent | undefined;
            return selectedAgent ? { ...previous, [selectedAgent]: undefined } : previous;
          });
          return;
        }
        if (
          change.session.workspacePath !== workspacePath ||
          (change.session.workspaceIdentity?.trim() || change.session.workspacePath) !==
            (workspaceIdentity?.trim() || workspacePath)
        )
          return;
        const current = sessionsRef.current.find((item) => item.id === change.session.id);
        const newer = updated.get(change.session.id);
        // 修复原因：归档关闭也必须遵守 snapshot revision，旧通知不能关闭较新的会话选择。
        if (
          (current && current.revision > change.session.revision) ||
          (newer && newer.revision > change.session.revision)
        )
          return;
        // 修复原因：预连接草稿是当前面板的私有选择，其他窗口不能通过 Host 广播看到它。
        if (change.session.provisional && !ownedDraftIds.current.has(change.session.id)) return;
        if (!change.session.provisional) {
          ownedDraftIds.current.delete(change.session.id);
          // 修复原因：首条消息提交后会话已持久化，不再占用临时连接的两个保留名额。
          for (const [draftAgent, draftId] of retainedDraftIds.current) {
            if (draftId === change.session.id) retainedDraftIds.current.delete(draftAgent);
          }
        }
        if (change.session.supersededBy) {
          // 修复原因：Host 接替旧空会话后旧快照仍保留在磁盘，实时事件不能把它重新列回页面。
          removed.add(change.session.id);
          updated.delete(change.session.id);
          setSessions((previous) => previous.filter((item) => item.id !== change.session.id));
          setSelectedIds((previous) =>
            previous[change.session.agent] === change.session.id
              ? { ...previous, [change.session.agent]: change.session.supersededBy }
              : previous,
          );
          return;
        }
        removed.delete(change.session.id);
        updated.set(change.session.id, change.session);
        setSessions((previous) => {
          const current = previous.find((item) => item.id === change.session.id);
          if (current && current.revision > change.session.revision) return previous;
          return [change.session, ...previous.filter((item) => item.id !== change.session.id)];
        });
        closeArchivedSelection(change.session);
      });
    } catch (cause) {
      setErrorState({ agent: null, message: messageOf(cause) });
      return () => {
        live = false;
      };
    }
    // Bug 原因：远端 list 与实时通知并发；先订阅，再按 revision 合并快照。
    void diagnostics
      .run("acp.list", () => service.listSummaries(target))
      .then((items) => {
        if (!live || targetKeyRef.current !== targetKey) return;
        const byId = new Map<string, AcpSession>(
          items.filter((item) => !removed.has(item.id)).map((item) => [item.id, item]),
        );
        for (const item of updated.values()) {
          const older = byId.get(item.id);
          if (!older || item.revision > older.revision) byId.set(item.id, item);
        }
        const nextSessions = [...byId.values()];
        sessionsRef.current = nextSessions;
        setSessions(nextSessions);
        // 重连的 replay/list 也是 Host 确认边界，不能只在实时通知中处理归档。
        nextSessions.forEach(closeArchivedSelection);
        // 修复原因：用户已点选的精确历史 id 可能早于 list 回包；旧快照缺失不能把
        // 这个意图抹掉并触发自动创建。真实删除由 removed 事件或新建任务处理。
        setLoadedTargetKey(targetKey);
        setErrorState(null);
      })
      .catch((cause) => {
        if (live && targetKeyRef.current === targetKey)
          setErrorState({ agent: null, message: messageOf(cause) });
      });
    return () => {
      live = false;
      subscription.dispose();
    };
  }, [
    activated,
    closeArchivedSelection,
    reloadKey,
    service,
    target,
    targetKey,
    streamObserver,
    workspaceIdentity,
    workspaceKey,
    workspacePath,
  ]);

  useEffect(() => {
    // 修复原因：未发送的预连接不是历史会话；离开目标 Host 时释放 Agent 子进程。
    return () => {
      for (const id of ownedDraftIds.current) {
        void service.remove({ ...target, id, provisionalOnly: true }).catch(() => {});
      }
      ownedDraftIds.current.clear();
      retainedDraftIds.current.clear();
      createRequestIds.current.clear();
      refreshRequests.current.clear();
    };
  }, [service, target]);

  const run = useCallback(
    async (
      action: () => Promise<void>,
      nextAgent: AcpAgent | null,
      sessionId?: string,
      isCurrent: () => boolean = () => true,
    ) => {
      changeBusy(nextAgent, 1, sessionId);
      setErrorState(null);
      try {
        await action();
      } catch (cause) {
        if (
          targetKeyRef.current === targetKey &&
          (!sessionId || selectedRef.current?.id === sessionId) &&
          isCurrent()
        )
          setErrorState({ agent: nextAgent, message: messageOf(cause) });
      } finally {
        changeBusy(nextAgent, -1, sessionId);
      }
    },
    [changeBusy, targetKey],
  );

  const releaseDraft = useCallback(
    (id: string) => {
      if (!ownedDraftIds.current.delete(id)) return;
      for (const [draftAgent, draftId] of retainedDraftIds.current) {
        if (draftId === id) {
          retainedDraftIds.current.delete(draftAgent);
          attempted.current.delete(draftAgent);
          createRequestIds.current.delete(`${targetKey}:${draftAgent}`);
        }
      }
      readyIds.current.delete(id);
      refreshed.current.delete(id);
      refreshRequests.current.delete(id);
      setSessions((previous) => previous.filter((item) => item.id !== id));
      if (Object.values(selectedIdsRef.current).includes(id)) {
        selectedIdsRef.current = Object.fromEntries(
          Object.entries(selectedIdsRef.current).filter(([, selectedId]) => selectedId !== id),
        ) as Partial<Record<AcpAgent, string>>;
        setSelectedIds(selectedIdsRef.current);
      }
      void service.remove({ ...target, id, provisionalOnly: true }).catch(() => {});
    },
    [service, target, targetKey],
  );

  const connectNew = useCallback(
    (nextAgent: AcpAgent, startFresh = false) => {
      attempted.current.add(nextAgent);
      // 修复原因：每次切走都关闭进程使切回重复握手；同一草稿最多保留两个已连接的临时会话。
      if (!retainedDraftIds.current.has(nextAgent) && retainedDraftIds.current.size >= 2) {
        const oldest = retainedDraftIds.current.values().next().value;
        if (oldest) releaseDraft(oldest);
      }
      const key = `${targetKey}:${nextAgent}`;
      if (startFresh) createRequestIds.current.delete(key);
      const requestId = createRequestIds.current.get(key) ?? createUuid();
      createRequestIds.current.set(key, requestId);
      void run(
        async () => {
          const session = await diagnostics.run("acp.create", () =>
            service.create({
              ...target,
              agent: nextAgent,
              requestId,
              deferPersistence: true,
              usePermissionPreference: true,
              useModelPreference: true,
            }),
          );
          if (
            targetKeyRef.current !== targetKey ||
            agentRef.current !== nextAgent ||
            createRequestIds.current.get(key) !== requestId
          ) {
            // 修复原因：切换目标期间迟到的连接不可被下一智能体选中或留在 Host 内存。
            if (session.provisional)
              await service.remove({ ...target, id: session.id, provisionalOnly: true });
            return;
          }
          if (session.provisional) {
            ownedDraftIds.current.add(session.id);
            retainedDraftIds.current.delete(nextAgent);
            retainedDraftIds.current.set(nextAgent, session.id);
          }
          readyIds.current.add(session.id);
          setSessions((previous) => [
            summarizeAcpSession(session),
            ...previous.filter((item) => item.id !== session.id),
          ]);
          setSelectedIds((previous) => ({ ...previous, [nextAgent]: session.id }));
        },
        nextAgent,
        undefined,
        () => agentRef.current === nextAgent && createRequestIds.current.get(key) === requestId,
      );
    },
    [releaseDraft, run, service, target, targetKey],
  );

  const resetSelection = useCallback(() => {
    // 修复原因：同一 null-task 草稿重复点击“新建任务”不会改变 sessionId；必须按新草稿
    // 的事件边界清掉选择和连接幂等键，迟到的 create 才不能恢复上一轮会话。
    createRequestIds.current.clear();
    setDraftEpoch((epoch) => epoch + 1);
    attempted.current.clear();
    refreshed.current.clear();
    refreshRequests.current.clear();
    readyIds.current.clear();
    retries.current.clear();
    archivedOpenIds.current.clear();
    selectedIdsRef.current = {};
    selectedRef.current = null;
    setSelectedIds({});
    setErrorState(null);
    const drafts = new Set(ownedDraftIds.current);
    ownedDraftIds.current.clear();
    retainedDraftIds.current.clear();
    if (drafts.size) {
      setSessions((previous) => previous.filter((item) => !drafts.has(item.id)));
      for (const id of drafts) {
        void service.remove({ ...targetRef.current, id, provisionalOnly: true }).catch(() => {});
      }
    }
  }, [service]);

  const create = useCallback(
    (nextAgent: AcpAgent) => {
      attempted.current.add(nextAgent);
      selectedRef.current = null;
      setSelectedIds((previous) => ({ ...previous, [nextAgent]: undefined }));
      if (selected?.provisional) releaseDraft(selected.id);
      connectNew(nextAgent, true);
    },
    [connectNew, releaseDraft, selected],
  );

  useEffect(() => {
    if (!agent || !loaded || selectedIds[agent] || attempted.current.has(agent)) return;
    attempted.current.add(agent);
    connectNew(agent);
  }, [agent, selectedIds, connectNew, loaded]);

  const refreshSession = useCallback(
    (session: AcpSession) => {
      if (refreshed.current.has(session.id)) return;
      refreshed.current.add(session.id);
      const request = {};
      refreshRequests.current.set(session.id, request);
      changeBusy(session.agent, 1, session.id);
      void diagnostics
        .run("acp.refresh", () => service.refresh({ ...target, id: session.id }))
        .then((next) => {
          if (
            targetKeyRef.current !== targetKey ||
            agentRef.current !== session.agent ||
            selectedRef.current?.id !== session.id ||
            refreshRequests.current.get(session.id) !== request
          )
            return;
          readyIds.current.add(next.id);
          setSessions((previous) => {
            const current = previous.find((item) => item.id === next.id);
            if (next.id === session.id && !current) return previous;
            const merged =
              current && current.revision > next.revision ? current : summarizeAcpSession(next);
            return [
              merged,
              ...previous.filter((item) => item.id !== next.id && item.id !== session.id),
            ];
          });
          if (next.id !== session.id && selectedRef.current?.id === session.id) {
            setSelectedIds((previous) => ({ ...previous, [session.agent]: next.id }));
          }
          const current = sessionsRef.current.find((item) => item.id === next.id);
          closeArchivedSelection(current && current.revision > next.revision ? current : next);
          setErrorState(null);
        })
        .catch((cause) => {
          if (
            targetKeyRef.current === targetKey &&
            selectedRef.current?.id === session.id &&
            refreshRequests.current.get(session.id) === request
          )
            setErrorState({ agent: session.agent, message: messageOf(cause) });
        })
        .finally(() => changeBusy(session.agent, -1, session.id));
    },
    [changeBusy, closeArchivedSelection, service, target, targetKey],
  );

  useEffect(() => {
    // 修复原因：重开/远控重连 running 会话也需确认同一 Host 连接，才能接纳后续排队输入。
    if (!selected || !loaded || selected.provisional) return;
    // 修复原因：Codeg 选择历史会话时就恢复 ACP，实时配置和认证错误应在发送前可见。
    refreshSession(selected);
    // 修复原因：重开同一会话会清除 readyIds，但 selected 对象可能不变（回复结束后尤其如此）。
    // 选择意图也必须触发恢复，不能等待下一条 Host 通知或靠切换其它对话解锁发送。
  }, [loaded, refreshSession, selected, selectedIds]);

  useEffect(() => {
    const previous = previousAgentRef.current;
    previousAgentRef.current = agent;
    if (previous === agent) return;
    if (previous) {
      const priorSession = selectAcpSession(
        sessionsRef.current,
        previous,
        selectedIdsRef.current[previous] ?? null,
      );
      if (priorSession) {
        readyIds.current.delete(priorSession.id);
        refreshed.current.delete(priorSession.id);
        refreshRequests.current.delete(priorSession.id);
      } else {
        // 修复原因：尚未完成的 create 离开当前目标后必须失效，迟到回包只能清理。
        attempted.current.delete(previous);
        createRequestIds.current.delete(`${targetKey}:${previous}`);
      }
    }
    if (agent) {
      const retainedId = retainedDraftIds.current.get(agent);
      const current = selectAcpSession(
        sessionsRef.current,
        agent,
        selectedIdsRef.current[agent] ?? null,
      );
      if (retainedId && current?.id === retainedId) {
        // 修复原因：仅上次就绪不能证明进程还活着；复用前由 Host 核验连接与配置。
        retainedDraftIds.current.delete(agent);
        retainedDraftIds.current.set(agent, retainedId);
        readyIds.current.delete(retainedId);
        refreshed.current.delete(retainedId);
        refreshRequests.current.delete(retainedId);
        refreshSession(current);
      }
    }
  }, [agent, refreshSession, targetKey]);

  const send = useCallback(
    async (input: Omit<AcpPromptInput, "commandId">): Promise<string> => {
      if (!agent || !selected || !loaded || busy || !readyIds.current.has(selected.id)) {
        throw new Error("ACP session is not ready");
      }
      // 同一 Agent 可有多个分屏会话；A 的 admission/retry 不能占用 B 的发送锁或幂等键。
      const key = `${targetKey}:${agent}:${selected.id}`;
      if (submitting.current.has(key)) throw new Error("ACP session is not ready");
      submitting.current.add(key);
      setErrorState(null);
      // 修复原因：预连接时只保留 Host 内存草稿，首次发送沿用该原生会话并提交显示记录。
      // RPC ACK 丢失后，同一草稿重试继续复用 prompt 的幂等键。
      const retry = retries.current.get(key);
      const same =
        retry &&
        retry.input.text === input.text &&
        JSON.stringify(retry.input.attachments) === JSON.stringify(input.attachments) &&
        JSON.stringify(retry.input.workspaceFiles) === JSON.stringify(input.workspaceFiles);
      const commandId = same ? retry.commandId : createUuid();
      retries.current.set(key, { input, commandId });
      // 修复原因：只等持久 ACK 才显示队列会造成几秒无正文反馈；发送锁同时持有临时摘要，
      // 不写入 Host queue、不提前清草稿，live 接受或 ACK 后让位于权威投影。
      setSendingInputs((previous) =>
        new Map(previous).set(key, {
          commandId,
          text:
            input.text.trim() ||
            [
              ...(input.attachments ?? []).map((item) => item.fileName),
              ...(input.workspaceFiles ?? []),
            ].join(", "),
          queueing: selected.status === "running" || selected.queue.items.length > 0,
        }),
      );
      try {
        // 修复原因：打开时已完成 refresh；重复恢复 RPC 只延长发送等待。
        // 连接失效仍由 Host submitPrompt 的唯一 admission/attach 路径核验。
        const session = selected;
        if (
          targetKeyRef.current !== targetKey ||
          agentRef.current !== agent ||
          selectedRef.current?.id !== selected.id
        )
          throw new Error("ACP workspace changed while sending");
        const accepted = await waitForAcpPromptAdmission(service, target, {
          ...target,
          id: session.id,
          ...input,
          commandId,
        });
        // 修复原因：接受通知可能丢失；直接 ACK 也须更新同一目标的权威投影，避免 UI 留在 idle。
        if (targetKeyRef.current === targetKey && selectedRef.current?.id === session.id)
          setSessions((previous) =>
            previous.map((item) =>
              item.id === accepted.id && item.revision <= accepted.revision
                ? summarizeAcpSession(accepted)
                : item,
            ),
          );
        if (retries.current.get(key)?.commandId === commandId) retries.current.delete(key);
        return session.id;
      } catch (cause) {
        if (targetKeyRef.current === targetKey && selectedRef.current?.id === selected.id)
          setErrorState({
            agent,
            message:
              cause instanceof Error && cause.message === ACP_HOST_UPGRADE_REQUIRED
                ? intl.formatMessage({ id: "acp.hostUpgradeRequired" })
                : messageOf(cause),
          });
        throw cause;
      } finally {
        submitting.current.delete(key);
        setSendingInputs((previous) => {
          const next = new Map(previous);
          next.delete(key);
          return next;
        });
      }
    },
    [agent, busy, loaded, selected, service, target, targetKey, intl],
  );

  const stop = useCallback(() => {
    if (selected)
      void run(() => service.stop({ ...target, id: selected.id }), selected.agent, selected.id);
  }, [run, selected, service, target]);

  const queueAction = useCallback(
    async (operation: (input: AcpWorkspace & { id: string }) => Promise<AcpSession>) => {
      if (!selected) throw new Error("ACP session is not ready");
      try {
        const snapshot = await operation({ ...target, id: selected.id });
        if (targetKeyRef.current !== targetKey || selectedRef.current?.id !== selected.id) return;
        setSessions((previous) =>
          previous.map((item) =>
            item.id === snapshot.id && item.revision <= snapshot.revision
              ? summarizeAcpSession(snapshot)
              : item,
          ),
        );
        return snapshot;
      } catch (cause) {
        if (targetKeyRef.current === targetKey && selectedRef.current?.id === selected.id)
          setErrorState({ agent: selected.agent, message: messageOf(cause) });
        throw cause;
      }
    },
    [selected, target, targetKey],
  );
  const queueActions = useMemo(
    () => ({
      deleteItem: (queueItemId: string) =>
        queueAction((input) => service.deleteQueueItem({ ...input, queueItemId })).then(() => {}),
      withdrawItem: (expectedItem: AcpQueueItem) =>
        queueAction((input) =>
          service.deleteQueueItem({ ...input, queueItemId: expectedItem.commandId, expectedItem }),
        ),
      moveItem: (queueItemId: string, beforeQueueItemId: string | null) =>
        queueAction((input) =>
          service.reorderQueueItem({ ...input, queueItemId, beforeQueueItemId }),
        ).then(() => {}),
      sendNow: (queueItemId: string) =>
        queueAction((input) => service.sendQueuedNow({ ...input, queueItemId })).then(() => {}),
      resume: () =>
        queueAction((input) => service.setQueueAutoDrain({ ...input, autoDrain: true })).then(
          () => {},
        ),
    }),
    [queueAction, service],
  );
  const setGoal = useCallback(
    async (goal: string | null): Promise<void> => {
      if (!selected) throw new Error("ACP session is not ready");
      try {
        await service.setGoal({ ...target, id: selected.id, goal });
      } catch (cause) {
        if (targetKeyRef.current === targetKey)
          setErrorState({ agent: selected.agent, message: messageOf(cause) });
        throw cause;
      }
    },
    [selected, service, target, targetKey],
  );
  const setConfigOption = useCallback(
    async (configId: string, value: string | boolean): Promise<void> => {
      if (
        !loaded ||
        !selected ||
        !readyIds.current.has(selected.id) ||
        selected.status === "running" ||
        busy
      )
        throw new Error("ACP session is not ready");
      changeBusy(selected.agent, 1, selected.id);
      setErrorState(null);
      try {
        await service.setConfigOption({
          ...target,
          id: selected.id,
          configId,
          value,
          rememberPermission: true,
          rememberModel: true,
        });
      } catch (cause) {
        // 修复原因：切换同 Agent 的历史会话后，旧请求迟到的错误不能显示在新会话上。
        if (targetKeyRef.current === targetKey && selectedRef.current?.id === selected.id)
          setErrorState({ agent: selected.agent, message: messageOf(cause) });
        throw cause;
      } finally {
        changeBusy(selected.agent, -1, selected.id);
      }
    },
    [busy, changeBusy, loaded, selected, service, target, targetKey],
  );
  const decide = useCallback(
    (requestId: string, optionId: string) => {
      if (selected)
        void run(
          () => service.decide({ ...target, id: selected.id, requestId, optionId }),
          selected.agent,
          selected.id,
        );
    },
    [run, selected, service, target],
  );
  const respondElicitation = useCallback(
    (requestId: string, response: import("@zcode/shared").AcpElicitationResponse) => {
      if (!selected) return Promise.resolve();
      return run(
        () => service.respondElicitation({ ...target, id: selected.id, requestId, ...response }),
        selected.agent,
        selected.id,
      );
    },
    [run, selected, service, target],
  );
  const remove = useCallback(() => {
    if (!selected) return;
    void run(
      async () => {
        await service.remove({ ...target, id: selected.id });
        if (targetKeyRef.current !== targetKey) return;
        setSessions((previous) => previous.filter((item) => item.id !== selected.id));
        setSelectedIds((previous) =>
          previous[selected.agent] === selected.id
            ? { ...previous, [selected.agent]: undefined }
            : previous,
        );
      },
      selected.agent,
      selected.id,
    );
  }, [run, selected, service, target, targetKey]);
  const select = useCallback(
    (session: AcpSession) => {
      if (agent && session.agent === agent) {
        // 修复原因：用户显式点击历史后，尚在连接的空会话不能迟到覆盖这个 id。
        createRequestIds.current.delete(`${targetKey}:${agent}`);
        const previous = selectedRef.current;
        if (previous?.provisional && previous.id !== session.id) releaseDraft(previous.id);
        const retainedId = retainedDraftIds.current.get(agent);
        if (retainedId && retainedId !== session.id) releaseDraft(retainedId);
        selectedIdsRef.current = { ...selectedIdsRef.current, [agent]: session.id };
        if (session.archived) archivedOpenIds.current.set(agent, session.id);
        else archivedOpenIds.current.delete(agent);
        setSelectedIds((previous) => ({ ...previous, [agent]: session.id }));
        setErrorState(null);
        if (!session.provisional) {
          readyIds.current.delete(session.id);
          refreshed.current.delete(session.id);
          refreshRequests.current.delete(session.id);
        }
      }
    },
    [agent, releaseDraft, targetKey],
  );

  const selectById = useCallback(
    (nextAgent: AcpAgent, id: string, allowArchived = false) => {
      // 修复原因：侧栏点击可以早于 list 或 create 的结果；先固定精确 id 并废弃旧连接。
      createRequestIds.current.delete(`${targetKey}:${nextAgent}`);
      const previous = selectedRef.current;
      if (previous?.agent === nextAgent && previous.id !== id && previous.provisional)
        releaseDraft(previous.id);
      const retainedId = retainedDraftIds.current.get(nextAgent);
      if (retainedId && retainedId !== id) releaseDraft(retainedId);
      selectedRef.current = null;
      // 显式跨 Agent 打开先更新选择意图，旧会话同一批次的归档不能覆盖下一次打开。
      agentRef.current = nextAgent;
      selectedIdsRef.current = { ...selectedIdsRef.current, [nextAgent]: id };
      if (allowArchived) archivedOpenIds.current.set(nextAgent, id);
      else archivedOpenIds.current.delete(nextAgent);
      setSelectedIds((current) => ({ ...current, [nextAgent]: id }));
      readyIds.current.delete(id);
      refreshed.current.delete(id);
      refreshRequests.current.delete(id);
      setErrorState(null);
    },
    [releaseDraft, targetKey],
  );

  const retryConnection = useCallback(() => {
    if (!agent) return;
    if (!loaded) {
      setReloadKey((key) => key + 1);
    } else if (!selected && !selectedIds[agent]) {
      attempted.current.add(agent);
      connectNew(agent);
    } else if (!selected) {
      setReloadKey((key) => key + 1);
    } else if (!readyIds.current.has(selected.id)) {
      refreshed.current.delete(selected.id);
      refreshRequests.current.delete(selected.id);
      refreshSession(selected);
    } else {
      setErrorState(null);
    }
  }, [agent, connectNew, loaded, refreshSession, selected, selectedIds]);

  const sendingInput =
    agent && selected ? sendingInputs.get(`${targetKey}:${agent}:${selected.id}`) : null;
  const loadOlder = useCallback(
    () =>
      projectionLease?.key === projectionKey
        ? projectionLease.store.loadOlder()
        : Promise.resolve(),
    [projectionKey, projectionLease],
  );
  const loadAllOlder = useCallback(
    () =>
      projectionLease?.key === projectionKey
        ? projectionLease.store.loadAllOlder()
        : Promise.resolve({ status: "stale" as const, logEpoch: "acp" }),
    [projectionKey, projectionLease],
  );
  const displayError = error ?? projection.lastError;
  return {
    selected,
    rows: projection.snapshot?.rows.window ?? [],
    snapshot: projection.snapshot,
    totalCount: projection.snapshot?.rows.totalCount ?? 0,
    canLoadOlder: hasOlderRows(projection.snapshot),
    loadingOlder: projection.loadingOlder,
    turnNavigatorDirectoryRevision: projection.turnNavigatorDirectoryRevision,
    loadOlder,
    loadAllOlder,
    loaded,
    ready: Boolean(
      selected && previousAgentRef.current === agent && readyIds.current.has(selected.id),
    ),
    error:
      displayError === ACP_HOST_UPGRADE_REQUIRED
        ? intl.formatMessage({ id: "acp.hostUpgradeRequired" })
        : displayError,
    busy,
    sending: Boolean(sendingInput),
    queueSubmission:
      selected && sendingInput?.queueing ? visibleAcpQueueSubmission(selected, sendingInput) : null,
    create,
    send,
    queueActions,
    setGoal,
    setConfigOption,
    stop,
    decide,
    respondElicitation,
    remove,
    select,
    selectById,
    resetSelection,
    retryConnection,
    retryList: () => setReloadKey((key) => key + 1),
    dismissError: () => setErrorState(null),
  };
}
