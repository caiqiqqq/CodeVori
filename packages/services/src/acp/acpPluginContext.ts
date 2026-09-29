import {
  extractPluginReferences,
  isZCodeCuaMcpCommand,
  isZCodeCuaMcpPackageArg,
} from "@zcode/shared";
import type { AcpPlugin, SkillSummary, ZCodePluginsAcpCapabilitiesResult } from "@zcode/shared";

export function referencedAcpPlugins(text: string): string[] {
  const { references, invalidCount, truncatedCount } = extractPluginReferences(text);
  if (invalidCount || truncatedCount) {
    throw new Error("插件引用格式无效或数量超过 8 个，请重新从插件菜单选择");
  }
  return references;
}

export function isPortablePluginMcp(config: Record<string, unknown>): boolean {
  if (config.enabled === false || config.oauth || config.auth || config.official) return false;
  if (
    config.timeoutMs != null ||
    config.cwd != null ||
    (config.isolation != null && config.isolation !== "session") ||
    (config.protocolVersion != null && config.protocolVersion !== "auto")
  )
    return false;
  if (typeof config.command === "string") {
    if (isZCodeCuaMcpCommand(config.command)) return false;
    if (
      Array.isArray(config.args) &&
      config.args.some((arg) => typeof arg === "string" && isZCodeCuaMcpPackageArg(arg))
    )
      return false;
    return true;
  }
  return typeof config.url === "string" && (config.type === "http" || config.type === "sse");
}

/** Renderer sees only IDs and descriptions; credential-bearing configs stay on the target Host. */
export function availableAcpPlugins(
  snapshot: ZCodePluginsAcpCapabilitiesResult,
  skills: readonly SkillSummary[],
  provisionedMcpNames?: ReadonlySet<string>,
): AcpPlugin[] {
  return snapshot.plugins.flatMap((plugin) => {
    if (!plugin.enabled || plugin.conflictingPluginIds.length) return [];
    const skillNames = skills
      .filter(
        (skill) => skill.enabled && skill.scope === "plugin" && skill.pluginId === plugin.pluginId,
      )
      .map((skill) => skill.name);
    const mcpServerNames = snapshot.servers
      .filter(
        (server) =>
          server.pluginId === plugin.pluginId &&
          isPortablePluginMcp(server.config) &&
          (!provisionedMcpNames || provisionedMcpNames.has(server.name)),
      )
      .map((server) => server.name);
    if (!skillNames.length && !mcpServerNames.length) return [];
    return [
      {
        pluginId: plugin.pluginId,
        name: plugin.name,
        ...(plugin.description ? { description: plugin.description } : {}),
        skillNames,
        mcpServerNames,
      },
    ];
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildAcpPluginPrompt(
  text: string,
  ids: readonly string[],
  available: readonly AcpPlugin[],
  skills: readonly SkillSummary[],
): string {
  if (!ids.length) return text;
  const entries = ids.map((id) => {
    const plugin = available.find((item) => item.pluginId === id);
    if (!plugin) throw new Error(`插件 ${id} 已停用、卸载或在此 ACP 会话中不可用，请重新选择`);
    const skillLines = skills
      .filter((skill) => skill.enabled && skill.scope === "plugin" && skill.pluginId === id)
      .map(
        (skill) =>
          `<skill name="${escapeXml(skill.name)}" path="${escapeXml(skill.path)}">${escapeXml(skill.description)}</skill>`,
      );
    return [
      `<plugin id="${escapeXml(id)}" name="${escapeXml(plugin.name)}">`,
      ...plugin.mcpServerNames.map((name) => `<mcp_server name="${escapeXml(name)}" />`),
      ...skillLines,
      "</plugin>",
    ].join("\n");
  });
  return `${text}\n\n<available_plugins>\n${entries.join("\n")}\n</available_plugins>`;
}
