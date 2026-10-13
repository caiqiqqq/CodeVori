import { z } from "zod";

/** Composer 的明确目录意图；执行前仍须通过 Git 服务校验，不能当作权限授权。 */
export const linkedRepositorySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    sourcePath: z.string().trim().min(1),
    baseBranch: z.string().trim().min(1),
    useWorktree: z.boolean(),
    prepared: z
      .object({
        executionPath: z.string().min(1),
        branchName: z.string().min(1),
        baseCommit: z.string().min(1),
        sourceRepositoryPath: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export const linkedRepositoriesSchema = z.array(linkedRepositorySchema).max(8);
export type LinkedRepository = z.infer<typeof linkedRepositorySchema>;
