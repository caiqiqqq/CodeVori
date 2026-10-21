import { create } from "zustand";

interface WarningPresentation {
  initialActivity: string;
  dismissed: boolean;
}

interface WarningPresentationState {
  presentations: Record<string, WarningPresentation>;
  begin: (key: string, activity: string, running: boolean) => void;
  dismiss: (key: string) => void;
}

export function conversationNoticePresentationKey({
  workspaceIdentity,
  workspacePath,
  sessionKey,
  turnId,
  notice,
}: {
  workspaceIdentity?: string;
  workspacePath: string;
  sessionKey: string;
  turnId: string;
  notice: { id: string; severity: "warning" | "error"; message: string; detail?: string };
}): string {
  return JSON.stringify([
    workspaceIdentity?.trim() || workspacePath,
    sessionKey,
    turnId,
    notice.id,
    notice.severity,
    notice.message,
    notice.detail,
  ]);
}

// 修复依据：异常尚未恢复时不能按时间隐藏；展示状态和消失记录必须跨窗格重挂载保留。
// 这里只保存当前 renderer 的展示状态，不修改 Host 诊断，也不把 logEpoch 回放当成新提示。
export const useConversationWarningPresentationStore = create<WarningPresentationState>((set) => ({
  presentations: {},
  begin: (key, activity, running) =>
    set((state) => {
      if (state.presentations[key]) return state;
      return {
        presentations: {
          ...state.presentations,
          [key]: { initialActivity: activity, dismissed: !running },
        },
      };
    }),
  dismiss: (key) =>
    set((state) => {
      const presentation = state.presentations[key];
      if (!presentation || presentation.dismissed) return state;
      return {
        presentations: {
          ...state.presentations,
          // 消失后只需保留去重标记，释放可能很长的整轮内容快照。
          [key]: { ...presentation, initialActivity: "", dismissed: true },
        },
      };
    }),
}));
