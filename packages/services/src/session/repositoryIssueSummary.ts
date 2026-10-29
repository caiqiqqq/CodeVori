import {
  repositoryIssueSummaryRequestSchema,
  type RepositoryIssueProject,
  type RepositoryIssueSummaryRequest,
  type ForgeTargetRequest,
  type WorkTask,
} from "@zcode/shared";
import type { WorkTaskRepositoryIssuesPort } from "./contract.js";

const CACHE_MS = 60_000;
interface OpenIssues {
  value?: Set<number>;
  checkedAt?: number;
  pending?: Promise<Set<number>>;
  forced?: Promise<Set<number>>;
}
interface RepositoryGroup {
  target: ForgeTargetRequest;
  projects: RepositoryIssueProject[];
}

/** 只有远端读取可缓存；关联每次从唯一任务 owner 重读，不能把计数变成第二份业务事实。 */
export function createRepositoryIssueSummary(options: {
  forge?: WorkTaskRepositoryIssuesPort;
  tasks(scope: RepositoryIssueProject): readonly WorkTask[];
  ready?(): Promise<void>;
  now?: () => number;
}) {
  const cache = new Map<string, OpenIssues>();
  const now = options.now ?? Date.now;
  const readAll = async (target: ForgeTargetRequest) => {
    const numbers = new Set<number>();
    let expectedTotal: number | null = null;
    for (let page = 1; page <= 100_000; page++) {
      const result = await options.forge!.listForgeItems({
        ...target,
        kind: "issue",
        state: "open",
        search: "",
        labels: [],
        sort: "newest",
        page,
        pageSize: 100,
      });
      if (result.incomplete) throw new Error("FORGE_INCOMPLETE");
      if (result.total !== null) {
        if (expectedTotal !== null && expectedTotal !== result.total)
          throw new Error("FORGE_INCOMPLETE");
        expectedTotal = result.total;
      }
      const before = numbers.size;
      for (const item of result.items)
        if (item.kind === "issue" && item.state === "open") numbers.add(item.number);
      if (!result.hasMore) {
        // 搜索上限（例如 GitHub 的 1000 条）不能伪装成完整仓库数量。
        if (expectedTotal !== null && numbers.size !== expectedTotal)
          throw new Error("FORGE_INCOMPLETE");
        return numbers;
      }
      if (numbers.size === before) throw new Error("FORGE_INCOMPLETE");
    }
    throw new Error("FORGE_INCOMPLETE");
  };
  const openIssues = (target: ForgeTargetRequest, force = false): Promise<Set<number>> => {
    const key = JSON.stringify([
      target.workspaceIdentity?.trim() || target.workspacePath,
      target.workspacePath,
      target.remoteName,
      target.repositoryKey,
      target.accountId,
    ]);
    for (const [oldKey, entry] of cache)
      if (!entry.pending && !entry.forced && now() - (entry.checkedAt ?? 0) >= CACHE_MS)
        cache.delete(oldKey);
    let entry = cache.get(key);
    if (!entry) cache.set(key, (entry = {}));
    const owner = entry;
    const start = () => {
      owner.value = undefined;
      owner.checkedAt = undefined;
      const pending = readAll(target)
        .then((numbers) => {
          owner.value = numbers;
          owner.checkedAt = now();
          return numbers;
        })
        .finally(() => {
          if (owner.pending === pending) owner.pending = undefined;
        });
      owner.pending = pending;
      return pending;
    };
    if (owner.forced) return owner.forced;
    if (owner.pending) {
      if (!force) return owner.pending;
      // 写入发生在旧请求在途时，必须在它收口后再读，不能复用写入前的响应。
      const forced = owner.pending
        .catch(() => undefined)
        .then(start)
        .finally(() => {
          if (owner.forced === forced) owner.forced = undefined;
        });
      owner.forced = forced;
      return forced;
    }
    if (!force && owner.value && now() - owner.checkedAt! < CACHE_MS)
      return Promise.resolve(owner.value);
    return start();
  };
  return async (input: RepositoryIssueSummaryRequest) => {
    const request = repositoryIssueSummaryRequestSchema.parse(input);
    await options.ready?.();
    if (!request.projects.length) return { pending: 0, checkedAt: now() };
    if (!options.forge) throw new Error("FORGE_TASK_UNSUPPORTED");
    const groups = new Map<string, RepositoryGroup>();
    // 项目独立发现：某个项目缺账号或读取失败不能阻断其他项目的议题提示。
    const discovery = await Promise.allSettled(
      request.projects.map(async (project) => {
        const info = await options.forge!.getForgeRepository(project);
        if (info.status === "missing-account" || info.status === "account-mismatch")
          throw new Error("FORGE_MISSING_ACCOUNT");
        return { project, info };
      }),
    );
    const failures: unknown[] = [];
    for (const result of discovery) {
      if (result.status === "rejected") {
        failures.push(result.reason);
        continue;
      }
      const { project, info } = result.value;
      if (info.status !== "ready" || !info.repository) continue;
      let group = groups.get(info.repository.key);
      if (!group) {
        group = {
          target: {
            workspacePath: project.workspacePath,
            workspaceIdentity: project.workspaceIdentity,
            remoteName: info.remoteName ?? undefined,
            repositoryKey: info.repository.key,
            accountId: info.repository.accountId,
          },
          projects: [],
        };
        groups.set(info.repository.key, group);
      }
      group.projects.push(project);
    }
    const results = await Promise.allSettled(
      [...groups.values()].map(async ({ target, projects }) => {
        const numbers = await openIssues(target, request.force);
        const linked = new Set<number>();
        // 必须在 IO 后读取；查询期间已接受的新关联也应立即从未处理数量移除。
        for (const project of projects)
          for (const task of options.tasks(project))
            if (task.source?.repositoryKey === target.repositoryKey && task.source.kind === "issue")
              linked.add(task.source.number);
        let pending = 0;
        for (const number of numbers) if (!linked.has(number)) pending++;
        return pending;
      }),
    );
    let pending = 0;
    let available = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        pending += result.value;
        available++;
      } else failures.push(result.reason);
    }
    // 完全失败仍交给共享读模型保留旧值；只有部分成功时才发布明确标记的部分数量。
    if (!available && failures.length) throw failures[0];
    return { pending, checkedAt: now(), ...(failures.length ? { incomplete: true } : {}) };
  };
}
