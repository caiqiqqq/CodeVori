import type { IWorkTaskService } from "@zcode/services";
import {
  repositoryIssueSummarySchema,
  type RepositoryIssueProject,
  type RepositoryIssueSummary,
} from "@zcode/shared";
import { createSharedServiceRead } from "./sharedServiceRead.js";
import { repositoryIssueRefreshStore } from "../store/repositoryIssueRefreshStore.js";

type Resource = ReturnType<typeof createSharedServiceRead<RepositoryIssueSummary>>;
const reads = new WeakMap<IWorkTaskService, Map<string, Resource>>();

export function getRepositoryIssueReadModel(
  service: IWorkTaskService,
  projects: readonly RepositoryIssueProject[],
): Resource {
  const ordered = projects
    .map((project) => ({
      workspacePath: project.workspacePath,
      workspaceIdentity: project.workspaceIdentity?.trim() || undefined,
      remoteSessionId: project.remoteSessionId?.trim() || undefined,
      remoteName: project.remoteName,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const key = JSON.stringify(ordered);
  let byScope = reads.get(service);
  if (!byScope) reads.set(service, (byScope = new Map()));
  let resource = byScope.get(key);
  if (resource) return resource;
  let forceNext = true;
  resource = createSharedServiceRead(
    async () => {
      const force = forceNext;
      forceNext = false;
      return repositoryIssueSummarySchema.parse(
        await service.getRepositoryIssueSummary({ projects: ordered, force }),
      );
    },
    (changed) => {
      const documentTarget = typeof document === "undefined" ? undefined : document;
      const windowTarget = typeof window === "undefined" ? undefined : window;
      const visible = () => documentTarget?.visibilityState !== "hidden";
      const resume = () => {
        if (!visible()) return;
        forceNext = true;
        changed();
      };
      // 同一个共享投影只持有一组 timer/监听；面板是否打开不影响侧栏查询。
      const timer = setInterval(resume, 60_000);
      const unique = new Map(
        ordered.map((project) => [
          JSON.stringify([
            project.workspaceIdentity || project.workspacePath,
            project.workspacePath,
            project.remoteSessionId,
          ]),
          project,
        ]),
      );
      const subscriptions = [...unique.values()].map((project) =>
        service.onDynamicChanged({
          workspacePath: project.workspacePath,
          workspaceIdentity: project.workspaceIdentity,
          remoteSessionId: project.remoteSessionId,
        })(changed),
      );
      const invalidate = repositoryIssueRefreshStore.subscribe(() => {
        forceNext = true;
        changed();
      });
      documentTarget?.addEventListener("visibilitychange", resume);
      windowTarget?.addEventListener("focus", resume);
      windowTarget?.addEventListener("online", resume);
      return {
        dispose() {
          clearInterval(timer);
          subscriptions.forEach((subscription) => subscription.dispose());
          invalidate();
          documentTarget?.removeEventListener("visibilitychange", resume);
          windowTarget?.removeEventListener("focus", resume);
          windowTarget?.removeEventListener("online", resume);
          forceNext = true;
        },
      };
    },
    String,
    { retainErrorUntilSuccess: true },
  );
  byScope.set(key, resource);
  return resource;
}

export interface RepositoryIssueReadSource {
  resource: Resource | null;
  error: string | null;
}
export interface RepositoryIssueCounts {
  count: number | null;
  loading: boolean;
  stale: boolean;
}

/** 合并 Host 投影，不把缺失 Host 的部分数量误报为总数。 */
export function combineRepositoryIssueReads(sources: readonly RepositoryIssueReadSource[]) {
  let previous: ReturnType<Resource["getSnapshot"]>[] = [];
  let snapshot: RepositoryIssueCounts | null = null;
  return {
    subscribe(listener: () => void) {
      const dispose = sources.map((source) => source.resource?.subscribe(listener));
      return () => dispose.forEach((close) => close?.());
    },
    getSnapshot(): RepositoryIssueCounts {
      const current = sources.flatMap((source) =>
        source.resource ? [source.resource.getSnapshot()] : [],
      );
      if (snapshot && current.every((read, index) => read === previous[index])) return snapshot;
      previous = current;
      snapshot = {
        count: sources.every((source) => source.resource?.getSnapshot().data)
          ? current.reduce((sum, read) => sum + read.data!.pending, 0)
          : null,
        loading: current.some((read) => read.loading),
        stale: sources.some((source) => source.error) || current.some((read) => read.error),
      };
      return snapshot;
    },
  };
}
