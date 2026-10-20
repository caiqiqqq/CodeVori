import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  acpPermissionSelectionSchema,
  type AcpAgent,
  type AcpPermissionSelection,
  type AcpSession,
  type AcpWorkspace,
} from "@zcode/shared";
import { acpConfigValues } from "./acpConfigOptions.js";
import type { AcpConnectionPort } from "./acpServiceImpl.js";

type PermissionCatalog = Pick<AcpSession, "configOptions" | "modeState">;

export function isAcpPermissionOption(option: AcpSession["configOptions"][number]): boolean {
  return option.type === "select" && (option.category === "mode" || option.id === "mode");
}

export function sessionPermissionSelection(
  session: PermissionCatalog,
  configId?: string,
): AcpPermissionSelection | undefined {
  const option = session.configOptions.find(
    (item) => (!configId || item.id === configId) && isAcpPermissionOption(item),
  );
  if (option?.type === "select") return { configId: option.id, value: option.currentValue };
  if (!session.configOptions.length && session.modeState && (!configId || configId === "mode"))
    return { configId: "mode", value: session.modeState.currentModeId };
  return undefined;
}

export async function restoreAcpPermission(
  catalog: PermissionCatalog,
  selection: AcpPermissionSelection | undefined,
  port: Pick<AcpConnectionPort, "setConfigOption" | "setMode">,
): Promise<PermissionCatalog> {
  if (!selection) return catalog;
  const option = catalog.configOptions.find((item) => item.id === selection.configId);
  if (option?.type === "select" && isAcpPermissionOption(option)) {
    if (!acpConfigValues(option).includes(selection.value))
      throw new Error("ACP saved permission value is not available; select a supported mode");
    if (option.currentValue === selection.value) return catalog;
    const next = await port.setConfigOption(selection.configId, selection.value);
    if (next.find((item) => item.id === selection.configId)?.currentValue !== selection.value)
      throw new Error("ACP Agent did not apply the saved permission mode");
    return { ...catalog, configOptions: next };
  }
  if (!catalog.configOptions.length && selection.configId === "mode" && catalog.modeState) {
    if (!catalog.modeState.availableModes.some((mode) => mode.id === selection.value))
      throw new Error("ACP saved permission value is not available; select a supported mode");
    if (catalog.modeState.currentModeId !== selection.value) await port.setMode(selection.value);
    return { ...catalog, modeState: { ...catalog.modeState, currentModeId: selection.value } };
  }
  throw new Error("ACP saved permission option is not available; select a supported mode");
}

/** Host-local preference owner; attachment IDs never participate in the durable key. */
export class AcpPermissionPreferences {
  private readonly writes = new Map<string, Promise<void>>();

  constructor(private readonly directory: string) {}

  private file(workspace: AcpWorkspace, agent: AcpAgent): string {
    const key = [workspace.workspaceIdentity?.trim() || workspace.workspacePath, agent];
    const hash = createHash("sha256").update(JSON.stringify(key)).digest("hex");
    return join(this.directory, `${hash}.json`);
  }

  async read(
    workspace: AcpWorkspace,
    agent: AcpAgent,
  ): Promise<AcpPermissionSelection | undefined> {
    const path = this.file(workspace, agent);
    await this.writes.get(path);
    try {
      return acpPermissionSelectionSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("ACP permission preference could not be read", { cause: error });
    }
  }

  async remember(workspace: AcpWorkspace, agent: AcpAgent, selection: AcpPermissionSelection) {
    const path = this.file(workspace, agent);
    const value = acpPermissionSelectionSchema.parse(selection);
    const next = (this.writes.get(path) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          await mkdir(this.directory, { recursive: true });
          await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
          await rename(temporary, path);
        } catch (error) {
          throw new Error("ACP permission preference could not be saved; retry the selection", {
            cause: error,
          });
        } finally {
          await rm(temporary, { force: true }).catch(() => {});
        }
      });
    this.writes.set(path, next);
    try {
      await next;
    } finally {
      if (this.writes.get(path) === next) this.writes.delete(path);
    }
  }

  async settle(): Promise<void> {
    await Promise.allSettled(this.writes.values());
  }
}
