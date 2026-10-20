import type { IAcpService } from "@zcode/services";
import type { AcpConversationChange, AcpWorkspace } from "@zcode/shared";
import { createAcpConversationTransport } from "@/v4/acpConversationTransport.js";
import { SessionDataLayer } from "@/v4/sessionDataLayer.js";

interface Entry {
  layer: SessionDataLayer;
  transport: ReturnType<typeof createAcpConversationTransport>;
  observers: Set<(change: AcpConversationChange) => void>;
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
      for (const observer of observers) observer(change);
    });
    entry = { transport, observers, layer: new SessionDataLayer({ transport, keepWarmMs: 0 }) };
    registry.set(key, entry);
  }
  const current = entry;
  current.observers.add(observe);
  const lease = current.layer.acquire(id);
  let released = false;
  return {
    ...lease,
    release() {
      if (released) return;
      released = true;
      current.observers.delete(observe);
      lease.release();
      if (current.observers.size === 0) {
        registry.delete(key);
        current.layer.dispose();
        current.transport.dispose();
      }
    },
  };
}
