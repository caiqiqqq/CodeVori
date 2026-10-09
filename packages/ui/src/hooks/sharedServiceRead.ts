export interface SharedReadSnapshot<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** 只共享 UI 读投影；业务事实和命令仍由原 Service 持有。 */
export function createSharedServiceRead<T>(
  read: () => Promise<T>,
  observe?: (changed: () => void) => { dispose(): void },
  errorMessage: (error: unknown) => string = String,
) {
  const empty = (): SharedReadSnapshot<T> => ({ data: null, error: null, loading: true });
  let snapshot = empty();
  const listeners = new Set<() => void>();
  let subscription: { dispose(): void } | undefined;
  let generation = 0;
  let revision = 0;
  let eventVersion = 0;
  let pending: Promise<void> | null = null;
  const publish = (next: SharedReadSnapshot<T>) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const refresh = (invalidate = false): Promise<void> => {
    if (!listeners.size) return Promise.resolve();
    if (pending && !invalidate) return pending;
    // Host 更新要立即发起新读取；旧 RPC 可能迟迟不返回，不能阻塞新事实。
    const requestedRevision = ++revision;
    const owner = generation;
    // 已有投影只做后台重读，不能让事件刷新清空看板和当前选择。
    publish({ ...snapshot, loading: snapshot.data === null, error: null });
    pending = (async () => {
      try {
        const data = await read();
        if (owner === generation && requestedRevision === revision)
          publish({ data, loading: false, error: null });
      } catch (error) {
        if (owner === generation && requestedRevision === revision)
          publish({ ...snapshot, loading: false, error: errorMessage(error) });
      }
    })().finally(() => {
      if (owner === generation && requestedRevision === revision) pending = null;
    });
    return pending;
  };
  return {
    getSnapshot: () => snapshot,
    getEventVersion: () => eventVersion,
    refreshAfterMutation: (version: number) => {
      // 保存成功不等待列表；期间已收到通知时复用事件读取，避免同一次保存再查整表。
      if (version === eventVersion) void refresh(true);
    },
    refresh,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        subscription = observe?.(() => {
          eventVersion++;
          void refresh(true);
        });
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        generation++;
        subscription?.dispose();
        subscription = undefined;
        pending = null;
        snapshot = empty();
      };
    },
  };
}
