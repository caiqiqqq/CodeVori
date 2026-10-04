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

export type AcpAgentCheckId = "adapter" | "version" | "node" | "npm" | "native";
export type AcpAgentCheckStatus = "pass" | "warn" | "fail" | "info";

/** Host 探测字段的展示状态；厂商 CLI 和安装工具的缺失不能误判现有 ACP 连接失败。 */
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
    ...(info.distribution === "binary"
      ? []
      : [
          { id: "node" as const, status: info.nodeVersion ? ("pass" as const) : ("warn" as const) },
          { id: "npm" as const, status: info.npmVersion ? ("pass" as const) : ("warn" as const) },
        ]),
    ...(info.nativeCommand
      ? [
          {
            id: "native" as const,
            status: info.nativePath
              ? ("pass" as const)
              : info.agent === "pi"
                ? ("fail" as const)
                : ("info" as const),
          },
        ]
      : []),
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
