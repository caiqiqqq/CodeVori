import { compareAcpAdapterVersions, type AcpAgent, type AcpAgentInfo } from "@zcode/shared";

export interface AcpAgentUpgradeTarget {
  agent: AcpAgent;
  action: "install" | "upgrade";
  installedVersion: string;
  expectedVersion: string;
}

/** Only confirmed updates are actionable; missing adapters are an explicit install workflow. */
export function getAcpAgentUpgradePlan(agents: AcpAgentInfo[]): AcpAgentUpgradeTarget[] {
  return agents.flatMap((info) => {
    if (
      info.updateCheck?.status !== "checked" ||
      info.source === "missing" ||
      !info.installedVersion ||
      compareAcpAdapterVersions(info.installedVersion, info.registryVersion) !== -1 ||
      (info.managedVersion &&
        compareAcpAdapterVersions(info.managedVersion, info.registryVersion) !== -1) ||
      info.platformSupported === false ||
      (info.distribution !== "binary" &&
        (!info.nodeVersion || !info.npmVersion || info.nodeVersionCompatible === false))
    )
      return [];
    return [
      {
        agent: info.agent,
        action: info.managedVersion ? ("upgrade" as const) : ("install" as const),
        installedVersion: info.installedVersion,
        expectedVersion: info.registryVersion,
      },
    ];
  });
}

export interface AcpAgentUpgradeResult {
  agent: AcpAgent;
  success: boolean;
  error?: string;
}

export interface AcpAgentUpgradeBatch {
  total: number;
  current: AcpAgent | null;
  results: AcpAgentUpgradeResult[];
  stopped: boolean;
}
