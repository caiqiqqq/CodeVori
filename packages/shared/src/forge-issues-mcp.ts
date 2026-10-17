import { z } from "zod";
import {
  forgeListRequestSchema,
  forgeNewIssueRequestSchema,
  forgeRepositoryRequestSchema,
} from "./forge.js";

export const FORGE_ISSUES_MCP_NAME = "zcode-issues";
const target = z.object({
  remoteName: forgeRepositoryRequestSchema.shape.remoteName.unwrap(),
  repositoryKey: forgeNewIssueRequestSchema.shape.repositoryKey,
});
export const forgeIssuesMcpSchemas = {
  GetRepository: z.object({ remoteName: forgeRepositoryRequestSchema.shape.remoteName }).strict(),
  ListIssues: target
    .extend({
      state: forgeListRequestSchema.shape.state.default("open"),
      search: forgeListRequestSchema.shape.search,
      sort: forgeListRequestSchema.shape.sort,
      labels: forgeListRequestSchema.shape.labels,
      page: forgeListRequestSchema.shape.page.default(1),
      pageSize: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
  GetIssue: target
    .extend({ number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })
    .strict(),
  GetIssueOptions: target.strict(),
  CreateIssue: forgeNewIssueRequestSchema
    .omit({
      workspacePath: true,
      workspaceIdentity: true,
      accountId: true,
      remoteName: true,
    })
    .extend({ remoteName: target.shape.remoteName, requestId: z.string().uuid() })
    .strict(),
};
export const forgeIssueCreateResultSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string().max(256),
    url: z.string().url().nullable(),
    repositoryKey: z.string().min(1),
    remoteName: z.string().min(1),
  })
  .strict();
export type ForgeIssueCreateResult = z.infer<typeof forgeIssueCreateResultSchema>;
