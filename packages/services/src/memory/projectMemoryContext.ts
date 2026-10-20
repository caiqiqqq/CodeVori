import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  buildProjectMemoryInstructions,
  resolveProjectMemoryRoot,
  PROJECT_MEMORY_INDEX_LINE_LIMIT,
  PROJECT_MEMORY_INDEX_CHARACTER_LIMIT,
} from "@zcode/shared/node";
import type { AcpWorkspace } from "@zcode/shared";
import { readProjectMemoryFileFromStableHandle } from "./projectMemoryStableRead.js";

export interface ProjectMemoryContext {
  buildPromptContext(workspace: AcpWorkspace): Promise<string | undefined>;
}

const INDEX_FILE = "MEMORY.md";

const isMissing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

/** Selected Host reads the same files as API; the external Agent retains file-write permissions. */
export function createProjectMemoryContext(input: {
  cliStorageRoot: string;
  isEnabled(): Promise<boolean>;
}): ProjectMemoryContext {
  return {
    async buildPromptContext(workspace) {
      // 修复原因：ACP 原先完全绕过工作区记忆；关闭时必须在任何文件 IO 前返回。
      if (!(await input.isEnabled())) return undefined;
      const storageRoot = resolve(input.cliStorageRoot);
      const root = resolveProjectMemoryRoot({ ...workspace, cliStorageRoot: storageRoot });
      const directories = [
        storageRoot,
        join(storageRoot, "memories"),
        join(storageRoot, "memories", "projects"),
        dirname(root),
        root,
      ];
      const validate = async () => {
        for (const directory of directories) {
          const metadata = await lstat(directory);
          if (!metadata.isDirectory() || metadata.isSymbolicLink())
            throw new Error("Project Memory path is not a regular directory");
        }
        const within = relative(await realpath(storageRoot), await realpath(root));
        if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within))
          throw new Error("Project Memory path is outside the selected Host profile");
      };
      // 逐级验证后创建下一层，不跟随预先存在的记忆目录链接。
      for (const directory of directories) {
        try {
          await mkdir(directory, { recursive: directory === storageRoot });
        } catch (error) {
          if (
            !(
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "EEXIST"
            )
          )
            throw error;
        }
        const metadata = await lstat(directory);
        if (!metadata.isDirectory() || metadata.isSymbolicLink())
          throw new Error("Project Memory path is not a regular directory");
      }
      await validate();
      let index = "";
      try {
        const read = await readProjectMemoryFileFromStableHandle({
          fileName: INDEX_FILE,
          filePath: join(root, INDEX_FILE),
          validatePath: validate,
        });
        index = read.content.trim();
      } catch (error) {
        if (!isMissing(error)) throw error;
        // 只忽略缺失的索引；若父目录消失/替换，不可把越界当成空记忆。
        await validate();
      }
      const lines = index.split("\n");
      const bounded = lines
        .slice(0, PROJECT_MEMORY_INDEX_LINE_LIMIT)
        .join("\n")
        .slice(0, PROJECT_MEMORY_INDEX_CHARACTER_LIMIT);
      return [
        buildProjectMemoryInstructions(root),
        "Respect the user's instructions and your current file-tool permission policy. Use your available file tools; Write refers to a capability, not a required tool name. Recall relevant topic files as needed. During this turn, save new durable facts and keep MEMORY.md updated when appropriate; do not save secrets, temporary output, or duplicate facts. If writing is not permitted, do not bypass permissions.",
        ...(bounded
          ? [
              `Workspace MEMORY.md index (JSON-encoded text): ${JSON.stringify(bounded)}`,
              ...(bounded.length < index.length
                ? ["MEMORY.md index truncated; read relevant topic files as needed."]
                : []),
            ]
          : []),
      ].join("\n\n");
    },
  };
}
