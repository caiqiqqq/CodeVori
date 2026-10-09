import { createStore } from "zustand/vanilla";
import type { IWorkTaskService } from "@zcode/services";
import { resolveWorkspaceKey, type WorkTaskBoard, type WorkTaskScope } from "@zcode/shared";

interface BoardProjection {
  board: WorkTaskBoard | null;
  loading: boolean;
  error: string | null;
}
const emptyProjection = (): BoardProjection => ({ board: null, loading: true, error: null });

/** Read-only UI projection; accepted tasks and mutations remain owned by the Host. */
class WorkTaskBoardReader {
  readonly store = createStore<BoardProjection>(emptyProjection);
  eventVersion = 0;
  private consumers = 0;
  private epoch = 0;
  private requested = 0;
  private completed = 0;
  private inFlight: Promise<void> | null = null;
  private subscription: { dispose(): void } | null = null;

  constructor(
    private readonly service: IWorkTaskService,
    private readonly scope: WorkTaskScope,
    private readonly includeArchived: boolean,
  ) {}

  acquire() {
    if (++this.consumers === 1) {
      this.subscription = this.service.onDynamicChanged(this.scope)(() => {
        this.eventVersion++;
        void this.refresh();
      });
      void this.refresh();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.consumers) return;
      this.subscription?.dispose();
      this.subscription = null;
      this.epoch++;
      this.inFlight = null;
      this.store.setState(emptyProjection(), true);
    };
  }

  refresh = (): Promise<void> => {
    if (!this.consumers) return Promise.resolve();
    this.requested++;
    if (!this.inFlight) {
      const epoch = this.epoch;
      // 同 scope 多个消费者不应各自读取；同一事件循环的通知合并，不使用延时防抖。
      this.inFlight = Promise.resolve()
        .then(() => this.read(epoch))
        .finally(() => {
          if (this.epoch !== epoch) return;
          this.inFlight = null;
          // Promise 收口微任务之间仍可能收到通知，不能只检查 read 循环尾部。
          if (this.consumers && this.completed !== this.requested) void this.refresh();
        });
    }
    return this.inFlight;
  };

  refreshAfterMutation(version: number) {
    // 保存成功后的列表读取不能阻塞关窗；原变更通知已补读时不能再发一次全量查询。
    if (this.eventVersion === version) void this.refresh();
  }

  private async read(epoch: number) {
    while (this.consumers && this.epoch === epoch) {
      const requested = this.requested;
      try {
        const board = await this.service.list({
          ...this.scope,
          includeArchived: this.includeArchived,
        });
        if (this.epoch !== epoch) return;
        if (this.requested === requested) {
          this.completed = requested;
          this.store.setState({ board, loading: false, error: null });
        }
      } catch (error) {
        if (this.epoch !== epoch) return;
        if (this.requested === requested) {
          this.completed = requested;
          this.store.setState({
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      // 读取开始后发生的变更不能被旧快照覆盖；多次通知只追加一轮读取。
      if (this.requested === requested) return;
    }
  }
}

// service 实例隔离 Host/连接。没有消费者时清空内容，仅保留可供重订阅的读取协调器。
const readers = new WeakMap<IWorkTaskService, Map<string, WorkTaskBoardReader>>();
export function getWorkTaskBoardReader(
  service: IWorkTaskService,
  scope: WorkTaskScope,
  includeArchived: boolean,
) {
  let queries = readers.get(service);
  if (!queries) readers.set(service, (queries = new Map()));
  const key = JSON.stringify([
    resolveWorkspaceKey(scope),
    scope.workspacePath,
    scope.remoteSessionId,
    includeArchived,
  ]);
  let reader = queries.get(key);
  if (!reader) {
    reader = new WorkTaskBoardReader(service, scope, includeArchived);
    queries.set(key, reader);
  }
  return reader;
}
