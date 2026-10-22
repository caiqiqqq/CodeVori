import { workTaskListSchema } from "@zcode/shared";
import type { IWorkTaskService } from "./contract.js";
import type { WorkTaskServiceOptions } from "./workTaskServiceOptions.js";
import { createRepositoryIssueSummary } from "./repositoryIssueSummary.js";

/** 只读查询共享同一存储就绪边界；不持有运行、准入或持久化状态。 */
export function createWorkTaskReads(
  options: WorkTaskServiceOptions,
  ready: () => Promise<void>,
): Pick<IWorkTaskService, "list" | "getRepositoryIssueSummary"> {
  return {
    async list(input) {
      const scope = workTaskListSchema.parse(input);
      await ready();
      return {
        tasks: options.repo.list(scope, scope.includeArchived),
        concurrency: options.repo.concurrency(scope),
      };
    },
    getRepositoryIssueSummary: createRepositoryIssueSummary({
      forge: options.repositoryIssues,
      tasks: (scope) => options.repo.list(scope, true),
      ready,
    }),
  };
}
