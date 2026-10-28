import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  ACP_AGENT_CATALOG,
  acpAgentConfigCatalogSchema,
  acpAgentModelSchema,
  type AcpAgentModel,
  acpSessionSchema,
  type AcpAgent,
  type AcpAgentConfigSnapshot,
  type AcpSession,
  type AcpWorkspace,
} from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { AcpSessionStore } from "./acpSessionStore.js";

const logger = createServiceLogger("acp-agent-configs");
const metadataSchema = acpSessionSchema.pick({
  id: true,
  agent: true,
  workspacePath: true,
  workspaceIdentity: true,
  configOptions: true,
  modeState: true,
  supersededBy: true,
});
type Metadata = ReturnType<typeof metadataSchema.parse>;

export function acpAgentConfigFingerprint(
  session: Pick<AcpSession, "agent" | "configOptions" | "modeState">,
) {
  return JSON.stringify([session.agent, session.configOptions, session.modeState]);
}

export async function readAcpAgentConfigs(
  directory: string,
  workspace: AcpWorkspace | undefined,
  sessions: ReadonlyMap<string, AcpSession>,
  removed: ReadonlySet<string>,
): Promise<AcpAgentConfigSnapshot[]> {
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  // 修复原因：新项目没有历史、任务会话又在工作树下；只读同 Host 的配置元数据，
  // 不能调用 load/refresh 触发历史迁移、工作流恢复或 Agent 握手。
  const disk = await Promise.all(
    names
      .filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name))
      .map(async (name) => {
        try {
          const path = join(directory, name);
          const id = name.slice(0, -5);
          const cached = sessions.get(id);
          const [snapshot, info, journalInfo] = await Promise.all([
            cached ?? new AcpSessionStore(() => path).read(id, { repairTail: false }),
            stat(path),
            stat(`${path}.journal`).catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return null;
              throw error;
            }),
          ]);
          const parsed = metadataSchema.safeParse(snapshot);
          return parsed.success
            ? { session: parsed.data, at: Math.max(info.mtimeMs, journalInfo?.mtimeMs ?? 0) }
            : null;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            logger.warn(undefined, "ACP configuration metadata unreadable");
          return null;
        }
      }),
  );
  const candidates = new Map<string, { session: Metadata; at: number }>();
  for (const candidate of disk) if (candidate) candidates.set(candidate.session.id, candidate);
  // 内存快照是当前 Host 所有者的最新事实，包含尚未落盘的临时会话。
  for (const session of sessions.values()) {
    candidates.set(session.id, {
      session: metadataSchema.parse(session),
      at: candidates.get(session.id)?.at ?? Date.now(),
    });
  }
  const known = new Map<AcpAgent, { snapshot: AcpAgentConfigSnapshot; at: number }>();
  const key = workspace?.workspaceIdentity?.trim() || workspace?.workspacePath;
  for (const { session, at } of candidates.values()) {
    if (
      removed.has(session.id) ||
      session.supersededBy ||
      (!session.configOptions.length && !session.modeState?.availableModes.length)
    )
      continue;
    const source =
      workspace &&
      (session.workspaceIdentity?.trim() || session.workspacePath) === key &&
      session.workspacePath === workspace.workspacePath
        ? "workspace"
        : "host";
    const previous = known.get(session.agent);
    if (
      previous &&
      (previous.snapshot.source === source
        ? previous.at > at
        : previous.snapshot.source === "workspace")
    )
      continue;
    known.set(session.agent, {
      at,
      snapshot: {
        agent: session.agent,
        source,
        configOptions: session.configOptions,
        modeState: session.modeState,
      },
    });
  }
  return acpAgentConfigCatalogSchema.parse(
    ACP_AGENT_CATALOG.flatMap(({ id }) => {
      const item = known.get(id);
      return item ? [item.snapshot] : [];
    }),
  );
}

/** Preserve the adapter's IDs and labels, including user-configured aliases. */
export function projectAcpAgentModels(
  snapshot: AcpAgentConfigSnapshot | undefined,
): AcpAgentModel[] {
  const option = snapshot?.configOptions.find(
    (item) => item.type === "select" && (item.category === "model" || item.id === "model"),
  );
  if (option?.type !== "select") return [];
  const seen = new Set<string>();
  return option.options
    .flatMap((item) => ("group" in item ? item.options : [item]))
    .flatMap((item) => {
      if (!item.value || seen.has(item.value)) return [];
      seen.add(item.value);
      return [acpAgentModelSchema.parse({ slug: item.value, name: item.name })];
    });
}
