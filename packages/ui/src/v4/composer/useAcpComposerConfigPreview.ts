import { useEffect, useRef } from "react";
import type { AcpAgent, AcpConfigOption, AcpModeState } from "@zcode/shared";

type ConfigSnapshot = {
  configOptions: AcpConfigOption[];
  modeState: AcpModeState | null;
};

interface Params {
  agent: AcpAgent | null;
  workspacePath: string;
  workspaceIdentity?: string;
  session: (ConfigSnapshot & { id: string }) | null;
  ready: boolean;
  error: string | null;
}

/** 仅保留本窗格已看过的菜单外观；实际值和可操作性始终由当前 Host 会话决定。 */
export function useAcpComposerConfigPreview({
  agent,
  workspacePath,
  workspaceIdentity,
  session,
  ready,
  error,
}: Params) {
  const observed = useRef(new Map<string, ConfigSnapshot>());
  const key = JSON.stringify([workspaceIdentity?.trim() || workspacePath, workspacePath, agent]);

  useEffect(() => {
    if (!agent || !ready || !session) return;
    observed.current.set(key, {
      configOptions: session.configOptions,
      modeState: session.modeState,
    });
  }, [agent, key, ready, session?.id, session?.configOptions, session?.modeState]);

  // 修复原因：ACP session/new 握手可能耗时一秒，切换时不能等回包才首次渲染工具栏。
  // 历史快照或上次菜单只用来显示且被禁用；新 Host 回包会覆盖，绝不用于配置写入。
  const previous = agent && !error ? observed.current.get(key) : null;
  const display = agent && !error ? (session ?? previous) : null;
  const options = display?.configOptions ?? [];
  const modes = display?.modeState ?? null;
  return {
    options,
    modes,
    loading: Boolean(agent && !ready && !error && options.length === 0 && !modes),
  };
}
