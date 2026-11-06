import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  readProjectMemoryInputSchema,
  saveProjectMemoryInputSchema,
} from "../projectMemoryTools.js";
import { prepareProjectMemoryScope } from "./projectMemoryMigration.js";
import { resolveProjectMemoryScope, type ProjectMemoryRootInput } from "./projectMemory.js";
import {
  readProjectMemoryItem,
  saveProjectMemories,
  type ProjectMemoryCandidate,
} from "./projectMemoryWriter.js";

export function projectMemoryRootValidator(storageRoot: string, root: string): () => Promise<void> {
  return async () => {
    for (const directory of [
      storageRoot,
      join(storageRoot, "memories"),
      join(storageRoot, "memories", "projects"),
      dirname(root),
      root,
    ]) {
      const metadata = await lstat(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink())
        throw new Error("Project Memory path is not a regular directory");
    }
    const within = relative(await realpath(storageRoot), await realpath(root));
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within))
      throw new Error("Project Memory path is outside the selected profile");
  };
}

/** One persistence implementation; each runtime supplies its own immutable session scope. */
export async function openProjectMemoryStore(
  input: ProjectMemoryRootInput & { assertActive?: () => void },
) {
  input.assertActive?.();
  const storageRoot = resolve(input.cliStorageRoot);
  const scope = await resolveProjectMemoryScope({ ...input, cliStorageRoot: storageRoot });
  await prepareProjectMemoryScope(scope);
  const validateRoot = projectMemoryRootValidator(storageRoot, scope.root);
  const validate = async () => {
    input.assertActive?.();
    await validateRoot();
  };
  await validate();
  return {
    root: scope.root,
    workspaceId: basename(dirname(scope.root)),
    async readVersions(): Promise<Record<string, string | null>> {
      const index = await readProjectMemoryItem(scope.root, undefined, validate);
      const names = [
        ...new Set(
          [...(index.content ?? "").matchAll(/\]\(([a-z0-9]+(?:-[a-z0-9]+)*)\.md\)/g)].map(
            (match) => match[1]!,
          ),
        ),
      ];
      const entries = await Promise.all(
        names.map(
          async (name) =>
            [name, (await readProjectMemoryItem(scope.root, name, validate)).revision] as const,
        ),
      );
      return Object.fromEntries(entries);
    },
    async read(args: unknown) {
      const { name } = readProjectMemoryInputSchema.parse(args);
      return {
        workspaceId: basename(dirname(scope.root)),
        displayPath: scope.displayPath,
        fileName: name === undefined ? "MEMORY.md" : `${name}.md`,
        ...(await readProjectMemoryItem(scope.root, name, validate)),
      };
    },
    async save(args: unknown) {
      const candidate = saveProjectMemoryInputSchema.parse(args);
      return {
        ...(await saveProjectMemories(scope.root, [candidate], validate))[0]!,
        displayPath: scope.displayPath,
      };
    },
    saveCandidates(candidates: readonly ProjectMemoryCandidate[]) {
      return saveProjectMemories(scope.root, candidates, validate);
    },
  };
}
