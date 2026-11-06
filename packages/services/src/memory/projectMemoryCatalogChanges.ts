import { watch, type FSWatcher } from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Emitter } from "@zcode/rpc";
import { createServiceLogger } from "../logger/serviceLogger.js";

/** Cross-process invalidation only; the catalog remains a projection of project files. */
export function createProjectMemoryCatalogChanges(resolveRoot: () => string) {
  let watcher: FSWatcher | undefined;
  let generation = 0;
  const changed = new Emitter<void>({
    onWillAddFirstListener() {
      const current = ++generation;
      const root = resolveRoot();
      void (async () => {
        // 中文依据：CLI 和 ACP 分属不同进程；只观察记忆目录，避免递归监听整个 profile。
        for (const directory of [
          dirname(dirname(dirname(root))),
          dirname(dirname(root)),
          dirname(root),
          root,
        ]) {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const metadata = await lstat(directory);
          if (!metadata.isDirectory() || metadata.isSymbolicLink())
            throw new Error("Project Memory watch root is not a regular directory");
        }
        if (current !== generation) return;
        watcher = watch(root, { recursive: true, persistent: false }, (_event, file) => {
          if (file && /^[^/]+\/memory\/[^/]+\.md$/.test(String(file).replace(/\\/g, "/")))
            changed.fire(undefined);
        });
        watcher.on("error", (error) =>
          createServiceLogger("memory").warn(undefined, "Project memory watch failed", { error }),
        );
        // 异步启动监听器期间可能已有保存完成；建立监听后重读，补齐这个启动窗口。
        changed.fire(undefined);
      })().catch((error: unknown) => {
        createServiceLogger("memory").warn(undefined, "Project memory watch unavailable", {
          error,
        });
      });
    },
    onDidRemoveLastListener() {
      generation++;
      watcher?.close();
      watcher = undefined;
    },
  });
  return changed.event;
}
