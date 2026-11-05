import { resolveWorkspaceKey, type AppSettings } from "@zcode/shared";

export function getWorkspaceDefaultLabel(workspacePath: string): string {
  const segments = workspacePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments.at(-1) ?? workspacePath;
}

export function getWorkspaceDisplayLabel(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  aliases: AppSettings["workspaceAliases"] | undefined,
): string {
  const key = resolveWorkspaceKey({ workspacePath, workspaceIdentity });
  return aliases?.[key] ?? getWorkspaceDefaultLabel(workspacePath);
}

export function getRepeatedWorkspaceLabels(
  tabs: readonly { label: string; workspacePath: string }[],
): ReadonlySet<string> {
  const firstPathByLabel = new Map<string, string>();
  const repeated = new Set<string>();
  for (const tab of tabs) {
    const firstPath = firstPathByLabel.get(tab.label);
    if (firstPath === undefined) firstPathByLabel.set(tab.label, tab.workspacePath);
    else if (firstPath !== tab.workspacePath) repeated.add(tab.label);
  }
  return repeated;
}

export function getWorkspacePathHint(workspacePath: string, otherPaths: readonly string[]): string {
  const segments = workspacePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const peers = otherPaths.map((path) => path.replace(/\\/g, "/").split("/").filter(Boolean));
  for (let depth = Math.min(2, segments.length); depth <= segments.length; depth++) {
    const suffix = segments.slice(-depth).join("/");
    if (peers.every((peer) => peer.slice(-depth).join("/") !== suffix)) {
      return depth === segments.length ? workspacePath : `…/${suffix}`;
    }
  }
  return workspacePath;
}
