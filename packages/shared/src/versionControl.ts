import { z } from "zod";

export const gitAccountProviderSchema = z.enum(["github", "gitlab", "gitea", "git"]);
export type GitAccountProvider = z.infer<typeof gitAccountProviderSchema>;

export const gitAccountSchema = z.object({
  id: z.string().uuid(),
  provider: gitAccountProviderSchema,
  serverUrl: z.string().url(),
  username: z.string().min(1).max(256),
  scopes: z.array(z.string()),
  avatarUrl: z.string().nullable(),
  isDefault: z.boolean(),
  createdAt: z.string().datetime(),
});
export type GitAccount = z.infer<typeof gitAccountSchema>;

export const gitVersionControlSettingsSchema = z.object({
  customPath: z.string().nullable().default(null),
  accounts: z.array(gitAccountSchema).default([]),
});
export type GitVersionControlSettings = z.infer<typeof gitVersionControlSettingsSchema>;

const secretSchema = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => !/[\r\n]/.test(value) && !value.includes("\0"));
export const gitAccountAddRequestSchema = z.object({
  provider: gitAccountProviderSchema,
  serverUrl: z.string().trim().min(1).max(2048),
  username: z.string().trim().max(256).optional(),
  secret: secretSchema,
});
export type GitAccountAddRequest = z.infer<typeof gitAccountAddRequestSchema>;

export const gitAccountIdRequestSchema = z.object({ accountId: z.string().uuid() });
export type GitAccountIdRequest = z.infer<typeof gitAccountIdRequestSchema>;
export const gitAccountRotateRequestSchema = gitAccountIdRequestSchema.extend({
  secret: secretSchema,
});
export type GitAccountRotateRequest = z.infer<typeof gitAccountRotateRequestSchema>;
export const gitPathRequestSchema = z.object({ path: z.string().trim().max(4096) });
export type GitPathRequest = z.infer<typeof gitPathRequestSchema>;

export interface GitDetection {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export type GitAccountTestError =
  | "credentials-missing"
  | "authentication"
  | "forbidden"
  | "network"
  | "response"
  | "identity-changed";

export interface GitAccountTestResult {
  success: boolean;
  kind: "forge" | "stored";
  error?: GitAccountTestError;
  statusCode?: number;
}
