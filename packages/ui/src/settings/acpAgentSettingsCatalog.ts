import { ACP_AGENT_CATALOG, compareAcpAdapterVersions, type AcpAgentInfo } from "@zcode/shared";
export { compareAcpAdapterVersions } from "@zcode/shared";

export const ACP_AGENT_SETTINGS_CATALOG = ACP_AGENT_CATALOG.map(({ id, name, command }) => ({
  agent: id,
  name,
  command,
  descriptionId: `settings.acpAgents.${id}Description`,
}));

/** A system adapter meeting the current release target already satisfies the install check. */
export function shouldOfferManagedAcpInstall(info: AcpAgentInfo): boolean {
  if (info.managedVersion) return false;
  if (info.source !== "system") return true;
  const comparison = compareAcpAdapterVersions(info.installedVersion, info.registryVersion);
  return comparison === null || comparison < 0;
}

export type AcpAgentCheckId = "adapter" | "version";
export type AcpAgentCheckStatus = "pass" | "warn" | "fail";

/** 仅展示适配器与版本；安装工具和厂商 CLI 仍由 Host 探测并参与操作判定。 */
export function projectAcpAgentChecks(
  info: AcpAgentInfo,
): { id: AcpAgentCheckId; status: AcpAgentCheckStatus }[] {
  const versionComparison = compareAcpAdapterVersions(info.installedVersion, info.registryVersion);
  return [
    { id: "adapter", status: info.ready ? "pass" : "fail" },
    {
      id: "version",
      status: !info.installedVersion
        ? info.ready
          ? "warn"
          : "fail"
        : info.updateCheck?.status === "error" ||
            info.updateCheck?.status === "unavailable" ||
            versionComparison === null ||
            versionComparison < 0
          ? "warn"
          : "pass",
    },
  ];
}

export function isMatchingAcpWorkspaceTab(
  tab: { workspacePath: string; workspaceIdentity?: string | null } | null,
  workspacePath: string | null,
  workspaceIdentity?: string | null,
): boolean {
  return Boolean(
    tab &&
    tab.workspacePath === workspacePath &&
    (tab.workspaceIdentity?.trim() || "") === (workspaceIdentity?.trim() || ""),
  );
}
