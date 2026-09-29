/* oxlint-disable eslint(max-lines) -- ACP Host owner keeps admission, persistence, permission and process-generation checks in one state machine. */
import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Emitter } from "@zcode/rpc";
import type { ContentBlock, PromptCapabilities } from "@agentclientprotocol/sdk";
import {
  acpAgentAvailabilityListSchema,
  acpAgentDefinition,
  acpCreateInputSchema,
  acpDiagnosticEventSchema,
  acpPromptInputSchema,
  acpSessionSchema,
  acpSessionRowUpdateSchema,
  acpSessionSearchInputSchema,
  acpWorkspaceSchema,
  isAcpHistorySession,
  type AcpAgent,
  type AcpConfigOption,
  type AcpModeState,
  type AcpEntry,
  type AcpDiagnosticEvent,
  type AcpSession,
  type AcpSessionChanged,
  type AcpWorkspace,
  type AcpUsageReport,
  type NativeMcpServerRecord,
  type ZCodePluginsAcpCapabilitiesResult,
  type AcpPlugin,
  acpWorkflowControlSchema,
  acpWorkflowArtifactQuerySchema,
} from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { getZCodeDataRootDir } from "../paths.js";
import type { IMcpSyncService } from "../mcp-sync/mcpSync.js";
import type { ISkillsService } from "../skills/skills.js";
import type { IAcpService } from "./acpService.js";
import { AcpSessionLoadError, connectAcpAgent } from "./acpStdioConnection.js";
import { buildAcpPromptBlocks } from "./acpPromptBlocks.js";
import { projectAcpPluginMcpServers } from "./acpMcpServers.js";
import { createAcpWorkflowMcp } from "./acpWorkflowMcp.js";
import { AcpWorkflowHost } from "./acpWorkflowHost.js";
import { acpConfigValues } from "./acpConfigOptions.js";
import { searchAcpSessions } from "./acpSessionSearch.js";
import { recordAcpPromptUsage, summarizeAcpUsage } from "./acpUsageStats.js";
import {
  availableAcpPlugins,
  buildAcpPluginPrompt,
  referencedAcpPlugins,
} from "./acpPluginContext.js";
import {
  createAcpAgentManager,
  type AcpAgentLaunch,
  type AcpAgentManager,
} from "./acpAgentManager.js";

export type AcpUpdate =
  | { kind: "text"; text: string; messageId?: string }
  | { kind: "tool"; id: string; title?: string; status?: string; content?: string }
  | { kind: "config"; configOptions: AcpConfigOption[] }
  | { kind: "mode"; modeId: string };
export interface AcpPermission {
  requestId: string;
  title: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
}
export interface AcpConnectionPort {
  sessionId: string;
  closed?: Promise<void>;
  promptCapabilities?: PromptCapabilities;
  provisionedMcpNames?: ReadonlySet<string>;
  configOptions: AcpConfigOption[];
  modeState: AcpModeState | null;
  setConfigOption(configId: string, value: string | boolean): Promise<AcpConfigOption[]>;
  setMode(modeId: string): Promise<void>;
  prompt(text: string, blocks?: ContentBlock[]): Promise<AcpUsageReport | null | void>;
  cancel(): Promise<void>;
  close(): void;
}
export type AcpConnectionFactory = (input: {
  agent: AcpAgent;
  workspacePath: string;
  sessionId?: string;
  launch?: AcpAgentLaunch;
  mcpServers?: NativeMcpServerRecord[];
  workflowServers?: NativeMcpServerRecord[];
  pluginServers?: ZCodePluginsAcpCapabilitiesResult["servers"];
  onUpdate: (update: AcpUpdate) => Promise<void>;
  onPermission: (request: AcpPermission) => Promise<string | null>;
  onExit: (reason: string) => void;
}) => Promise<AcpConnectionPort>;

const logger = createServiceLogger("acp-sessions");
const workspaceKey = (workspace: AcpWorkspace): string =>
  workspace.workspaceIdentity?.trim() || workspace.workspacePath;
const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const MAX_DIAGNOSTIC_BYTES = 2 * 1024 * 1024;

function diagnosticToolStatus(status?: string): AcpDiagnosticEvent["status"] {
  return status === "pending" ||
    status === "in_progress" ||
    status === "completed" ||
    status === "failed"
    ? status
    : "unknown";
}

/** Host owner. The adapter owns model context; this service owns display facts and admission. */
export function createAcpService(
  options: {
    directory?: string;
    connect?: AcpConnectionFactory;
    agentManager?: AcpAgentManager;
    mcpSyncService?: Pick<IMcpSyncService, "loadMcpFromUserDirectory">;
    skillsService?: Pick<ISkillsService, "buildPromptContext"> &
      Partial<Pick<ISkillsService, "list">>;
    pluginSource?: {
      getAcpPluginCapabilities(params: AcpWorkspace): Promise<ZCodePluginsAcpCapabilitiesResult>;
    };
  } = {},
): IAcpService & { disposeAll(): void; disposeAllAndWait(): Promise<void> } {
  const directory = options.directory ?? join(getZCodeDataRootDir(), "acp-sessions");
  const connect = options.connect ?? connectAcpAgent;
  const agentManager =
    options.agentManager ??
    createAcpAgentManager({
      directory: options.directory ? join(options.directory, "agent-settings") : undefined,
    });
  const sessions = new Map<string, AcpSession>();
  const connections = new Map<string, AcpConnectionPort>();
  const connecting = new Map<string, Promise<AcpConnectionPort>>();
  const loading = new Map<string, Promise<AcpSession>>();
  const recovering = new Map<string, Promise<AcpSession>>();
  const creating = new Map<string, Promise<AcpSession>>();
  const created = new Map<string, string>();
  const generations = new Map<string, object>();
  const removed = new Set<string>();
  const writes = new Map<string, Promise<void>>();
  const diagnosticWrites = new Map<string, Promise<void>>();
  const active = new Map<string, string>();
  const stopping = new Set<string>();
  const configuring = new Set<string>();
  const pending = new Map<string, { requestId: string; resolve(value: string | null): void }>();
  const workflowMcp = createAcpWorkflowMcp(directory);
  const workflowRegistrations = new Map<string, { revoke(): void }>();
  const permissionQueues = new Map<string, Array<{
    request: AcpPermission; runId?: string; resolve(value: string | null): void;
  }>>();
  const workflowNotifications = new Map<string, Array<{ runId: string; result: unknown }>>();
  const workflowNotifying = new Set<string>();
  const notificationTasks = new Set<Promise<void>>();
  const emitter = new Emitter<AcpSessionChanged>();
  let disposed = false;

  const file = (id: string): string => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid ACP session id");
    return join(directory, `${id}.json`);
  };
  const diagnosticDirectory = join(directory, "diagnostics");
  const diagnosticFile = (id: string): string =>
    join(diagnosticDirectory, `${id.replace(/[^0-9a-f-]/gi, "")}.jsonl`);
  const appendDiagnostic = (
    session: AcpSession,
    event: Omit<AcpDiagnosticEvent, "timestamp">,
  ): Promise<void> => {
    if (session.provisional || removed.has(session.id)) return Promise.resolve();
    const id = session.id;
    const previous = diagnosticWrites.get(id) ?? Promise.resolve();
    // 修复原因：ACP 更新可能并发到达；日志按 Host 接收顺序串行写入，且仅记录白名单元数据。
    const next = previous
      .then(async () => {
        if (removed.has(id)) return;
        await mkdir(diagnosticDirectory, { recursive: true });
        const path = diagnosticFile(id);
        const bytes = await stat(path)
          .then((value) => value.size)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return 0;
            throw error;
          });
        if (bytes >= MAX_DIAGNOSTIC_BYTES) return;
        await appendFile(
          path,
          `${JSON.stringify(acpDiagnosticEventSchema.parse({ ...event, timestamp: Date.now() }))}\n`,
          { mode: 0o600 },
        );
      })
      .catch((error) =>
        logger.warn(undefined, "ACP diagnostic write failed", { error: failureMessage(error) }),
      );
    diagnosticWrites.set(id, next);
    return next;
  };
  const ensureDiagnosticFile = async (session: AcpSession): Promise<string> => {
    if (!isAcpHistorySession(session) || removed.has(session.id) || disposed)
      throw new Error("ACP session has no durable history");
    const path = diagnosticFile(session.id);
    // 修复原因：路径查询和删除也要排在同一会话日志队列，避免删除后迟到查询重建空文件。
    const previous = diagnosticWrites.get(session.id) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (removed.has(session.id) || disposed) throw new Error("ACP session closed");
      await mkdir(diagnosticDirectory, { recursive: true });
      await appendFile(path, "", { mode: 0o600 });
      return path;
    });
    diagnosticWrites.set(
      session.id,
      next.then(
        () => {},
        () => {},
      ),
    );
    return next;
  };
  const save = async (session: AcpSession): Promise<void> => {
    if (removed.has(session.id)) return;
    const snapshot = acpSessionSchema.parse(structuredClone(session));
    if (snapshot.provisional) {
      // 修复原因：Codeg 会预连接取得 Agent 选项，但空草稿不能先进入持久会话历史。
      if (!disposed) emitter.fire({ kind: "updated", session: snapshot });
      return;
    }
    const previous = writes.get(session.id) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        await mkdir(directory, { recursive: true });
        const temporary = `${file(snapshot.id)}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
          await rename(temporary, file(snapshot.id));
          if (!disposed) emitter.fire({ kind: "updated", session: snapshot });
        } finally {
          await rm(temporary, { force: true });
        }
      });
    writes.set(session.id, next);
    await next;
  };
  const mutate = async (session: AcpSession, change: () => void): Promise<void> => {
    change();
    session.revision += 1;
    await save(session);
  };
  const load = async (id: string): Promise<AcpSession> => {
    const cached = sessions.get(id);
    if (cached) return cached;
    const inFlight = loading.get(id);
    if (inFlight) return inFlight;
    const task = (async () => {
      const session = acpSessionSchema.parse(JSON.parse(await readFile(file(id), "utf8")));
      let migratedLegacyTime = false;
      if (
        session.legacySavedAt === undefined &&
        session.entries.some((entry) => entry.kind === "user") &&
        !session.entries.some((entry) => typeof entry.createdAt === "number")
      ) {
        // 修复原因：旧快照没有消息时间；文件以临时文件替换保存，mtime 只可作
        // 一次性的近似历史排序依据，绝不能回填到旧消息或在每次重连时重新取值。
        const savedAt = Math.floor((await stat(file(id))).mtimeMs);
        if (Number.isFinite(savedAt) && savedAt > 0) {
          session.legacySavedAt = savedAt;
          migratedLegacyTime = true;
        }
      }
      const wasRunning = session.status === "running";
      if (wasRunning) {
        // 进程已重启，旧执行结果未知；不能把磁盘上的 running 当作仍可取消的活轮。
        session.status = "interrupted";
        session.usageBaselineKnown = false;
        session.pendingPermission = null;
        session.error = "ACP Agent 已断开，请重试发送新的消息。";
      }
      if (migratedLegacyTime || wasRunning) {
        session.revision += 1;
        await save(session);
      }
      sessions.set(id, session);
      await workflowHost.restore(session);
      return session;
    })();
    loading.set(id, task);
    try {
      return await task;
    } finally {
      loading.delete(id);
    }
  };
  const scoped = async (input: AcpWorkspace & { id: string }): Promise<AcpSession> => {
    const target = acpWorkspaceSchema.parse(input);
    const session = await load(input.id);
    if (
      workspaceKey(session) !== workspaceKey(target) ||
      session.workspacePath !== target.workspacePath
    ) {
      throw new Error("ACP session does not belong to this workspace");
    }
    return session;
  };
  const settlePermission = (id: string): void => {
    pending.get(id)?.resolve(null);
    pending.delete(id);
    for (const request of permissionQueues.get(id) ?? []) request.resolve(null);
    permissionQueues.delete(id);
  };
  const requestPermission = (session: AcpSession, request: AcpPermission, runId?: string): Promise<string | null> =>
    new Promise((resolve) => {
      const queue = permissionQueues.get(session.id) ?? [];
      queue.push({ request, runId, resolve });
      permissionQueues.set(session.id, queue);
      if (queue.length === 1) void showNextPermission(session);
    });
  const settleWorkflowPermissions = async (session: AcpSession, runId: string): Promise<void> => {
    const queue = permissionQueues.get(session.id);
    if (!queue?.some((item) => item.runId === runId)) return;
    const activeRequest = queue[0]?.runId === runId ? queue[0] : undefined;
    const remaining = queue.filter((item) => item.runId !== runId);
    if (remaining.length) permissionQueues.set(session.id, remaining);
    else permissionQueues.delete(session.id);
    if (activeRequest && pending.get(session.id)?.requestId === activeRequest.request.requestId) {
      pending.delete(session.id);
      // 修复原因：取消一个后台 run 时只撤销它的权限，不能清掉主 ACP 回合或其它 run 的请求。
      await mutate(session, () => { session.pendingPermission = null; });
      if (remaining.length) void showNextPermission(session);
    }
    for (const item of queue) if (item.runId === runId) item.resolve(null);
  };
  const showNextPermission = async (session: AcpSession): Promise<void> => {
    const next = permissionQueues.get(session.id)?.[0];
    if (!next || pending.has(session.id) || removed.has(session.id)) return;
    pending.set(session.id, { requestId: next.request.requestId, resolve: next.resolve });
    try {
      await mutate(session, () => { session.pendingPermission = next.request; });
      await appendDiagnostic(session, { kind: "permission-requested" });
    } catch (error) {
      logger.warn(undefined, "ACP permission persistence failed", { error: failureMessage(error) });
      settlePermission(session.id);
    }
  };
  const deliverWorkflowNotifications = async (session: AcpSession): Promise<void> => {
    if (disposed || removed.has(session.id) || active.has(session.id) || workflowNotifying.has(session.id)) return;
    const notifications = workflowNotifications.get(session.id);
    const port = connections.get(session.id);
    if (!port || !notifications?.length) return;
    workflowNotifying.add(session.id);
    workflowNotifications.delete(session.id);
    const commandId = `workflow-result:${randomUUID()}`;
    active.set(session.id, commandId);
    let delivered = false;
    try {
      await mutate(session, () => { session.status = "running"; });
      const text = `ZCode 工作流运行结果：${JSON.stringify(notifications)}。请根据结果继续回答用户原来的问题。`;
      const usage = await port.prompt(text, [{ type: "text", text }]);
      if (active.get(session.id) === commandId) {
        await mutate(session, () => {
          recordAcpPromptUsage(session, commandId, usage);
          session.status = "idle";
        });
        delivered = true;
      }
    } catch (error) {
      logger.warn(undefined, "ACP workflow result delivery failed", { error: failureMessage(error) });
      workflowNotifications.set(session.id, [...notifications, ...(workflowNotifications.get(session.id) ?? [])]);
      if (active.get(session.id) === commandId)
        await mutate(session, () => { session.status = "interrupted"; session.error = failureMessage(error); });
    } finally {
      if (active.get(session.id) === commandId) active.delete(session.id);
      workflowNotifying.delete(session.id);
      // 修复原因：上一轮发送通知时另一个 run 可能结算；成功后继续清空队列。
      // 本次发送失败时保留通知，等待下一个用户回合，不在失败连接上忙循环。
      if (delivered && workflowNotifications.get(session.id)?.length)
        scheduleWorkflowNotifications(session);
    }
  };
  const scheduleWorkflowNotifications = (session: AcpSession): void => {
    const task = deliverWorkflowNotifications(session);
    notificationTasks.add(task);
    void task.catch((error: unknown) => {
      logger.warn(undefined, "ACP workflow notification persistence failed", { error: failureMessage(error) });
    }).finally(() => { notificationTasks.delete(task); });
  };
  const workflowHost = new AcpWorkflowHost({
    directory, connect, mcp: workflowMcp, mutate,
    sources: async (session) => {
      const [mcpSettings, launch, plugins] = await Promise.all([
        options.mcpSyncService?.loadMcpFromUserDirectory({ workspacePath: session.workspacePath }),
        options.connect && !options.agentManager ? undefined : agentManager.resolveLaunch(session.agent),
        options.pluginSource?.getAcpPluginCapabilities({
          workspacePath: session.workspacePath,
          ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
          ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
        }),
      ]);
      return { mcpServers: mcpSettings?.servers ?? [], ...(launch ? { launch } : {}),
        ...(plugins ? { pluginServers: plugins.servers } : {}) };
    },
    permission: async (session, request, runId) => {
      if (disposed || removed.has(session.id) || (!active.has(session.id) && !workflowHost.ownsLive(session.id))) return null;
      return requestPermission(session, request, runId);
    },
    notify: async (session, runId, result) => {
      await settleWorkflowPermissions(session, runId);
      const list = workflowNotifications.get(session.id) ?? [];
      list.push({ runId, result });
      workflowNotifications.set(session.id, list);
      scheduleWorkflowNotifications(session);
    },
  });
  const detach = (id: string): void => {
    generations.delete(id);
    settlePermission(id);
    workflowRegistrations.get(id)?.revoke();
    workflowRegistrations.delete(id);
    connections.get(id)?.close();
    connections.delete(id);
    connecting.delete(id);
  };
  const attach = async (session: AcpSession): Promise<AcpConnectionPort> => {
    const current = connections.get(session.id);
    if (current) return current;
    const inFlight = connecting.get(session.id);
    if (inFlight) return inFlight;
    const generation = {};
    generations.set(session.id, generation);
    let receivedConfig = false;
    let updatedModeId: string | undefined;
    // 修复原因：若仅在设置页检查启用/安装状态，create 与 session/load 仍会从旧静态命令
    // 启动禁用的 Agent。每次新连接都向同一个 Host 设置所有者重新解析，复用连接不重启。
    const task = (async () => {
      const [mcpSettings, launch, plugins] = await Promise.all([
        options.mcpSyncService?.loadMcpFromUserDirectory({ workspacePath: session.workspacePath }),
        options.connect && !options.agentManager
          ? undefined
          : agentManager.resolveLaunch(session.agent),
        options.pluginSource?.getAcpPluginCapabilities({
          workspacePath: session.workspacePath,
          ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
          ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
        }),
      ]);
      const workflowRegistration = await workflowHost.register(session);
      workflowRegistrations.set(session.id, workflowRegistration);
      return connect({
        agent: session.agent,
        workspacePath: session.workspacePath,
        sessionId: session.acpSessionId || undefined,
        ...(mcpSettings ? { mcpServers: mcpSettings.servers } : {}),
        workflowServers: [workflowRegistration.record],
        ...(plugins ? { pluginServers: plugins.servers } : {}),
        ...(launch ? { launch } : {}),
        onUpdate: async (update) => {
          if (generations.get(session.id) !== generation || removed.has(session.id)) return;
          if (update.kind === "config" || update.kind === "mode") {
            if (update.kind === "config") receivedConfig = true;
            else updatedModeId = update.modeId;
            // session/new 尚未写入 Agent sessionId，提前到达的通知只能先并入首个快照。
            if (!session.acpSessionId) {
              if (update.kind === "config") session.configOptions = update.configOptions;
              return;
            }
            await mutate(session, () => {
              if (update.kind === "config") session.configOptions = update.configOptions;
              else if (session.modeState) session.modeState.currentModeId = update.modeId;
            });
            return;
          }
          const commandId = active.get(session.id);
          if (!commandId) return;
          await mutate(session, () => {
            if (update.kind === "text") {
              const baseId = `assistant:${commandId}:${update.messageId ?? "default"}`;
              const previous = session.entries.at(-1);
              // 修复原因：多数 ACP 适配器不传 messageId；工具后的正文不能继续拼到工具前，
              // 否则原时间线无法识别最终答复。相邻 chunk 复用同一段，跨工具按 Host 行序新建。
              if (
                previous?.kind === "assistant" &&
                (previous.id === baseId || previous.id.startsWith(`${baseId}:segment:`))
              ) {
                previous.text += update.text;
              } else {
                const id = session.entries.some((entry) => entry.id === baseId)
                  ? `${baseId}:segment:${session.entries.length}`
                  : baseId;
                session.entries.push({
                  id,
                  kind: "assistant",
                  text: update.text,
                  createdAt: Date.now(),
                });
              }
            } else {
              const id = `tool:${commandId}:${update.id}`;
              const index = session.entries.findIndex((entry) => entry.id === id);
              const previous = session.entries[index];
              const tool: AcpEntry = {
                id,
                kind: "tool",
                title: update.title ?? (previous?.kind === "tool" ? previous.title : update.id),
                createdAt: previous?.createdAt ?? Date.now(),
                status:
                  update.status ?? (previous?.kind === "tool" ? previous.status : "in_progress"),
              };
              if (update.content) tool.content = update.content;
              else if (previous?.kind === "tool" && previous.content)
                tool.content = previous.content;
              if (index >= 0) session.entries[index] = tool;
              else session.entries.push(tool);
            }
          });
          if (update.kind === "tool")
            await appendDiagnostic(session, {
              kind: "tool-update",
              status: diagnosticToolStatus(update.status),
            });
        },
        onPermission: async (request) => {
          if (!active.has(session.id) || generations.get(session.id) !== generation) return null;
          return requestPermission(session, request);
        },
        onExit: (reason) => {
          if (generations.get(session.id) !== generation) return;
          generations.delete(session.id);
          workflowHost.stopSession(session.id);
          workflowRegistrations.get(session.id)?.revoke();
          workflowRegistrations.delete(session.id);
          // Adapter root 已退出仍需回收其进程组内可能存活的 App Server 后代。
          connections.get(session.id)?.close();
          connections.delete(session.id);
          settlePermission(session.id);
          session.usageBaselineKnown = false;
          if (!active.has(session.id)) return;
          active.delete(session.id);
          scheduleWorkflowNotifications(session);
          void mutate(session, () => {
            session.pendingPermission = null;
            session.status = "interrupted";
            session.usageBaselineKnown = false;
            session.error = reason;
          })
            .then(() => appendDiagnostic(session, { kind: "adapter-exited" }))
            .catch((error) =>
              logger.warn(undefined, "ACP process exit update failed", {
                error: failureMessage(error),
              }),
            );
        },
      });
    })();
    connecting.set(session.id, task);
    try {
      const port = await task;
      if (disposed || removed.has(session.id) || generations.get(session.id) !== generation) {
        port.close();
        throw new Error("ACP session closed while connecting");
      }
      connections.set(session.id, port);
      // 修复原因：握手后立刻推送的配置比 session/new、session/load 响应更新。
      // 先记录通知，再补齐响应中的目录，不用旧响应反向覆盖 Agent 的新状态。
      if (session.acpSessionId) {
        await mutate(session, () => {
          // 修复原因：新进程重新连接已有 ACP 会话后，适配器可能重置累计计数；
          // 首份报告必须先重建基线，不能与上一个进程的快照直接求差。
          session.usageBaselineKnown = false;
          if (!receivedConfig) session.configOptions = port.configOptions ?? [];
          session.modeState = port.modeState ?? null;
          if (session.modeState && updatedModeId) session.modeState.currentModeId = updatedModeId;
        });
      } else {
        if (!receivedConfig) session.configOptions = port.configOptions ?? [];
        session.modeState = port.modeState ?? null;
        if (session.modeState && updatedModeId) session.modeState.currentModeId = updatedModeId;
      }
      if (generations.get(session.id) !== generation || removed.has(session.id)) {
        port.close();
        throw new Error("ACP session closed while connecting");
      }
      return port;
    } finally {
      connecting.delete(session.id);
    }
  };

  const recoverEmptySession = async (session: AcpSession): Promise<AcpSession> => {
    const inFlight = recovering.get(session.id);
    if (inFlight) return inFlight;
    const task = (async () => {
      const replacement = await service.create({
        workspacePath: session.workspacePath,
        ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
        ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
        agent: session.agent,
      });
      let current = replacement;
      let incomplete = false;
      for (const previous of session.configOptions) {
        const available = current.configOptions.find((option) => option.id === previous.id);
        if (!available || available.type !== previous.type) {
          incomplete = true;
          continue;
        }
        if (available.currentValue === previous.currentValue) continue;
        if (
          available.type === "select" &&
          (typeof previous.currentValue !== "string" ||
            !acpConfigValues(available).includes(previous.currentValue))
        ) {
          incomplete = true;
          continue;
        }
        try {
          current = await service.setConfigOption({
            workspacePath: session.workspacePath,
            ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
            ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
            id: replacement.id,
            configId: previous.id,
            value: previous.currentValue,
          });
        } catch (error) {
          incomplete = true;
          logger.warn(undefined, "ACP replacement could not restore an option", {
            agent: session.agent,
            configId: previous.id,
            error: failureMessage(error),
          });
        }
      }
      if (session.configOptions.length === 0 && session.modeState && current.modeState) {
        const modeId = session.modeState.currentModeId;
        if (modeId !== current.modeState.currentModeId) {
          try {
            current = await service.setConfigOption({
              workspacePath: session.workspacePath,
              ...(session.workspaceIdentity
                ? { workspaceIdentity: session.workspaceIdentity }
                : {}),
              ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
              id: replacement.id,
              configId: "mode",
              value: modeId,
            });
          } catch (error) {
            incomplete = true;
            logger.warn(undefined, "ACP replacement could not restore mode", {
              agent: session.agent,
              error: failureMessage(error),
            });
          }
        }
      }
      if (incomplete) {
        const live = await scoped({ ...session, id: replacement.id });
        await mutate(live, () => {
          live.error = "旧会话的部分配置未能恢复，请检查模型和权限设置。";
        });
      }
      // 修复原因：目录刷新会增加 revision，旧空会话也可能有用户选择的配置。
      // 新会话保存成功后才标记接替；原生 ID 和旧选项仍留在原文件中供核查。
      await mutate(session, () => {
        session.supersededBy = replacement.id;
      });
      return structuredClone(await scoped({ ...session, id: replacement.id }));
    })();
    recovering.set(session.id, task);
    try {
      return await task;
    } finally {
      recovering.delete(session.id);
    }
  };

  // 修复原因：列表和搜索共用同一 Host 历史读取，搜索只投影摘要，不复制整份正文或另建持久索引。
  const listScopedSessions = async (workspace: AcpWorkspace): Promise<AcpSession[]> => {
    const target = acpWorkspaceSchema.parse(workspace);
    const found = await listAllSessions();
    return found
      .filter(
        (value) =>
          workspaceKey(value) === workspaceKey(target) &&
          value.workspacePath === target.workspacePath,
      )
      .filter((value) => {
        if (value.supersededBy) return false;
        // 无内容旧会话仅在当前 Host 仍连接时可列出；有正文历史始终保留。
        const unusedIdle =
          value.revision === 0 &&
          value.status === "idle" &&
          value.entries.length === 0 &&
          value.goal === null;
        return !unusedIdle || connections.has(value.id);
      });
  };
  const listAllSessions = async (): Promise<AcpSession[]> => {
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const found = await Promise.all(
      names
        .filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name))
        .map(async (name) => {
          try {
            return await load(name.slice(0, -5));
          } catch (error) {
            logger.warn(undefined, "ACP session metadata unreadable", {
              error: failureMessage(error),
            });
            return null;
          }
        }),
    );
    return found
      .filter((value): value is AcpSession => Boolean(value))
      .filter((value) => !removed.has(value.id));
  };

  const service: IAcpService & { disposeAll(): void; disposeAllAndWait(): Promise<void> } = {
    async listPlugins(input): Promise<AcpPlugin[]> {
      const target = acpWorkspaceSchema.parse(input);
      const session = input.id ? await scoped({ ...target, id: input.id }) : null;
      const [snapshot, skillList] = await Promise.all([
        options.pluginSource?.getAcpPluginCapabilities(target),
        options.skillsService?.list?.(target),
      ]);
      if (!snapshot) return [];
      const port = session ? connections.get(session.id) : undefined;
      // 修复原因：菜单不能为查询能力而握手/认证；未连接只做 Host stdio 命令检查，
      // HTTP/SSE 必须等 Agent 声明支持后，使用该连接实际供应的名字。
      const mcpNames = port
        ? (port.provisionedMcpNames ?? new Set<string>())
        : new Set(
            (
              await projectAcpPluginMcpServers(
                snapshot.servers,
                {},
                target.workspacePath,
                process.env,
              )
            ).map((server) => server.name),
          );
      return availableAcpPlugins(snapshot, skillList?.skills ?? [], mcpNames);
    },
    listAgents: () => agentManager.listAgents(),
    listGeminiProviders: () => agentManager.listGeminiProviders(),
    updateGeminiProviders: (input) => agentManager.updateGeminiProviders(input),
    listAvailableAgents: async () =>
      acpAgentAvailabilityListSchema.parse(await agentManager.listAvailableAgents()),
    updateAgent: (input) => agentManager.updateAgent(input),
    readCodexConfig: () => agentManager.readCodexConfig(),
    updateCodexConfig: (input) => agentManager.updateCodexConfig(input),
    listCodexModels: () => agentManager.listCodexModels(),
    manageAgent: (input) => agentManager.manageAgent(input),
    onDynamicAgentOperation(operationId) {
      return (listener) =>
        agentManager.onAgentOperation((event) => {
          if (event.operationId === operationId) listener(event);
        });
    },
    async list(workspace) {
      return (await listScopedSessions(workspace)).map((value) => structuredClone(value));
    },
    async getUsageStats(request) {
      if (request.range !== "all" && request.range !== "7d" && request.range !== "30d")
        throw new Error("Invalid app usage range");
      return summarizeAcpUsage(await listAllSessions(), request);
    },
    async search(input) {
      const query = acpSessionSearchInputSchema.parse(input);
      return searchAcpSessions(await listScopedSessions(query), query);
    },
    async read(input) {
      return structuredClone(await scoped(input));
    },
    async getSessionFilePath(input) {
      const session = await scoped(input);
      if (removed.has(session.id) || disposed || !isAcpHistorySession(session))
        throw new Error("ACP session has no durable history");
      return file(session.id);
    },
    async getDiagnosticLogPath(input) {
      return ensureDiagnosticFile(await scoped(input));
    },
    async getExecutionTrace(input) {
      const path = await ensureDiagnosticFile(await scoped(input));
      const source = await readFile(path, "utf8");
      return source
        .split("\n")
        .filter(Boolean)
        .slice(-500)
        .flatMap((line) => {
          try {
            const event = acpDiagnosticEventSchema.safeParse(JSON.parse(line));
            return event.success ? [event.data] : [];
          } catch {
            return [];
          }
        });
    },
    async updateRow(input) {
      const { action, ...target } = acpSessionRowUpdateSchema.parse(input);
      const session = await scoped(target);
      if (removed.has(session.id) || disposed) throw new Error("ACP session closed");
      if (!isAcpHistorySession(session)) throw new Error("ACP session has no durable history");
      if (action.kind === "rename") {
        const title = action.title.trim();
        if (!title) throw new Error("ACP title is empty");
        if (session.title !== title)
          await mutate(session, () => {
            session.title = title;
          });
      } else if (action.kind === "pin") {
        if (session.archived && action.pinned)
          throw new Error("Archived ACP session cannot be pinned");
        if (session.pinned !== action.pinned)
          await mutate(session, () => {
            session.pinned = action.pinned;
          });
      } else if (action.kind === "archive") {
        if (session.archived !== action.archived)
          await mutate(session, () => {
            // 修复原因：归档是 Host 的持久行状态，不能沿用原生 task id；归档时
            // 清除置顶，避免同一 ACP 会话同时落在置顶区和归档区。
            session.archived = action.archived;
            if (action.archived) session.pinned = false;
          });
      } else if (action.unread) {
        if (!session.unreadAt)
          await mutate(session, () => {
            session.unreadAt = Date.now();
          });
      } else if (session.unreadAt !== null) {
        await mutate(session, () => {
          session.unreadAt = null;
        });
      }
      // 修复原因：ACP id 不能交给原生 task service；列表状态必须在目标 Host
      // 的快照写入后发布，远端重连才能通过同一 revision 恢复置顶和未读。
      return structuredClone(session);
    },
    async refresh(input) {
      const session = await scoped(input);
      if (removed.has(session.id) || disposed) throw new Error("ACP session closed");
      if (session.supersededBy)
        return structuredClone(await scoped({ ...input, id: session.supersededBy }));
      try {
        await attach(session);
      } catch (error) {
        // 仅旧原生会话无法恢复可接替；含聊天或目标的历史绝不自动换 ID。
        if (
          !(error instanceof AcpSessionLoadError) ||
          session.status !== "idle" ||
          session.entries.length > 0 ||
          session.goal !== null
        )
          throw error;
        return structuredClone(await recoverEmptySession(session));
      }
      return structuredClone(session);
    },
    async create(input) {
      if (disposed) throw new Error("ACP service closed");
      const { agent, requestId, deferPersistence, ...target } = acpCreateInputSchema.parse(input);
      const key = requestId
        ? JSON.stringify([workspaceKey(target), target.workspacePath, agent, requestId])
        : null;
      if (key) {
        const previousId = created.get(key);
        if (previousId) return structuredClone(await scoped({ ...target, id: previousId }));
        const pendingCreate = creating.get(key);
        if (pendingCreate) return structuredClone(await pendingCreate);
      }
      const task = async (): Promise<AcpSession> => {
        if (key) {
          // 修复原因：首次创建已落盘但 RPC ACK 丢失后，重试甚至 Host 重启都必须复用会话。
          const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
          });
          for (const name of names) {
            if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
            const session = await load(name.slice(0, -5)).catch(() => null);
            if (!session) continue;
            if (
              session.createRequestId === requestId &&
              session.agent === agent &&
              workspaceKey(session) === workspaceKey(target) &&
              session.workspacePath === target.workspacePath &&
              !removed.has(session.id)
            ) {
              created.set(key, session.id);
              return structuredClone(session);
            }
          }
        }
        const id = randomUUID();
        const session: AcpSession = {
          ...target,
          id,
          agent,
          ...(requestId ? { createRequestId: requestId } : {}),
          ...(deferPersistence ? { provisional: true } : {}),
          acpSessionId: "",
          status: "idle",
          revision: 0,
          title: acpAgentDefinition(agent).name,
          pinned: false,
          archived: false,
          unreadAt: null,
          goal: null,
          configOptions: [],
          modeState: null,
          entries: [],
          usageBaselineKnown: true,
          usageBaseline: null,
          usageTurns: [],
          pendingPermission: null,
          error: null,
        };
        try {
          const port = await attach(session);
          if (!session.provisional && session.acpSessionId) {
            // 修复原因：新连接中途失去的累计报告无法恢复，首份需重建基线。
            session.usageBaselineKnown = false;
          }
          session.acpSessionId = port.sessionId;
          sessions.set(id, session);
          await save(session);
          if (key) created.set(key, id);
          return structuredClone(session);
        } catch (error) {
          detach(id);
          throw error;
        }
      };
      if (!key) return task();
      const pending = task();
      creating.set(key, pending);
      try {
        return await pending;
      } finally {
        creating.delete(key);
      }
    },
    async prompt(input) {
      const session = await scoped(input);
      if (removed.has(session.id) || disposed) throw new Error("ACP session closed");
      const prompt = acpPromptInputSchema.parse(input);
      const commandId = prompt.commandId.trim();
      if (!prompt.text.trim() && !prompt.attachments.length && !prompt.workspaceFiles.length) {
        throw new Error("ACP prompt is empty");
      }
      if (session.entries.some((entry) => entry.id === `user:${commandId}`)) {
        return structuredClone(session);
      }
      if (
        active.has(session.id) ||
        stopping.has(session.id) ||
        configuring.has(session.id) ||
        session.status === "running"
      )
        throw new Error("ACP session is running");
      active.set(session.id, commandId);
      const goal = session.goal;
      let admitted = false;
      try {
        const port = await attach(session);
        const workflowInstruction = /^\/workflow(?:\s|$)/i.test(prompt.text.trimStart())
          ? `Use the ZCode zcode-workflows MCP ReadWorkflowInstructions tool, then call CreateWorkflow for this request: ${prompt.text.trimStart().replace(/^\/workflow\s*/i, "")}`
          : undefined;
        const references = referencedAcpPlugins(prompt.text);
        const [pluginSnapshot, pluginSkills] = references.length
          ? await Promise.all([
              options.pluginSource?.getAcpPluginCapabilities({
                workspacePath: session.workspacePath,
                ...(session.workspaceIdentity
                  ? { workspaceIdentity: session.workspaceIdentity }
                  : {}),
                ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
              }),
              options.skillsService?.list?.({
                workspacePath: session.workspacePath,
                ...(session.workspaceIdentity
                  ? { workspaceIdentity: session.workspaceIdentity }
                  : {}),
              }),
            ])
          : [undefined, undefined];
        if (references.length && !pluginSnapshot) throw new Error("目标 Host 不支持 ACP 插件引用");
        const available = pluginSnapshot
          ? availableAcpPlugins(
              pluginSnapshot,
              pluginSkills?.skills ?? [],
              port.provisionedMcpNames ?? new Set(),
            )
          : [];
        const skillContext = await options.skillsService?.buildPromptContext({
          workspacePath: session.workspacePath,
          ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
          prompt: prompt.text,
        });
        const blocks = await buildAcpPromptBlocks({
          text: buildAcpPluginPrompt(
            skillContext?.prompt ?? prompt.text,
            references,
            available,
            pluginSkills?.skills ?? [],
          ),
          workspacePath: session.workspacePath,
          workspaceFiles: prompt.workspaceFiles,
          attachments: prompt.attachments,
          capabilities: port.promptCapabilities,
        });
        if (workflowInstruction) blocks.unshift({ type: "text", text: workflowInstruction });
        const notifications = workflowNotifications.get(session.id);
        if (notifications?.length) {
          workflowNotifications.delete(session.id);
          blocks.unshift({ type: "text", text: `ZCode 工作流运行结果：${JSON.stringify(notifications)}` });
        }
        if (goal) {
          // 目标属于 Host 会话，不是 ZCode CLI 的 /goal 命令；仅向 Agent 传入本轮有效目标。
          blocks.unshift({ type: "text", text: `Session objective: ${goal}` });
        }
        if (active.get(session.id) !== commandId || removed.has(session.id)) {
          return structuredClone(session);
        }
        const provisionalBeforeAdmission = session.provisional ? structuredClone(session) : null;
        try {
          await mutate(session, () => {
            // 修复原因：预连接只存在于 Host 内存；首条有效消息与会话一起落盘。
            delete session.provisional;
            session.status = "running";
            session.error = null;
            session.title =
              session.entries.length === 0
                ? prompt.text.trim().slice(0, 72) || "Attachments"
                : session.title;
            session.entries.push({
              id: `user:${commandId}`,
              kind: "user",
              text: prompt.text,
              createdAt: Date.now(),
              ...(prompt.attachments.length || prompt.workspaceFiles.length
                ? {
                    attachmentNames: [
                      ...prompt.attachments.map((item) => item.fileName),
                      ...prompt.workspaceFiles,
                    ],
                  }
                : {}),
            });
          });
          admitted = true;
          await appendDiagnostic(session, { kind: "prompt-accepted" });
        } catch (error) {
          // 首次落盘失败时恢复内存草稿，保持原文可重试且历史不会出现半条消息。
          if (provisionalBeforeAdmission) Object.assign(session, provisionalBeforeAdmission);
          throw error;
        }
        if (active.get(session.id) !== commandId || removed.has(session.id)) {
          return structuredClone(session);
        }
        const usage = await port.prompt(prompt.text, blocks);
        if (
          active.get(session.id) === commandId &&
          connections.get(session.id) === port &&
          !disposed
        ) {
          await mutate(session, () => {
            recordAcpPromptUsage(session, commandId, usage);
            session.status = "idle";
            session.pendingPermission = null;
          });
          await appendDiagnostic(session, { kind: "turn-completed" });
          active.delete(session.id);
          // 修复原因：工作流可在主回合占用 ACP 连接时先完成；释放连接后必须主动派送结果。
          scheduleWorkflowNotifications(session);
        }
      } catch (error) {
        if (active.get(session.id) === commandId) {
          active.delete(session.id);
          // Capability/file validation precedes admission: rejected input never enters history.
          if (!admitted) throw error;
          await mutate(session, () => {
            session.status = "interrupted";
            session.usageBaselineKnown = false;
            session.pendingPermission = null;
            session.error = failureMessage(error);
          }).catch((persistenceError) => {
            logger.warn(undefined, "ACP turn interruption persistence failed", {
              error: failureMessage(persistenceError),
            });
          });
          await appendDiagnostic(session, { kind: "turn-interrupted" });
          scheduleWorkflowNotifications(session);
          throw error;
        }
        // 用户已停止本轮或旧进程已退出：结果由 Host 快照决定，不重复报告取消为发送失败。
      }
      return structuredClone(session);
    },
    async setGoal(input) {
      const session = await scoped(input);
      if (removed.has(session.id) || disposed) throw new Error("ACP session closed");
      const goal = input.goal?.trim() || null;
      if (goal && goal.length > 4000) throw new Error("ACP goal exceeds 4000 characters");
      if (goal !== session.goal)
        await mutate(session, () => {
          session.goal = goal;
        });
      return structuredClone(session);
    },
    async setConfigOption(input) {
      const session = await scoped(input);
      if (removed.has(session.id) || disposed) throw new Error("ACP session closed");
      if (active.has(session.id) || stopping.has(session.id) || configuring.has(session.id))
        throw new Error("ACP session is busy");
      configuring.add(session.id);
      try {
        const port = await attach(session);
        const option = session.configOptions.find((item) => item.id === input.configId);
        if (option) {
          if (option.type === "boolean") {
            if (typeof input.value !== "boolean")
              throw new Error("ACP config value is not available");
          } else if (
            typeof input.value !== "string" ||
            !acpConfigValues(option).includes(input.value)
          ) {
            throw new Error("ACP config value is not available");
          }
          if (option.currentValue === input.value) return structuredClone(session);
          const next = await port.setConfigOption(option.id, input.value);
          if (connections.get(session.id) !== port || removed.has(session.id))
            throw new Error("ACP session changed while configuring");
          await mutate(session, () => {
            session.configOptions = next;
          });
        } else if (
          input.configId === "mode" &&
          session.configOptions.length === 0 &&
          session.modeState
        ) {
          if (
            typeof input.value !== "string" ||
            !session.modeState.availableModes.some((mode) => mode.id === input.value)
          )
            throw new Error("ACP config value is not available");
          if (session.modeState.currentModeId === input.value) return structuredClone(session);
          await port.setMode(input.value);
          if (connections.get(session.id) !== port || removed.has(session.id))
            throw new Error("ACP session changed while configuring");
          await mutate(session, () => {
            session.modeState!.currentModeId = input.value as string;
          });
        } else throw new Error("ACP config option is not available");
        return structuredClone(session);
      } finally {
        configuring.delete(session.id);
      }
    },
    async stop(input) {
      const session = await scoped(input);
      workflowHost.stopSession(session.id);
      if (!active.has(session.id)) return;
      stopping.add(session.id);
      active.delete(session.id);
      settlePermission(session.id);
      try {
        await mutate(session, () => {
          session.status = "idle";
          session.usageBaselineKnown = false;
          session.pendingPermission = null;
        });
        await appendDiagnostic(session, { kind: "turn-stopped" });
        await connections.get(session.id)?.cancel();
      } finally {
        // 取消后终止旧连接，避免旧 prompt 未结束时新轮进入同一 Agent 进程。
        detach(session.id);
        stopping.delete(session.id);
      }
    },
    async cancelWorkflow(input) {
      const params = acpWorkflowControlSchema.parse(input);
      const session = await scoped(params);
      await workflowHost.get(session, params.runId);
      await settleWorkflowPermissions(session, params.runId);
      try { await workflowHost.cancel(session, params.runId); }
      finally { await settleWorkflowPermissions(session, params.runId); }
    },
    async resumeWorkflow(input) {
      const params = acpWorkflowControlSchema.parse(input);
      const session = await scoped(params);
      await workflowHost.resume(session, params.runId);
    },
    async getWorkflowArtifact(input) {
      const params = acpWorkflowArtifactQuerySchema.parse(input);
      const session = await scoped(params);
      return workflowHost.getArtifact(session, params.runId, params.artifactId);
    },
    async decide(input) {
      const session = await scoped(input);
      const decision = pending.get(session.id);
      if (!decision || decision.requestId !== input.requestId)
        throw new Error("ACP permission expired");
      if (!session.pendingPermission?.options.some((item) => item.optionId === input.optionId)) {
        throw new Error("Invalid ACP permission option");
      }
      await mutate(session, () => {
        session.pendingPermission = null;
      });
      // 写入快照期间 stop/remove 可能已取消此请求；迟到的允许不能到达 Agent。
      if (pending.get(session.id) !== decision || (!active.has(session.id) && !workflowHost.ownsLive(session.id))) {
        throw new Error("ACP permission expired");
      }
      // 修复原因：先完成 Host 轨迹再允许适配器恢复，否则 fast adapter 的完成事件可跑在授权记录前。
      await diagnosticWrites.get(session.id);
      await appendDiagnostic(session, { kind: "permission-resolved" });
      if (pending.get(session.id) !== decision || (!active.has(session.id) && !workflowHost.ownsLive(session.id))) {
        throw new Error("ACP permission expired");
      }
      pending.delete(session.id);
      const queue = permissionQueues.get(session.id);
      if (queue?.[0]?.request.requestId === input.requestId) {
        queue.shift();
        if (!queue.length) permissionQueues.delete(session.id);
        else queueMicrotask(() => { void showNextPermission(session); });
      }
      decision.resolve(input.optionId);
    },
    async remove(input) {
      const session = await scoped(input);
      workflowHost.stopSession(session.id);
      // 修复原因：用户切换智能体时的迟到清理不得删除已经接受首条消息的会话。
      if (input.provisionalOnly && (!session.provisional || active.has(session.id))) return;
      for (const [key, id] of created) if (id === session.id) created.delete(key);
      removed.add(session.id);
      active.delete(session.id);
      stopping.delete(session.id);
      detach(session.id);
      await writes.get(session.id);
      await diagnosticWrites.get(session.id);
      await rm(file(session.id), { force: true });
      await rm(diagnosticFile(session.id), { force: true });
      sessions.delete(session.id);
      emitter.fire({
        kind: "removed",
        id: session.id,
        workspaceKey: workspaceKey(session),
        workspacePath: session.workspacePath,
        ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
      });
    },
    onDynamicSessionChanged(workspace) {
      const target = acpWorkspaceSchema.parse(workspace);
      return (listener) =>
        emitter.event((change) => {
          if (change.kind === "updated") {
            if (
              workspaceKey(change.session) === workspaceKey(target) &&
              change.session.workspacePath === target.workspacePath
            )
              listener(change);
          } else if (
            change.workspaceKey === workspaceKey(target) &&
            change.workspacePath === target.workspacePath
          )
            listener(change);
        });
    },
    disposeAll() {
      disposed = true;
      workflowHost.dispose();
      for (const id of connections.keys()) detach(id);
      for (const id of connecting.keys()) detach(id);
      for (const id of pending.keys()) settlePermission(id);
      workflowMcp.dispose();
      emitter.dispose();
      if (!options.agentManager) agentManager.dispose();
    },
    async disposeAllAndWait() {
      const closed = [...connections.values()].flatMap((port) =>
        port.closed ? [port.closed] : [],
      );
      const inFlight = [...connecting.values()];
      this.disposeAll();
      await Promise.allSettled(inFlight);
      await Promise.allSettled(closed);
      await workflowHost.settleAll();
      await Promise.allSettled([...notificationTasks]);
      await Promise.allSettled([...writes.values()]);
    },
  };
  return service;
}
