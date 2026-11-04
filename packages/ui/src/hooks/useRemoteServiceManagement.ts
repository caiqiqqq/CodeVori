import { useRef, useState } from "react";
import { usePlatform } from "./usePlatform.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";

/** 等待真实关闭事件再重连，避免新连接复用尚未释放的旧 transport。 */
export function waitForRemoteSessionClosed(sessionId: string): Promise<void> {
  const store = useRemoteWorkspaceSessionStore;
  if (!store.getState().sessionsById[sessionId]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const dispose = store.subscribe((state) => {
      if (!state.sessionsById[sessionId]) finish();
    });
    const timer = setTimeout(() => finish(new Error("Remote service stop timed out")), 20_000);
    function finish(error?: Error) {
      clearTimeout(timer);
      dispose();
      if (error) reject(error);
      else resolve();
    }
    if (!store.getState().sessionsById[sessionId]) finish();
  });
}

export function useRemoteServiceManagement(reconnect?: (workspaceKey: string) => Promise<void>) {
  const platform = usePlatform();
  const [busy, setBusy] = useState<string | null>(null);
  const flight = useRef(false);
  const run = async (key: string, sessionId: string | undefined, restart: boolean) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(key);
    try {
      if (sessionId) {
        if (!platform.stopRemoteService)
          throw new Error("Remote service management is unavailable");
        await platform.stopRemoteService(sessionId);
        await waitForRemoteSessionClosed(sessionId);
      }
      if (restart) {
        if (!reconnect) throw new Error("Reconnect is unavailable");
        await reconnect(key);
      }
    } finally {
      flight.current = false;
      setBusy(null);
    }
  };
  return {
    busy,
    supported: Boolean(platform.stopRemoteService),
    canRestart: Boolean(reconnect),
    run,
  };
}
