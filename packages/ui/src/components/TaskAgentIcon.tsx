import { LoaderIcon } from "lucide-react";
import { parseModelPickerValue, type ZCodeTaskMeta } from "@zcode/shared";
import type { IProviderSettingsService, ProviderSettingsView } from "@zcode/services";
import { cn } from "@/components/lib/utils.js";
import { ProviderLogo } from "@/settings/model-provider-section/ProviderLogo.js";
import {
  useProviderSettingsServiceView,
  useProviderSettingsView,
} from "@/hooks/useProviderSettingsView.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import type { deriveTaskLeadingIndicator } from "@/lib/taskListItemPresentation.js";

interface TaskAgentIconProps {
  task: Pick<ZCodeTaskMeta, "model" | "workspacePath" | "workspaceIdentity">;
  providerId?: string;
  indicator?: ReturnType<typeof deriveTaskLeadingIndicator>;
  className?: string;
}

/** 只读取所属 Host 的供应商配置；会话模型和状态仍由已有 task 投影持有。 */
export function TaskAgentIcon(props: TaskAgentIconProps) {
  const rootSettings = useProviderSettingsView();
  const resolution = useWorkspaceServicesResolution(
    props.task.workspacePath,
    undefined,
    props.task.workspaceIdentity,
  );
  if (resolution.isRemoteTarget && resolution.rpcReady) {
    return <RemoteTaskAgentIcon {...props} service={resolution.services.providerSettingsService} />;
  }
  // 本地复用根快照，避免每个会话触发一次读取；远端等待时不能借用本机同名供应商。
  const settings =
    !resolution.isRemoteTarget && rootSettings.state.status === "ready"
      ? rootSettings.state.view
      : null;
  return <TaskAgentIconContent {...props} settings={settings} />;
}

function RemoteTaskAgentIcon({
  service,
  ...props
}: TaskAgentIconProps & { service: IProviderSettingsService }) {
  const { state } = useProviderSettingsServiceView(service);
  return (
    <TaskAgentIconContent {...props} settings={state.status === "ready" ? state.view : null} />
  );
}

function resolveTaskProviderId(model: string | undefined): string | undefined {
  if (!model?.trim()) return undefined;
  try {
    return parseModelPickerValue(model).providerId;
  } catch {
    // 旧会话没有可解析的供应商身份时显示默认图标，不能根据模型名或 glm 后端猜测。
    return undefined;
  }
}

function TaskAgentIconContent({
  task,
  providerId: explicitProviderId,
  settings,
  indicator = "none",
  className,
}: TaskAgentIconProps & { settings: ProviderSettingsView | null }) {
  // 委派目录已有完整身份，直接使用它，避免从不可逆 Picker 文本解析含斜杠的供应商 ID。
  const providerId = explicitProviderId ?? resolveTaskProviderId(task.model);
  // 修复依据：模型设置使用 effectiveConfig.logo；API 行必须按自己的模型供应商复用同一素材。
  const logo = settings?.providers.find((provider) => provider.providerId === providerId)
    ?.effectiveConfig.logo;
  return (
    <span
      aria-hidden="true"
      data-task-agent-icon="api"
      data-task-provider-id={providerId}
      className={cn(
        "relative inline-flex size-4 shrink-0 items-center justify-center text-foreground",
        className,
      )}
    >
      <ProviderLogo logo={logo} className="size-4" />
      {indicator !== "none" ? (
        <span
          data-task-status-indicator={indicator}
          className="absolute -bottom-0.5 -right-0.5 flex size-2.5 items-center justify-center rounded-full bg-card"
        >
          {indicator === "loading" ? (
            <LoaderIcon
              data-task-running-indicator="true"
              className="size-2.5 animate-spin text-task-running-indicator"
            />
          ) : (
            <span
              data-error-indicator={indicator === "error" ? "true" : undefined}
              data-unread-indicator={indicator === "unread" ? "true" : undefined}
              className={cn(
                "size-1.5 rounded-full",
                indicator === "error" ? "bg-destructive" : "bg-sky-500 dark:bg-sky-400",
              )}
            />
          )}
        </span>
      ) : null}
    </span>
  );
}
