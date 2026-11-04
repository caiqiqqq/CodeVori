import type { ZCodeWorkspaceRef } from "@zcode/shared";

/** MCP 设置探测进程是控制面载体；只有 Host 本次发出的目标才能反向请求身份头。 */
export function createMcpStatusWorkspaceRegistry() {
  const targets = new WeakMap<object, Map<string, ZCodeWorkspaceRef>>();
  return {
    register(client: object, workspace: ZCodeWorkspaceRef): void {
      let byKey = targets.get(client);
      if (!byKey) {
        byKey = new Map();
        targets.set(client, byKey);
      }
      byKey.set(workspace.workspaceKey, workspace);
    },
    resolve(client: object, requested: ZCodeWorkspaceRef): ZCodeWorkspaceRef | undefined {
      const registered = targets.get(client)?.get(requested.workspaceKey);
      // 修复：只匹配 key 会接受同一目录的其他远程会话或伪造路径；完整归属必须一致。
      return registered?.workspacePath === requested.workspacePath &&
        registered.workspaceIdentity === requested.workspaceIdentity &&
        registered.remoteSessionId === requested.remoteSessionId
        ? registered
        : undefined;
    },
  };
}
