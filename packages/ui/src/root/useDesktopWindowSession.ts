import { useEffect, useState } from "react";
import type { IServiceAccessor } from "@zcode/services";
import type { DesktopWindowSessionSnapshot } from "@zcode/shared";
import { desktopWindowSessionSnapshotSchema } from "@zcode/shared";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import {
  readSidebarTaskPreferences,
  SIDEBAR_TASK_PREFERENCES_CHANGED_EVENT,
} from "@/lib/sidebarTaskPreferences.js";
import { applyDesktopWindowSession, useDesktopWindowView } from "./desktopWindowSession.js";
import { logger } from "@/logger.js";
import {
  readDesktopWindowNavigation,
  persistDesktopWindowNavigation,
  validateDesktopWindowNavigation,
} from "@/lib/desktopWindowNavigation.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";

export interface DesktopWindowFollower {
  prepare: (snapshot: DesktopWindowSessionSnapshot) => Promise<void>;
}

export function useDesktopWindowSession({
  services,
  isDesktop,
  ready,
  follower,
}: {
  services: IServiceAccessor;
  isDesktop?: boolean;
  ready: boolean;
  follower?: DesktopWindowFollower;
}) {
  const store = useTabStoreApi();
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({
    loading: !!follower,
    error: null,
  });
  useEffect(() => {
    const service = services.windowControllerService;
    if (!isDesktop || !ready || !service?.publishWorkspaceSession) return;
    let live = true;
    let chain = Promise.resolve();
    const publish = () => {
      const input = {
        workspaces: store
          .getState()
          .tabs.filter(isWorkspaceTab)
          .map((tab) => ({
            workspacePath: tab.workspacePath,
            ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
            ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
            ...(tab.workspacePurpose ? { workspacePurpose: tab.workspacePurpose } : {}),
            ...(tab.availability ? { availability: tab.availability } : {}),
          })),
        sidebar: readSidebarTaskPreferences(),
      };
      chain = chain
        .then(async () => {
          if (live) await service.publishWorkspaceSession!(input);
        })
        .catch((error) => logger.warn("[desktop-window] projection publish failed", { error }));
    };
    publish();
    const unsubscribe = store.subscribe((next, previous) => {
      if (next.tabs !== previous.tabs) publish();
    });
    window.addEventListener(SIDEBAR_TASK_PREFERENCES_CHANGED_EVENT, publish);
    return () => {
      live = false;
      unsubscribe();
      window.removeEventListener(SIDEBAR_TASK_PREFERENCES_CHANGED_EVENT, publish);
    };
  }, [isDesktop, ready, services, store]);

  useEffect(() => {
    if (!follower) return;
    const service = services.windowControllerService;
    let live = true;
    let revision = -1;
    let epoch: string | undefined;
    let chain = Promise.resolve();
    let initialNavigation = true;
    useDesktopWindowView.setState({ following: true, snapshot: null, navigationRestore: null });
    const fail = (error: unknown) => {
      if (live)
        setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    };
    const accept = (input: DesktopWindowSessionSnapshot) => {
      if (!live) return;
      const snapshot = desktopWindowSessionSnapshotSchema.parse(input);
      if (snapshot.revision === 0) return;
      if (epoch && epoch !== snapshot.epoch) {
        fail(new Error("Desktop Host changed. Reload to reconnect."));
        return;
      }
      if (epoch === snapshot.epoch && snapshot.revision <= revision) return;
      epoch = snapshot.epoch;
      revision = snapshot.revision;
      chain = chain
        .then(async () => {
          if (!live || epoch !== snapshot.epoch || revision !== snapshot.revision) return;
          // Attach remote scopes before mounting consumers. No local fallback while prepare is pending.
          await follower.prepare(snapshot);
          if (!live || epoch !== snapshot.epoch || revision !== snapshot.revision) return;
          let restore = null;
          if (initialNavigation) {
            const saved = readDesktopWindowNavigation();
            const tabsBefore = store.getState();
            const sessionsBefore = saved
              ? useZCodeSessionStore
                  .getState()
                  .getWorkspaceState(saved.workspacePath, saved.workspaceIdentity)
              : null;
            if (saved) {
              restore = await validateDesktopWindowNavigation(saved, snapshot, (workspace) => {
                if (!workspace.workspaceIdentity && !workspace.remoteSessionId) return services;
                const remote = workspace.remoteSessionId
                  ? useRemoteWorkspaceSessionStore.getState().sessionsById[
                      workspace.remoteSessionId
                    ]?.services
                  : undefined;
                if (!remote) throw new Error("Desktop workspace attachment is unavailable");
                return remote;
              });
              // 修复原因：校验是异步的，旧快照或用户期间的新导航不能被恢复回包覆盖。
              if (!live || epoch !== snapshot.epoch || revision !== snapshot.revision) return;
              const sessionsNow = useZCodeSessionStore
                .getState()
                .getWorkspaceState(saved.workspacePath, saved.workspaceIdentity);
              if (
                store.getState().activeTabId !== tabsBefore.activeTabId ||
                sessionsNow.activeTaskId !== sessionsBefore?.activeTaskId ||
                sessionsNow.draftFocusVersion !== sessionsBefore?.draftFocusVersion
              )
                restore = null;
              else if (!restore) persistDesktopWindowNavigation(null);
            }
            initialNavigation = false;
          }
          const draftWorkspace = applyDesktopWindowSession(store, snapshot, restore);
          if (draftWorkspace && (!restore || restore.target.kind === "draft")) {
            // 手机无有效页面记录时仍沿用安全草稿入口；后续快照不重置当前选择。
            useZCodeSessionStore
              .getState()
              .startDraft(
                draftWorkspace.workspacePath,
                undefined,
                draftWorkspace.workspaceIdentity,
              );
          }
          setState({ loading: false, error: null });
        })
        .catch((error) => {
          if (epoch === snapshot.epoch && revision === snapshot.revision) fail(error);
        });
    };
    if (!service?.getWorkspaceSession || !service.onDynamicWorkspaceSessionChanged) {
      fail(new Error("Desktop Host does not support window projection"));
      return;
    }
    // 必须先订阅再读取；迟到的旧 read 不能覆盖期间收到的新 revision。
    const subscription = service.onDynamicWorkspaceSessionChanged()(accept);
    void service.getWorkspaceSession().then(accept).catch(fail);
    return () => {
      live = false;
      subscription.dispose();
      useDesktopWindowView.setState({ following: false, snapshot: null, navigationRestore: null });
    };
  }, [follower, services, store]);
  return state;
}
