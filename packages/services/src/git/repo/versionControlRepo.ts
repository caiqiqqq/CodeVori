import { join } from "node:path";
import { z } from "zod";
import { withFileLock } from "@zcode/shared/node";
import { gitAccountSchema } from "@zcode/shared";
import type { ICredentialService } from "../../credential/credential.js";
import { createCredentialService } from "../../credential/credentialService.js";
import { getAppConfigDir } from "../../paths.js";

const CONFIGURATION_KEY = "version-control:configuration";
const privateSettingsSchema = z.object({
  customPath: z.string().nullable().default(null),
  accounts: z.array(gitAccountSchema.extend({ secret: z.string().min(1) })).default([]),
});
export type PrivateVersionControlSettings = z.infer<typeof privateSettingsSchema>;
export type PrivateGitAccount = PrivateVersionControlSettings["accounts"][number];

export interface VersionControlRepo {
  read(): Promise<PrivateVersionControlSettings>;
  update(
    mutation: (current: PrivateVersionControlSettings) => PrivateVersionControlSettings,
  ): Promise<PrivateVersionControlSettings>;
}

export function createVersionControlRepo(options?: {
  credentialService?: ICredentialService;
  lockPath?: string;
}): VersionControlRepo {
  const credentials = options?.credentialService ?? createCredentialService();
  const read = async () => {
    const raw = await credentials.load(CONFIGURATION_KEY);
    return privateSettingsSchema.parse(raw === null ? {} : JSON.parse(raw));
  };
  return {
    read,
    async update(mutation) {
      // 多窗口 Host 会同时改账号；必须在跨进程锁内重读，不能保存 Renderer 的整份旧列表。
      return withFileLock(
        options?.lockPath ?? join(getAppConfigDir(), "version-control"),
        async () => {
          const next = privateSettingsSchema.parse(mutation(await read()));
          await credentials.save(CONFIGURATION_KEY, JSON.stringify(next));
          return next;
        },
      );
    },
  };
}

export async function readConfiguredGitPath(): Promise<string | null> {
  return (await createVersionControlRepo().read()).customPath;
}
