import { Emitter } from "@zcode/rpc";
import { desktopWindowSessionInputSchema, type DesktopWindowSessionSnapshot } from "@zcode/shared";

/** Host 只保存窗口展示投影；会话、队列仍归现有服务。每个 Host epoch 独立。 */
export function createWindowWorkspaceProjection(epoch: string) {
  let snapshot: DesktopWindowSessionSnapshot = {
    epoch,
    revision: 0,
    workspaces: [],
    sidebar: { organizeBy: "project", sortBy: "updated" },
  };
  const changed = new Emitter<DesktopWindowSessionSnapshot>();
  return {
    attach(canPublish: boolean) {
      return {
        async publishWorkspaceSession(input: unknown) {
          // 不能由网页自行声明 desktop 权限；资格由 Host attachment 的可信 clientMode 决定。
          if (!canPublish)
            throw new Error("Desktop window projection is read-only for this attachment");
          const parsed = desktopWindowSessionInputSchema.parse(input);
          if (
            snapshot.revision > 0 &&
            JSON.stringify({ workspaces: snapshot.workspaces, sidebar: snapshot.sidebar }) ===
              JSON.stringify(parsed)
          )
            return;
          snapshot = { ...parsed, epoch, revision: snapshot.revision + 1 };
          changed.fire(structuredClone(snapshot));
        },
        async getWorkspaceSession() {
          return structuredClone(snapshot);
        },
        onDynamicWorkspaceSessionChanged() {
          return changed.event;
        },
      };
    },
    dispose() {
      changed.dispose();
    },
  };
}
