/* oxlint-disable eslint(max-lines) -- ACP 面板的连接、草稿和已提交会话投影共用同一个生命周期。 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IAcpService } from "@zcode/services";
import type { AcpAgent, AcpPromptInput, AcpSession, AcpWorkspace } from "@zcode/shared";
import { selectAcpSession } from "@/v4/composer/acpModelSelection.js";
import { waitForAcpPromptAdmission } from "@/v4/acpPromptAdmission.js";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Host owns accepted ACP turns and history; the hook keeps only the pane's target and draft-side projection. */
export function useAcpConversation(
  service: IAcpService,
  workspace: AcpWorkspace,
  agent: AcpAgent | null,
) {
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
  const [busyCount, setBusyCount] = useState(0);
  const busy = busyCount > 0;
  const [sendingIds, setSendingIds] = useState<Set<string>>(() => new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const submitting = useRef(new Set<string>());
  const retries = useRef(
    new Map<string, { input: Omit<AcpPromptInput, "commandId">; commandId: string }>(),
  );
  const attempted = useRef(new Set<AcpAgent>());
  const refreshed = useRef(new Set<string>());
  const readyIds = useRef(new Set<string>());
  const ownedDraftIds = useRef(new Set<string>());
  const createRequestIds = useRef(new Map<string, string>());
  const previousAgentRef = useRef(agent);
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const targetKey = JSON.stringify([
    workspaceIdentity?.trim() || workspacePath,
    workspacePath,
    remoteSessionId,
  ]);
  const targetKeyRef = useRef(targetKey);
  targetKeyRef.current = targetKey;
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
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const agentSessions = agent
    ? scopedSessions.filter((session) => session.agent === agent && !session.archived)
    : [];

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
    // remoteSessionId 重连只更换 attachment，不抹掉用户选中的同工作区历史会话。
    if (selectedWorkspaceKeyRef.current !== workspaceKey) {
      selectedWorkspaceKeyRef.current = workspaceKey;
      setSelectedIds({});
    }
    attempted.current.clear();
    refreshed.current.clear();
    readyIds.current.clear();
    const subscription = service.onDynamicSessionChanged(target)((change) => {
      if (!live || targetKeyRef.current !== targetKey) return;
      if (change.kind === "removed") {
        ownedDraftIds.current.delete(change.id);
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
      // 修复原因：预连接草稿是当前面板的私有选择，其他窗口不能通过 Host 广播看到它。
      if (change.session.provisional && !ownedDraftIds.current.has(change.session.id)) return;
      if (!change.session.provisional) ownedDraftIds.current.delete(change.session.id);
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
      const newer = updated.get(change.session.id);
      if (!newer || change.session.revision >= newer.revision) {
        updated.set(change.session.id, change.session);
      }
      setSessions((previous) => {
        const current = previous.find((item) => item.id === change.session.id);
        if (current && current.revision > change.session.revision) return previous;
        return [change.session, ...previous.filter((item) => item.id !== change.session.id)];
      });
    });
    // Bug 原因：远端 list 与实时通知并发；先订阅，再按 revision 合并快照。
    void service
      .list(target)
      .then((items) => {
        if (!live || targetKeyRef.current !== targetKey) return;
        const byId = new Map(
          items.filter((item) => !removed.has(item.id)).map((item) => [item.id, item]),
        );
        for (const item of updated.values()) {
          const older = byId.get(item.id);
          if (!older || item.revision > older.revision) byId.set(item.id, item);
        }
        setSessions([...byId.values()]);
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
  }, [activated, reloadKey, service, target, targetKey, workspaceKey]);

  useEffect(() => {
    // 修复原因：未发送的预连接不是历史会话；离开目标 Host 时释放 Agent 子进程。
    return () => {
      for (const id of ownedDraftIds.current) {
        void service.remove({ ...target, id, provisionalOnly: true }).catch(() => {});
      }
      ownedDraftIds.current.clear();
      createRequestIds.current.clear();
    };
  }, [service, target]);

  const run = useCallback(
    async (
      action: () => Promise<void>,
      nextAgent: AcpAgent | null,
      isCurrent: () => boolean = () => true,
    ) => {
      setBusyCount((count) => count + 1);
      setErrorState(null);
      try {
        await action();
      } catch (cause) {
        if (targetKeyRef.current === targetKey && isCurrent())
          setErrorState({ agent: nextAgent, message: messageOf(cause) });
      } finally {
        setBusyCount((count) => count - 1);
      }
    },
    [targetKey],
  );

  const connectNew = useCallback(
    (nextAgent: AcpAgent, startFresh = false) => {
      const key = `${targetKey}:${nextAgent}`;
      if (startFresh) createRequestIds.current.delete(key);
      const requestId = createRequestIds.current.get(key) ?? crypto.randomUUID();
      createRequestIds.current.set(key, requestId);
      void run(
        async () => {
          const session = await service.create({
            ...target,
            agent: nextAgent,
            requestId,
            deferPersistence: true,
          });
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
          if (session.provisional) ownedDraftIds.current.add(session.id);
          readyIds.current.add(session.id);
          setSessions((previous) => [
            session,
            ...previous.filter((item) => item.id !== session.id),
          ]);
          setSelectedIds((previous) => ({ ...previous, [nextAgent]: session.id }));
        },
        nextAgent,
        () => agentRef.current === nextAgent && createRequestIds.current.get(key) === requestId,
      );
    },
    [run, service, target, targetKey],
  );

  const resetSelection = useCallback(() => {
    // 修复原因：同一 null-task 草稿重复点击“新建任务”不会改变 sessionId；必须按新草稿
    // 的事件边界清掉选择和连接幂等键，迟到的 create 才不能恢复上一轮会话。
    createRequestIds.current.clear();
    attempted.current.clear();
    refreshed.current.clear();
    readyIds.current.clear();
    retries.current.clear();
    selectedIdsRef.current = {};
    selectedRef.current = null;
    setSelectedIds({});
    setErrorState(null);
    const drafts = new Set(ownedDraftIds.current);
    ownedDraftIds.current.clear();
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
      if (selected?.provisional && ownedDraftIds.current.delete(selected.id)) {
        void service.remove({ ...target, id: selected.id, provisionalOnly: true }).catch(() => {});
        readyIds.current.delete(selected.id);
        setSessions((previous) => previous.filter((item) => item.id !== selected.id));
      }
      connectNew(nextAgent, true);
    },
    [connectNew, selected, service, target],
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
      setBusyCount((count) => count + 1);
      void service
        .refresh({ ...target, id: session.id })
        .then((next) => {
          if (
            targetKeyRef.current !== targetKey ||
            agentRef.current !== session.agent ||
            selectedRef.current?.id !== session.id
          )
            return;
          readyIds.current.add(next.id);
          setSessions((previous) => {
            const current = previous.find((item) => item.id === next.id);
            if (next.id === session.id && !current) return previous;
            const merged = current && current.revision > next.revision ? current : next;
            return [
              merged,
              ...previous.filter((item) => item.id !== next.id && item.id !== session.id),
            ];
          });
          if (next.id !== session.id && selectedRef.current?.id === session.id) {
            setSelectedIds((previous) => ({ ...previous, [session.agent]: next.id }));
          }
          setErrorState(null);
        })
        .catch((cause) => {
          if (targetKeyRef.current === targetKey && selectedRef.current?.id === session.id)
            setErrorState({ agent: session.agent, message: messageOf(cause) });
        })
        .finally(() => setBusyCount((count) => count - 1));
    },
    [service, target, targetKey],
  );

  useEffect(() => {
    if (!selected || !loaded || selected.status === "running" || selected.provisional) return;
    // 修复原因：Codeg 选择历史会话时就恢复 ACP，实时配置和认证错误应在发送前可见。
    refreshSession(selected);
  }, [loaded, refreshSession, selected]);

  useEffect(() => {
    const previous = previousAgentRef.current;
    previousAgentRef.current = agent;
    if (!previous || previous === agent) return;
    attempted.current.delete(previous);
    createRequestIds.current.delete(`${targetKey}:${previous}`);
    const priorSession = selectAcpSession(
      sessionsRef.current,
      previous,
      selectedIdsRef.current[previous] ?? null,
    );
    if (!priorSession) return;
    readyIds.current.delete(priorSession.id);
    refreshed.current.delete(priorSession.id);
    if (priorSession.provisional && ownedDraftIds.current.delete(priorSession.id)) {
      void service
        .remove({ ...target, id: priorSession.id, provisionalOnly: true })
        .catch(() => {});
      setSessions((items) => items.filter((item) => item.id !== priorSession.id));
      setSelectedIds((ids) => ({ ...ids, [previous]: undefined }));
    }
  }, [agent, service, target, targetKey]);

  const send = useCallback(
    async (input: Omit<AcpPromptInput, "commandId">): Promise<string> => {
      if (
        !agent ||
        !selected ||
        !loaded ||
        busy ||
        !readyIds.current.has(selected.id) ||
        selected.status === "running"
      ) {
        throw new Error("ACP session is not ready");
      }
      const key = `${targetKey}:${agent}`;
      if (submitting.current.has(key)) throw new Error("ACP session is not ready");
      submitting.current.add(key);
      setSendingIds((previous) => new Set(previous).add(key));
      setErrorState(null);
      // 修复原因：预连接时只保留 Host 内存草稿，首次发送沿用该原生会话并提交显示记录。
      // RPC ACK 丢失后，同一草稿重试继续复用 prompt 的幂等键。
      const retry = retries.current.get(key);
      const same =
        retry &&
        retry.input.text === input.text &&
        JSON.stringify(retry.input.attachments) === JSON.stringify(input.attachments) &&
        JSON.stringify(retry.input.workspaceFiles) === JSON.stringify(input.workspaceFiles);
      const commandId = same ? retry.commandId : crypto.randomUUID();
      retries.current.set(key, { input, commandId });
      try {
        const session = await service.refresh({ ...target, id: selected.id });
        if (
          targetKeyRef.current !== targetKey ||
          agentRef.current !== agent ||
          selectedRef.current?.id !== selected.id
        )
          throw new Error("ACP workspace changed while sending");
        setSessions((previous) => {
          const current = previous.find((item) => item.id === session.id);
          const merged = current && current.revision > session.revision ? current : session;
          return [
            merged,
            ...previous.filter((item) => item.id !== session.id && item.id !== selected?.id),
          ];
        });
        setSelectedIds((previous) => ({ ...previous, [agent]: session.id }));
        await waitForAcpPromptAdmission(service, target, {
          ...target,
          id: session.id,
          ...input,
          commandId,
        });
        if (retries.current.get(key)?.commandId === commandId) retries.current.delete(key);
        return session.id;
      } catch (cause) {
        if (targetKeyRef.current === targetKey) setErrorState({ agent, message: messageOf(cause) });
        throw cause;
      } finally {
        submitting.current.delete(key);
        setSendingIds((previous) => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
      }
    },
    [agent, busy, loaded, selected, service, target, targetKey],
  );

  const stop = useCallback(() => {
    if (selected) void run(() => service.stop({ ...target, id: selected.id }), selected.agent);
  }, [run, selected, service, target]);
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
      if (!loaded || !selected || selected.status === "running" || busy)
        throw new Error("ACP session is not ready");
      setBusyCount((count) => count + 1);
      setErrorState(null);
      try {
        await service.setConfigOption({ ...target, id: selected.id, configId, value });
      } catch (cause) {
        // 修复原因：切换同 Agent 的历史会话后，旧请求迟到的错误不能显示在新会话上。
        if (targetKeyRef.current === targetKey && selectedRef.current?.id === selected.id)
          setErrorState({ agent: selected.agent, message: messageOf(cause) });
        throw cause;
      } finally {
        setBusyCount((count) => count - 1);
      }
    },
    [busy, loaded, selected, service, target, targetKey],
  );
  const decide = useCallback(
    (requestId: string, optionId: string) => {
      if (selected)
        void run(
          () => service.decide({ ...target, id: selected.id, requestId, optionId }),
          selected.agent,
        );
    },
    [run, selected, service, target],
  );
  const remove = useCallback(() => {
    if (!selected) return;
    void run(async () => {
      await service.remove({ ...target, id: selected.id });
      if (targetKeyRef.current !== targetKey) return;
      setSessions((previous) => previous.filter((item) => item.id !== selected.id));
      setSelectedIds((previous) => ({ ...previous, [selected.agent]: undefined }));
    }, selected.agent);
  }, [run, selected, service, target, targetKey]);
  const select = useCallback(
    (session: AcpSession) => {
      if (agent && session.agent === agent) {
        // 修复原因：用户显式点击历史后，尚在连接的空会话不能迟到覆盖这个 id。
        createRequestIds.current.delete(`${targetKey}:${agent}`);
        const previous = selectedRef.current;
        if (
          previous?.provisional &&
          previous.id !== session.id &&
          ownedDraftIds.current.delete(previous.id)
        ) {
          void service
            .remove({ ...target, id: previous.id, provisionalOnly: true })
            .catch(() => {});
          setSessions((items) => items.filter((item) => item.id !== previous.id));
        }
        selectedIdsRef.current = { ...selectedIdsRef.current, [agent]: session.id };
        setSelectedIds((previous) => ({ ...previous, [agent]: session.id }));
        setErrorState(null);
        if (!session.provisional) {
          readyIds.current.delete(session.id);
          refreshed.current.delete(session.id);
        }
      }
    },
    [agent, service, target, targetKey],
  );

  const selectById = useCallback(
    (nextAgent: AcpAgent, id: string) => {
      // 修复原因：侧栏点击可以早于 list 或 create 的结果；先固定精确 id 并废弃旧连接。
      createRequestIds.current.delete(`${targetKey}:${nextAgent}`);
      const previous = selectedRef.current;
      if (
        previous?.agent === nextAgent &&
        previous.id !== id &&
        previous.provisional &&
        ownedDraftIds.current.delete(previous.id)
      ) {
        void service.remove({ ...target, id: previous.id, provisionalOnly: true }).catch(() => {});
        readyIds.current.delete(previous.id);
        setSessions((items) => items.filter((item) => item.id !== previous.id));
      }
      selectedRef.current = null;
      selectedIdsRef.current = { ...selectedIdsRef.current, [nextAgent]: id };
      setSelectedIds((current) => ({ ...current, [nextAgent]: id }));
      readyIds.current.delete(id);
      refreshed.current.delete(id);
      setErrorState(null);
    },
    [service, target, targetKey],
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
      refreshSession(selected);
    } else {
      setErrorState(null);
    }
  }, [agent, connectNew, loaded, refreshSession, selected, selectedIds]);

  return {
    selected,
    agentSessions,
    loaded,
    ready: Boolean(selected && readyIds.current.has(selected.id)),
    error,
    busy,
    sending: Boolean(agent && sendingIds.has(`${targetKey}:${agent}`)),
    create,
    send,
    setGoal,
    setConfigOption,
    stop,
    decide,
    remove,
    select,
    selectById,
    resetSelection,
    retryConnection,
    retryList: () => setReloadKey((key) => key + 1),
    dismissError: () => setErrorState(null),
  };
}
