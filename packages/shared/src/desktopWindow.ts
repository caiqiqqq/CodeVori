import { z } from "zod";

export const desktopWindowWorkspaceSchema = z
  .object({
    workspacePath: z.string().trim().min(1),
    workspaceIdentity: z.string().trim().min(1).optional(),
    remoteSessionId: z.string().trim().min(1).optional(),
    workspacePurpose: z.enum(["project", "conversation"]).optional(),
    availability: z.enum(["available", "unavailable-local-directory"]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.remoteSessionId && !value.workspaceIdentity) {
      context.addIssue({
        code: "custom",
        message: "Remote workspace requires identity",
        path: ["workspaceIdentity"],
      });
    }
  });
export const desktopWindowSessionInputSchema = z
  .object({
    workspaces: z.array(desktopWindowWorkspaceSchema).max(500),
    sidebar: z
      .object({
        organizeBy: z.enum(["grouped", "project", "chronological"]),
        sortBy: z.enum(["created", "updated"]),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.workspaces.map(
      (item) => item.workspaceIdentity?.trim() || item.workspacePath,
    );
    if (new Set(keys).size !== keys.length)
      context.addIssue({
        code: "custom",
        message: "Duplicate workspace identity",
        path: ["workspaces"],
      });
  });
export const desktopWindowSessionSnapshotSchema = desktopWindowSessionInputSchema.safeExtend({
  epoch: z.string().min(1),
  revision: z.number().int().nonnegative(),
});
export type DesktopWindowWorkspace = z.infer<typeof desktopWindowWorkspaceSchema>;
export type DesktopWindowSessionInput = z.infer<typeof desktopWindowSessionInputSchema>;
export type DesktopWindowSessionSnapshot = z.infer<typeof desktopWindowSessionSnapshotSchema>;
export interface DesktopLanAccessState {
  enabled: boolean;
  urls: string[];
  /** 仅返回给启用入口的桌面窗口，不写日志或持久化。 */
  token?: string;
}
