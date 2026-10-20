import { createStore } from "zustand/vanilla";
import type { ModelSelectionView } from "@zcode/services";
import {
  workTaskExecutionSchema,
  type AcpAgentAvailability,
  type WorkTaskExecution,
  type WorkTaskScope,
} from "@zcode/shared";
import { getSafeLocalStorage, type BrowserStorageLike } from "@/lib/browserEnvironment.js";

interface WorkTaskExecutionPreferences {
  executions: Record<string, WorkTaskExecution>;
  read(scope: WorkTaskScope): WorkTaskExecution | null;
  remember(scope: WorkTaskScope, execution: WorkTaskExecution): void;
}

function storageKey(scope: WorkTaskScope): string {
  const owner = [
    scope.remoteSessionId?.trim() || "",
    scope.workspaceIdentity?.trim() || scope.workspacePath,
  ];
  return `zcode-work-task-execution:v1:${encodeURIComponent(JSON.stringify(owner))}`;
}

export function createWorkTaskExecutionPreferenceStore(
  storage: BrowserStorageLike | null = getSafeLocalStorage(),
) {
  return createStore<WorkTaskExecutionPreferences>((set, get) => ({
    executions: {},
    read(scope) {
      const key = storageKey(scope);
      try {
        // 每次打开弹窗读取最新持久化值，避免其他窗口的选择被本窗口旧缓存覆盖。
        const raw = storage?.getItem(key);
        if (raw) {
          const parsed = workTaskExecutionSchema.safeParse(JSON.parse(raw));
          if (parsed.success) return parsed.data;
        }
      } catch {
        // 受限存储或损坏数据不能阻断任务编辑，当前窗口仍可使用内存偏好。
      }
      const cached = get().executions[key];
      return cached ? workTaskExecutionSchema.parse(cached) : null;
    },
    remember(scope, execution) {
      const key = storageKey(scope);
      const value = workTaskExecutionSchema.parse(execution);
      set((state) => ({ executions: { ...state.executions, [key]: value } }));
      try {
        storage?.setItem(key, JSON.stringify(value));
      } catch {
        // 配额或隐私模式写入失败时保留内存选择，不影响当前表单。
      }
    },
  }));
}

export const workTaskExecutionPreferenceStore = createWorkTaskExecutionPreferenceStore();

/** Availability only: confirmation must never substitute an unavailable explicit choice. */
export function isWorkTaskExecutionAvailable(
  execution: WorkTaskExecution,
  view: ModelSelectionView | null,
  agents: readonly AcpAgentAvailability[],
): boolean {
  if (execution.kind === "acp")
    return agents.some((item) => item.agent === execution.agent && item.enabled && item.ready);
  const { providerId, modelId } = execution.modelSelection;
  return !!view?.providers.some(
    (provider) =>
      provider.providerId === providerId &&
      provider.models.some((model) => model.modelId === modelId),
  );
}

export function resolveWorkTaskExecutionPreference(
  remembered: WorkTaskExecution | null,
  view: ModelSelectionView | null,
  agents: readonly AcpAgentAvailability[],
): WorkTaskExecution | null {
  if (remembered && isWorkTaskExecutionAvailable(remembered, view, agents)) return remembered;
  return view?.preferredSelection
    ? { kind: "api", modelSelection: view.preferredSelection, mode: "build" }
    : null;
}
