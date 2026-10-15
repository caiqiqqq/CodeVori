import { createWebSocketServiceConnection } from "@zcode/client";
import type { DesktopWindowSessionSnapshot } from "@zcode/shared";
import {
  bindRemoteWorkspaceIdentity,
  bindRemoteWorkspacePath,
  registerRemoteWorkspaceSession,
  unregisterRemoteWorkspaceSession,
} from "@zcode/ui";

/** 只附着桌面已有 remoteSessionId；不调用 connectRemote，不创建远端 Host。 */
export function createDesktopWindowFollower(wsUrl: string, onClose: () => void) {
  const attachments = new Map<string, { key: string; dispose(): void }>();
  let closed = false;
  return {
    async prepare(snapshot: DesktopWindowSessionSnapshot) {
      if (closed) throw new Error("Desktop connection is closed");
      const wanted = new Set<string>();
      for (const workspace of snapshot.workspaces) {
        if (!workspace.remoteSessionId) continue;
        const scope = {
          kind: "remote",
          remoteSessionId: workspace.remoteSessionId,
          workspacePath: workspace.workspacePath,
          workspaceIdentity: workspace.workspaceIdentity,
        };
        const key = JSON.stringify(scope);
        wanted.add(workspace.remoteSessionId);
        if (attachments.get(workspace.remoteSessionId)?.key === key) continue;
        const url = new URL(wsUrl);
        url.searchParams.set("scope", key);
        const connection = await createWebSocketServiceConnection(url.toString(), { onClose });
        if (closed) {
          connection.dispose();
          throw new Error("Desktop connection is closed");
        }
        attachments.get(workspace.remoteSessionId)?.dispose();
        registerRemoteWorkspaceSession({
          sessionId: workspace.remoteSessionId,
          services: connection.services,
          dispose: connection.dispose,
        });
        bindRemoteWorkspaceIdentity(workspace.workspaceIdentity!, workspace.remoteSessionId);
        // identity 为主；path fallback 仅沿用本地兼容索引，不用于选择远端 attachment。
        bindRemoteWorkspacePath(workspace.workspacePath, workspace.remoteSessionId);
        attachments.set(workspace.remoteSessionId, {
          key,
          dispose: () => unregisterRemoteWorkspaceSession(workspace.remoteSessionId!),
        });
      }
      for (const [id, attachment] of attachments)
        if (!wanted.has(id)) {
          attachment.dispose();
          attachments.delete(id);
        }
    },
    dispose() {
      closed = true;
      for (const attachment of attachments.values()) attachment.dispose();
      attachments.clear();
    },
  };
}
