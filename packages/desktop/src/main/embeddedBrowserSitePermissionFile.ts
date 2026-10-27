import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { SitePermissionRecord } from "./embeddedBrowserSitePermissionController.js";

export function createEmbeddedBrowserSitePermissionFile(path: string) {
  return {
    async load(): Promise<unknown> {
      try {
        return JSON.parse(await readFile(path, "utf8")) as unknown;
      } catch {
        return {};
      }
    },
    async save(record: SitePermissionRecord): Promise<void> {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temporary, `${JSON.stringify(record)}\n`, "utf8");
        await rename(temporary, path);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    },
  };
}
