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

/** 只接受局域网 HTTP 可配对的主机部分，避免把完整链接或通配监听地址存作访问地址。 */
export const desktopLanAccessConfigurationSchema = z
  .object({
    address: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .refine((address) => {
        if (/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+local$/.test(address))
          return true;
        if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) return false;
        const parts = address.split(".");
        const octets = parts.map(Number);
        if (parts.some((part, index) => String(octets[index]) !== part || octets[index]! > 255))
          return false;
        return (
          octets[0] === 10 ||
          (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
          (octets[0] === 192 && octets[1] === 168)
        );
      }, "Enter a LAN IPv4 address or a .local hostname, without a protocol or port"),
    port: z.number().int().min(1).max(65535),
  })
  .strict();
export type DesktopLanAccessConfiguration = z.infer<typeof desktopLanAccessConfigurationSchema>;
export interface DesktopLanAccessState {
  enabled: boolean;
  urls: string[];
  configuration?: DesktopLanAccessConfiguration;
  /** 仅返回给启用入口的桌面窗口；由 Main 的凭据服务加密持久化，不进入普通设置。 */
  token?: string;
}
