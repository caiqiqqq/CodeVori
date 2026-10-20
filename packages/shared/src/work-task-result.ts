import { z } from "zod";

const fileSchema = z
  .object({
    path: z.string().min(1).max(4096),
    added: z.number().int().nonnegative().nullable(),
    removed: z.number().int().nonnegative().nullable(),
  })
  .strict();
export const workTaskChangeRecordSchema = z
  .object({
    state: z.enum(["known", "partial", "unknown"]),
    branchName: z.string().max(1024).optional(),
    baseCommit: z.string().max(64).optional(),
    headCommit: z.string().max(64).optional(),
    commits: z
      .array(
        z
          .object({
            hash: z.string().regex(/^[a-f0-9]{40,64}$/),
            subject: z.string().max(300),
            published: z.boolean(),
            url: z.string().url().max(8192).optional(),
          })
          .strict(),
      )
      .max(20),
    files: z.array(fileSchema).max(50),
    uncommitted: z.array(fileSchema).max(50),
    truncated: z.boolean(),
  })
  .strict();
export type WorkTaskChangeRecord = z.infer<typeof workTaskChangeRecordSchema>;
export interface GitTaskChangeRecordRequest {
  workspacePath: string;
  branchName: string;
  baseCommit?: string;
  remoteName?: string;
  publishedBranches?: string[];
  referenceCommit?: string;
}
export interface GitTaskChangeRecordResult {
  record: WorkTaskChangeRecord;
  patch: string;
}
