import type { WorkTaskBoard, WorkTaskScope } from "@zcode/shared";
import type { getWorkTaskReadModel } from "./workTaskReadModel.js";
import type { SharedReadSnapshot } from "./sharedServiceRead.js";

type Resource = ReturnType<typeof getWorkTaskReadModel>;
type Snapshot = SharedReadSnapshot<WorkTaskBoard> & { settled: boolean };
export interface WorkTaskReadSource {
  resource: Resource | null;
  error: string | null;
  scope?: WorkTaskScope;
}

/** 全部只组合已有读投影，不增加查询、缓存或任务事实所有者。 */
export function combineWorkTaskReads(sources: readonly WorkTaskReadSource[]) {
  let previous: ReturnType<Resource["getSnapshot"]>[] = [];
  let snapshot: Snapshot | null = null;
  return {
    subscribe(listener: () => void) {
      const close = sources.map((source) => source.resource?.subscribe(listener));
      return () => close.forEach((dispose) => dispose?.());
    },
    getSnapshot(): Snapshot {
      const reads = sources.flatMap((source) =>
        source.resource ? [source.resource.getSnapshot()] : [],
      );
      if (snapshot && reads.every((read, index) => read === previous[index])) return snapshot;
      previous = reads;
      const boards = reads.flatMap((read) => (read.data ? [read.data] : []));
      snapshot = {
        data: boards.length
          ? {
              // 远端 Host 记录可能保留本地 scope；投影必须使用读取时的 attachment identity 路由。
              tasks: sources.flatMap((source) =>
                (source.resource?.getSnapshot().data?.tasks ?? []).map((task) => ({
                  ...task,
                  ...source.scope,
                })),
              ),
              concurrency: boards[0]!.concurrency,
            }
          : null,
        loading: !boards.length && reads.some((read) => read.loading),
        settled: reads.every((read) => !read.loading),
        error:
          sources.find((source) => source.error)?.error ??
          reads.find((read) => read.error)?.error ??
          null,
      };
      return snapshot;
    },
    async refresh() {
      await Promise.all(sources.map((source) => source.resource?.refresh(true)));
    },
  };
}
