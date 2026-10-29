import { z } from "zod";
import { forgeRepositoryRequestSchema } from "./forge.js";
import { workTaskScopeSchema } from "./work-task.js";

export const repositoryIssueProjectSchema = workTaskScopeSchema
  .extend({
    remoteName: forgeRepositoryRequestSchema.shape.remoteName,
  })
  .strict();
export type RepositoryIssueProject = z.infer<typeof repositoryIssueProjectSchema>;

/** Host RPC 只读查询，不属于 Agent 命令或任务 admission。 */
export const repositoryIssueSummaryRequestSchema = z
  .object({
    projects: z.array(repositoryIssueProjectSchema).max(200),
    force: z.boolean().optional(),
  })
  .strict();
export type RepositoryIssueSummaryRequest = z.infer<typeof repositoryIssueSummaryRequestSchema>;
export const repositoryIssueDiscoverySchema = repositoryIssueProjectSchema.extend({
  repositoryKey: z.string().min(1),
  repositoryName: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.url().refine((value) => /^https?:\/\//i.test(value)),
});
export type RepositoryIssueDiscovery = z.infer<typeof repositoryIssueDiscoverySchema>;
export const repositoryIssueSummarySchema = z
  .object({
    pending: z.number().int().nonnegative(),
    checkedAt: z.number().int().nonnegative(),
    // 部分项目不可用时 pending 仅包含成功仓库，不能当成完整总数。
    incomplete: z.boolean().optional(),
    // Host 检测事实的有界近期窗口；客户端回执去重，不能根据 pending 增减推断新增。
    newIssues: z.array(repositoryIssueDiscoverySchema).optional(),
    // 明细与总数由同一次 Host 查询生成；旧 Host 没有明细时保持未知。
    projects: z
      .array(
        repositoryIssueProjectSchema.extend({ pending: z.number().int().nonnegative().nullable() }),
      )
      .max(200)
      .optional(),
  })
  .strict();
export type RepositoryIssueSummary = z.infer<typeof repositoryIssueSummarySchema>;
