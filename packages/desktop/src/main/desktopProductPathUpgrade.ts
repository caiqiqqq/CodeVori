import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { migrateLegacyScratchRoot, prepareProductPaths } from "@zcode/shared/node";
import { PRODUCT_DATA_DIRECTORY_NAME } from "@zcode/shared/product-brand";
import { collectScratchWorkspacePaths } from "./desktopScratchWorkspacePaths.js";
import { rewriteDefaultWorkspaceReferences } from "./desktopLegacyWorkspaceReferences.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** 已完成 v1 迁移的安装执行一次增量升级，旧产品目录保持原样。 */
export async function upgradeLegacyProductPaths(homeDataRoot: string): Promise<void> {
  const home = dirname(homeDataRoot);
  await prepareProductPaths({ homeDirectory: home });
  const oldScratch = join(home, "ZCodeProject");
  if (!(await pathExists(oldScratch))) return;
  const marker = join(homeDataRoot, ".desktop-path-upgrade-v2.json");
  if (await pathExists(marker)) return;
  await migrateLegacyScratchRoot(home);
  const roots = new Set([homeDataRoot]);
  const settingsPath = join(homeDataRoot, "v2", "setting.json");
  if (await pathExists(settingsPath)) {
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { dataBaseDir?: unknown };
    if (typeof settings.dataBaseDir === "string" && settings.dataBaseDir.trim()) {
      roots.add(join(settings.dataBaseDir, PRODUCT_DATA_DIRECTORY_NAME));
    }
  }
  for (const root of roots) {
    const paths = await collectScratchWorkspacePaths(root, oldScratch);
    for (const oldPath of paths) {
      const newPath = join(home, "CodeVoriProject", relative(oldScratch, oldPath));
      await rewriteDefaultWorkspaceReferences(root, oldPath, newPath);
    }
  }
  // 修复依据：数据库和最近项目入口全部更新后才提交标记；中断重试不会重新覆盖新项目文件。
  await mkdir(homeDataRoot, { recursive: true });
  const temporary = `${marker}.${randomUUID()}.tmp`;
  await writeFile(temporary, '{"version":2,"status":"complete"}\n', "utf8");
  await rename(temporary, marker);
}
