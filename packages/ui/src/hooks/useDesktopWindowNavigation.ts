import { useEffect, useRef } from "react";
import type { AcpConversationProjection, AcpSidebarSession } from "@/lib/acpSidebarSessions.js";
import { persistDesktopWindowNavigation } from "@/lib/desktopWindowNavigation.js";
import { useDesktopWindowView } from "@/root/desktopWindowSession.js";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";

/** 手机本地页面记忆；Host membership 与各会话运行时仍分别拥有自己的事实。 */
export function useDesktopWindowNavigation({
  workspacePath,
  workspaceIdentity,
  activeSessionId,
  acpSession,
  chatVisible,
  draftFocusVersion,
  selectApi,
  selectAcp,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  activeSessionId: string | null;
  acpSession: AcpConversationProjection | null;
  chatVisible: boolean;
  draftFocusVersion: number;
  selectApi: (path: string, id: string, identity?: string) => void;
  selectAcp: (session: AcpSidebarSession) => void;
}) {
  const view = useDesktopWindowView();
  const tabs = useTabStoreApi();
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const callbacks = useRef({ selectApi, selectAcp });
  callbacks.current = { selectApi, selectAcp };
  const restore = view.navigationRestore;

  useEffect(() => {
    if (
      !view.following ||
      !restore ||
      (restore.workspace.workspaceIdentity?.trim() || restore.workspace.workspacePath) !==
        workspaceKey
    )
      return;
    const current = useDesktopWindowView.getState();
    if (current.navigationRestore !== restore) return;
    useDesktopWindowView.setState({ navigationRestore: null });
    // 恢复请求只消费一次；挂载期间显式新建/选择必须优先，不能被旧启动意图拉回。
    if (activeSessionId || draftFocusVersion > 0) return;
    if (restore.target.kind === "api")
      callbacks.current.selectApi(workspacePath, restore.target.id, workspaceIdentity);
    else if (restore.target.kind === "acp" && restore.acpSession)
      callbacks.current.selectAcp(restore.acpSession);
  }, [
    view.following,
    restore,
    workspaceKey,
    workspacePath,
    workspaceIdentity,
    activeSessionId,
    draftFocusVersion,
  ]);

  useEffect(() => {
    if (!view.following || !view.snapshot || restore || !chatVisible) return;
    const state = tabs.getState();
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (
      !active ||
      !isWorkspaceTab(active) ||
      (active.workspaceIdentity?.trim() || active.workspacePath) !== workspaceKey ||
      active.availability === "unavailable-local-directory"
    )
      return;
    // 修复原因：手机重开丢失内存导航。只记录身份，显式草稿也保存，避免再次跳回旧会话。
    persistDesktopWindowNavigation({
      version: 1,
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      target: activeSessionId
        ? { kind: "api", id: activeSessionId }
        : acpSession
          ? { kind: "acp", id: acpSession.id, agent: acpSession.agent }
          : { kind: "draft" },
    });
  }, [
    view.following,
    view.snapshot,
    restore,
    workspaceKey,
    workspacePath,
    workspaceIdentity,
    activeSessionId,
    acpSession?.id,
    acpSession?.agent,
    chatVisible,
    draftFocusVersion,
    tabs,
  ]);
}
