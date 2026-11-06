import { join, resolve } from "node:path";
import {
  buildProjectMemoryInstructions,
  openProjectMemoryStore,
  projectMemoryRootValidator,
  prepareProjectMemoryScope,
  resolveProjectMemoryScope,
  PROJECT_MEMORY_INDEX_LINE_LIMIT,
  PROJECT_MEMORY_INDEX_CHARACTER_LIMIT,
} from "@zcode/shared/node";
import type { AcpWorkspace } from "@zcode/shared";
import { readProjectMemoryFileFromStableHandle } from "./projectMemoryStableRead.js";
import { type ProjectMemoryCandidate } from "./projectMemoryWriter.js";

export interface ProjectMemoryContext {
  buildPromptContext(workspace: AcpWorkspace): Promise<string | undefined>;
  readVersions?(workspace: AcpWorkspace): Promise<Record<string, string | null>>;
  tools?: {
    isEnabled(): Promise<boolean>;
    call(
      workspace: AcpWorkspace,
      name: string,
      args: unknown,
      assertActive: () => void,
    ): Promise<unknown>;
  };
  saveMemories(
    workspace: AcpWorkspace,
    candidates: readonly ProjectMemoryCandidate[],
  ): Promise<void>;
}

const INDEX_FILE = "MEMORY.md";

const isMissing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

/** Selected Host reads the same files as API; the external Agent retains file-write permissions. */
export function createProjectMemoryContext(input: {
  cliStorageRoot: string;
  isEnabled(): Promise<boolean>;
}): ProjectMemoryContext {
  const context: ProjectMemoryContext = {
    async readVersions(workspace) {
      if (!(await input.isEnabled())) throw new Error("Project Memory is disabled");
      return (
        await openProjectMemoryStore({ ...workspace, cliStorageRoot: input.cliStorageRoot })
      ).readVersions();
    },
    async buildPromptContext(workspace) {
      // 修复原因：ACP 原先完全绕过工作区记忆；关闭时必须在任何文件 IO 前返回。
      if (!(await input.isEnabled())) return undefined;
      const storageRoot = resolve(input.cliStorageRoot);
      const scope = await resolveProjectMemoryScope({ ...workspace, cliStorageRoot: storageRoot });
      const root = scope.root;
      const validate = projectMemoryRootValidator(storageRoot, root);
      await prepareProjectMemoryScope(scope);
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
        "Respect the user's instructions and current tool permissions. Recall relevant project facts and save durable updates with the project memory tools when appropriate. Do not save secrets, temporary output, or duplicate facts; never bypass permissions.",
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
    async saveMemories(workspace, candidates) {
      if (!(await context.buildPromptContext(workspace)))
        throw new Error("Project Memory is disabled");
      const store = await openProjectMemoryStore({
        ...workspace,
        cliStorageRoot: input.cliStorageRoot,
      });
      await store.saveCandidates(candidates);
    },
    tools: {
      isEnabled: input.isEnabled,
      async call(workspace, name, args, assertActive) {
        assertActive();
        if (!(await input.isEnabled())) throw new Error("Project Memory is disabled");
        const store = await openProjectMemoryStore({
          ...workspace,
          cliStorageRoot: input.cliStorageRoot,
          assertActive,
        });
        if (name === "ReadProjectMemory") return store.read(args);
        if (name === "SaveProjectMemory") return store.save(args);
        throw new Error("Unknown Project Memory tool");
      },
    },
  };
  return context;
}
