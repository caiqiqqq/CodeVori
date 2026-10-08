import { DelegationSettings } from "@/delegation/DelegationSettings.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";

interface DelegationSettingsSectionProps {
  workspacePath: string | null;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
}

export function DelegationSettingsSection({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  remoteTarget,
}: DelegationSettingsSectionProps) {
  const resolution = useWorkspaceServicesResolution(
    workspacePath,
    remoteSessionId,
    workspaceIdentity,
    remoteTarget,
  );
  // 保留原 SDK 页的目标重挂载边界，避免切换项目或远程连接时沿用旧输入草稿。
  const targetKey = JSON.stringify([
    workspaceIdentity?.trim() || workspacePath,
    workspacePath,
    resolution.remoteSessionId,
    resolution.rpcReady,
  ]);

  return (
    <DelegationSettings
      key={targetKey}
      workspacePath={workspacePath}
      workspaceIdentity={workspaceIdentity}
      remoteSessionId={remoteSessionId}
    />
  );
}
