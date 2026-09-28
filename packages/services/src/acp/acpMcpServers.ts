import { delimiter, isAbsolute, resolve } from "node:path";
import type { McpCapabilities, McpServer } from "@agentclientprotocol/sdk";
import {
  convertToZCodeAgentMcpServer,
  isZCodeCuaMcpCommand,
  isZCodeCuaMcpPackageArg,
  type NativeMcpServerRecord,
} from "@zcode/shared";
import { findCommand } from "./acpAgentManager.js";

/** 连接启动时从目标 Host 的设置读一份快照；禁用项不遮蔽同名的较低优先级配置。 */
function effectiveRecords(records: readonly NativeMcpServerRecord[]): NativeMcpServerRecord[] {
  const selected = new Map<string, NativeMcpServerRecord>();
  for (const record of records) {
    if (record.source !== "zcodeagentmcp" || record.enabled === false) continue;
    const previous = selected.get(record.name);
    if (!previous || (record.scope === "workspace" && previous.scope !== "workspace")) {
      selected.set(record.name, record);
    }
  }
  return [...selected.values()];
}

export async function projectAcpMcpServers(
  records: readonly NativeMcpServerRecord[],
  capabilities: McpCapabilities | null | undefined,
  workspacePath: string,
  launchEnv: NodeJS.ProcessEnv,
): Promise<McpServer[]> {
  const servers: McpServer[] = [];
  for (const record of effectiveRecords(records)) {
    const { name, config } = record;
    // 修复原因：ZCode 的 OAuth/官方身份由 CLI 的凭据代理持有；直接投影会丢失鉴权，
    // 甚至使外部 Agent 绕过官方 MCP 的信任检查。连接前明确拒绝，不传出凭据。
    if (config.oauth) throw new Error(`MCP ${name} 使用 OAuth，ACP 暂不支持此认证方式`);
    if (config.auth || config.official)
      throw new Error(`MCP ${name} 使用 ZCode 专属认证，ACP 暂不支持`);
    if (
      config.timeoutMs != null ||
      (config.isolation != null && config.isolation !== "session") ||
      (config.protocolVersion != null && config.protocolVersion !== "auto") ||
      (config.cwd && resolve(workspacePath, config.cwd) !== resolve(workspacePath))
    ) {
      throw new Error(`MCP ${name} 的超时、隔离、协议版本或工作目录不能由 ACP 表达`);
    }

    const converted = convertToZCodeAgentMcpServer(name, config);
    if (!converted) throw new Error(`MCP ${name} 配置无法转换为 ACP 服务`);
    if ("command" in converted) {
      if (isZCodeCuaMcpCommand(converted.command) || converted.args.some(isZCodeCuaMcpPackageArg)) {
        throw new Error(`MCP ${name} 依赖 ZCode CUA broker，不能直接交给 ACP Agent`);
      }
      const command = converted.command;
      const target =
        !isAbsolute(command) && /[\\/]/.test(command) ? resolve(workspacePath, command) : command;
      const env = { ...launchEnv, ...config.env };
      // 子进程以工作区为 cwd；相对 PATH 必须按同一工作区解析，不能用 Host 的 cwd。
      env.PATH = env.PATH?.split(delimiter)
        .map((path) => resolve(workspacePath, path))
        .join(delimiter);
      const executable = await findCommand(target, env);
      if (!executable) throw new Error(`MCP ${name} 的可执行命令在目标 Host 上不可用`);
      servers.push({
        name,
        command: resolve(executable),
        args: converted.args,
        env: converted.env,
      });
    } else {
      if (!capabilities?.[converted.type]) {
        throw new Error(`MCP ${name} 使用 ${converted.type.toUpperCase()}，当前 ACP Agent 不支持`);
      }
      servers.push({
        name,
        type: converted.type,
        url: converted.url,
        headers: converted.headers,
      });
    }
  }
  return servers;
}
