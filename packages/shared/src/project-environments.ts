import { z } from "zod";

export const PROJECT_ENVIRONMENTS_MCP_NAME = "zcode-environments";
export const projectEnvironmentScopeSchema = z
  .object({
    workspacePath: z.string().trim().min(1).max(4096),
    workspaceIdentity: z.string().trim().min(1).max(2048).optional(),
  })
  .strict();
export const projectEnvironmentResourceSchema = z
  .object({
    credentialId: z.string().uuid(),
    purpose: z.string().trim().min(1).max(200),
    instructions: z.string().max(4000).default(""),
  })
  .strict();
export const projectEnvironmentFieldsSchema = projectEnvironmentScopeSchema
  .extend({
    name: z.string().trim().min(1).max(200),
    environment: z.enum(["development", "test", "staging", "production"]),
    instructions: z.string().max(12000).default(""),
    resources: z.array(projectEnvironmentResourceSchema).max(32),
  })
  .strict();
export const saveProjectEnvironmentSchema = projectEnvironmentFieldsSchema.extend({
  id: z.string().uuid().optional(),
  expectedRevision: z.number().int().nonnegative(),
});
export const projectEnvironmentSchema = projectEnvironmentFieldsSchema
  .extend({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export const projectEnvironmentSessionSchema = projectEnvironmentScopeSchema
  .extend({
    kind: z.enum(["api", "acp"]),
    sessionId: z.string().trim().min(1).max(256),
  })
  .strict();
export const setSessionEnvironmentSchema = projectEnvironmentSessionSchema
  .extend({
    environmentId: z.string().uuid().nullable(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export type ProjectEnvironmentScope = z.infer<typeof projectEnvironmentScopeSchema>;
export type ProjectEnvironmentSession = z.infer<typeof projectEnvironmentSessionSchema>;
export type ProjectEnvironment = z.infer<typeof projectEnvironmentSchema>;
export type SaveProjectEnvironment = z.infer<typeof saveProjectEnvironmentSchema>;
export type SetSessionEnvironment = z.infer<typeof setSessionEnvironmentSchema>;
export interface ProjectEnvironmentCredential {
  id: string;
  name: string;
  kind: string;
  environment: ProjectEnvironment["environment"];
  host: string;
  port: number | null;
  username: string | null;
}
export interface ResolvedProjectEnvironment extends Omit<ProjectEnvironment, "resources"> {
  resources: Array<
    ProjectEnvironment["resources"][number] & {
      credential: ProjectEnvironmentCredential | null;
    }
  >;
}
export interface SessionEnvironment {
  revision: number;
  environmentId: string | null;
  environmentRevision: number | null;
  environment: ResolvedProjectEnvironment | null;
}
export const projectEnvironmentMcpSchemas = {
  ListProjectEnvironments: z.object({}).strict(),
  ReadProjectEnvironment: z.object({ id: z.string().uuid() }).strict(),
  GetCurrentProjectEnvironment: z.object({}).strict(),
};
