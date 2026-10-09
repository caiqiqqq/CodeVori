import type { QuickMessage } from "@zcode/shared";
import { useSettings } from "@/hooks/useSettingService.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

const EMPTY_MESSAGES: QuickMessage[] = [];

export function useQuickMessages() {
  // 快捷消息是应用偏好；远端 workspace 不能改变其基础 Host 所有者。
  const services = useBaseWorkspaceServices();
  const { settings, loading, error, update, refresh } = useSettings(services);
  return {
    messages: settings?.quickMessages ?? EMPTY_MESSAGES,
    loading,
    error,
    refresh,
    save: (quickMessages: QuickMessage[]) => update({ quickMessages }),
  };
}
