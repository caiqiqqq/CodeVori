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
    useDesktopWindowView.setState({ following: true, snapshot: null });
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
          const draftWorkspace = applyDesktopWindowSession(store, snapshot);
          if (draftWorkspace) {
            // #180：自动进入对话首页时复用新草稿入口，避免恢复手机上次的历史会话。
            // 后续快照保留有效选择，不重复 startDraft 干扰当前输入/会话。
            useZCodeSessionStore.getState().startDraft(draftWorkspace.workspacePath);
          }
          setState({ loading: false, error: null });
        })
        .catch(fail);
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
      useDesktopWindowView.setState({ following: false, snapshot: null });
    };
  }, [follower, services, store]);
  return state;
}
