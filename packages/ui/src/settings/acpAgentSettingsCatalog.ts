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

export type AcpAgentCheckId = "node" | "adapter" | "version";
export type AcpAgentCheckStatus = "pass" | "warn" | "fail";

/** 修复原因：隐藏环境版本会把 Node 不兼容误报为普通安装失败；只投影目标 Host 的诊断。 */
export function projectAcpAgentChecks(
  info: AcpAgentInfo,
): { id: AcpAgentCheckId; status: AcpAgentCheckStatus }[] {
  const versionComparison = compareAcpAdapterVersions(info.installedVersion, info.registryVersion);
  return [
    ...(info.distribution === "binary"
      ? []
      : [
          {
            id: "node" as const,
            status:
              !info.nodeVersion || !info.npmVersion
                ? ("fail" as const)
                : info.nodeVersionCompatible === true
                  ? ("pass" as const)
                  : ("warn" as const),
          },
        ]),
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
