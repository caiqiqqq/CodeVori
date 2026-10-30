import type { IAcpService } from "@zcode/services";
import type { AcpConversationChange, AcpWorkspace } from "@zcode/shared";
import { createAcpConversationTransport } from "@/v4/acpConversationTransport.js";
import { SessionDataLayer } from "@/v4/sessionDataLayer.js";

interface Entry {
  layer: SessionDataLayer;
  transport: ReturnType<typeof createAcpConversationTransport>;
  observers: Set<(change: AcpConversationChange) => void>;
  latestChange?: AcpConversationChange;
}
const layers = new WeakMap<IAcpService, Map<string, Entry>>();

/** 复用原租约/refcount；同一 Host 会话的分屏共享一条物理正文订阅。 */
export function acquireAcpConversationProjection(
  service: IAcpService,
  workspace: AcpWorkspace,
  id: string,
  observe: (change: AcpConversationChange) => void,
) {
  const key = JSON.stringify([
    workspace.workspaceIdentity?.trim() || workspace.workspacePath,
    workspace.workspacePath,
    workspace.remoteSessionId,
    id,
  ]);
  const registry = layers.get(service) ?? new Map<string, Entry>();
  layers.set(service, registry);
  let entry = registry.get(key);
  if (!entry) {
    const observers = new Set<(change: AcpConversationChange) => void>();
    const transport = createAcpConversationTransport(service, workspace, id, (change) => {
      // 正文保温时一并保留同 revision 的 Host 元数据；精确打开不依赖普通列表资格。
      const current = registry.get(key);
      if (
        current &&
        (!current.latestChange || current.latestChange.session.revision <= change.session.revision)
      )
        current.latestChange = change;
      for (const observer of observers) observer(change);
    });
    // 切换对话沿用 API 的保温期；只保留只读投影，连接就绪仍由 Host refreshSummary 核验。
    const layer = new SessionDataLayer({
      transport,
      onEmpty: () => {
        registry.delete(key);
        layer.dispose();
        transport.dispose();
      },
    });
    entry = { transport, observers, layer };
    registry.set(key, entry);
  }
  const current = entry;
  current.observers.add(observe);
  const lease = current.layer.acquire(id);
  let released = false;
  return {
    ...lease,
    latestChange: current.latestChange,
    release() {
      if (released) return;
      released = true;
      current.observers.delete(observe);
      lease.release();
    },
  };
}
