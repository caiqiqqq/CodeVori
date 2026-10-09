/* oxlint-disable eslint(max-lines) -- ACP Host owner keeps admission, persistence, permission and process-generation checks in one state machine. */
import { randomUUID } from "node:crypto";
import {
  appendAcpConversationEntry,
  finishAcpThoughts,
  type AcpConversationUpdate,
} from "./acpConversationEntries.js";
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
  acpSetConfigOptionInputSchema,
  acpDiagnosticEventSchema,
  acpExecutionTraceChangedSchema,
  acpPromptInputSchema,
  acpPromptSubmissionSchema,
  acpQueueItemInputSchema,
  acpQueueEditInputSchema,
  acpQueueReorderInputSchema,
  acpQueueAutoDrainInputSchema,
  type AcpQueueItem,
  acpAttachmentReadInputSchema,
  acpAttachmentReadResultSchema,
  acpStopInputSchema,
  acpSessionSchema,
  acpTerminalControlSchema,
  type AcpTerminal,
  acpSessionRowUpdateSchema,
  acpSessionSearchInputSchema,
  acpWorkspaceSchema,
  isAcpHistorySession,
  type AcpAgent,
  type AcpConfigOption,
  type AcpModeState,
  type AcpEntry,
  type AcpDiagnosticEvent,
  type AcpExecutionTraceChanged,
  type AcpStopReason,
  type AcpSession,
  type AcpPromptInput,
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
import { AcpQueueGate } from "./acpQueueGate.js";
import { AcpAttachmentStore } from "./acpAttachmentStore.js";
import { projectAcpPluginMcpServers } from "./acpMcpServers.js";
import { createAcpWorkflowMcp } from "./acpWorkflowMcp.js";
import { AcpWorkflowHost } from "./acpWorkflowHost.js";
import { acpConfigValues } from "./acpConfigOptions.js";
import {
  AcpPermissionPreferences,
  isAcpPermissionOption,
  restoreAcpPermission,
  sessionPermissionSelection,
} from "./acpPermissionPreferences.js";
import { acpAgentConfigFingerprint, readAcpAgentConfigs } from "./acpAgentConfigs.js";
import { projectAcpContextUsage } from "./acpContextUsage.js";
import type { AcpToolDetails } from "./acpToolDetails.js";
import { searchAcpSessions } from "./acpSessionSearch.js";
import { createCodexUsageHistoryReader, type CodexUsageHistory } from "./acpNativeUsage.js";
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

import {
  applyAcpCompaction,
  interruptAcpCompactions,
  type AcpCompactionUpdate,
} from "./acpCompaction.js";
import { failureFromAcpError, recordAcpSessionFailure } from "./acpSessionFailures.js";
import type { AcpSessionFailure } from "@zcode/shared";

export type AcpUpdate =
  | { kind: "terminal"; terminal: AcpTerminal }
  | AcpCompactionUpdate
  | { kind: "failure"; failure: AcpSessionFailure }
  | AcpConversationUpdate
  | ({ kind: "tool"; id: string; title?: string; status?: string } & AcpToolDetails)
  | { kind: "config"; configOptions: AcpConfigOption[] }
  | { kind: "mode"; modeId: string }
  | { kind: "context_usage"; usage: AcpSession["contextUsage"] };
export interface AcpPermission {
  requestId: string;
  toolCallId?: string;
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
  /** Last completed ACP response; absent when a custom port does not report a stop reason. */
  readonly lastStopReason?: AcpStopReason;
  /** Latest adapter-native cumulative numeric report, scoped to this native session. */
  readonly nativeUsage?: AcpSession["nativeUsage"];
  /** undefined: no initial report; null: Agent explicitly reported unknown capacity. */
  contextUsage?: AcpSession["contextUsage"];
  setConfigOption(configId: string, value: string | boolean): Promise<AcpConfigOption[]>;
  setMode(modeId: string): Promise<void>;
  prompt(text: string, blocks?: ContentBlock[]): Promise<AcpUsageReport | null | void>;
  cancel(): Promise<void>;
  stopTerminal?(terminalId: string): Promise<void>;
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
    delegation?: {
      register(
        session: AcpSession,
      ): Promise<
        { record: NativeMcpServerRecord; revoke(): void; canDelegate?: boolean } | undefined
      >;
      onInput(session: AcpSession): Promise<void>;
      onStop(session: AcpSession): Promise<void>;
      onResultInput(session: AcpSession, commandId: string): Promise<void>;
    };
  } = {},
): IAcpService & { disposeAll(): void; disposeAllAndWait(): Promise<void> } {
  const directory = options.directory ?? join(getZCodeDataRootDir(), "acp-sessions");
  const permissionPreferences = new AcpPermissionPreferences(
    join(directory, "permission-preferences"),
  );
  const attachmentStore = new AcpAttachmentStore(join(directory, "attachments"));
  const attachmentWrites = new Map<string, Set<Promise<void>>>();
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
  const streamingWrites = new Map<string, Promise<void>>();
  const scheduledSnapshotRevisions = new Map<string, number>();
  const diagnosticWrites = new Map<string, Promise<void>>();
  const active = new Map<string, string>();
  const activeTokens = new Map<string, object>();
  const queueGate = new AcpQueueGate();
  const queueTasks = new Map<string, Promise<void>>();
  const promptTasks = new Map<string, Promise<AcpSession>>();
  // 修复原因：Renderer 不能依赖实时通知或整轮 RPC 判断接受；与同一执行任务共享持久接受凭证。
  const promptAdmissions = new Map<
    string,
    {
      sessionId: string;
      commandId: string;
      promise: Promise<AcpSession>;
      resolve(snapshot: AcpSession): void;
      reject(error: unknown): void;
    }
  >();
  const beginAdmission = (session: AcpSession, commandId: string) => {
    let resolve!: (snapshot: AcpSession) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<AcpSession>((accepted, failed) => {
      resolve = accepted;
      reject = failed;
    });
    // 内部 prompt 不消费接受 Promise，准备失败仍不能产生未处理 rejection。
    void promise.catch(() => {});
    const admission = { sessionId: session.id, commandId, promise, resolve, reject };
    promptAdmissions.set(`${session.id}:${commandId}`, admission);
    return admission;
  };
  const rejectAdmissions = (sessionId: string, error: Error) => {
    for (const admission of promptAdmissions.values())
      if (admission.sessionId === sessionId) admission.reject(error);
  };
  const internalResults = new Set<string>();
  const delegationRegistrations = new Map<string, { revoke(): void; canDelegate?: boolean }>();
  const stopping = new Set<string>();
  const configuring = new Set<string>();
  const pending = new Map<string, { requestId: string; resolve(value: string | null): void }>();
  const workflowMcp = createAcpWorkflowMcp(directory);
  const workflowRegistrations = new Map<string, { revoke(): void }>();
  const permissionQueues = new Map<
    string,
    Array<{
      request: AcpPermission;
      runId?: string;
      receivedAt: number;
      trace: Pick<AcpDiagnosticEvent, "turnIndex" | "entryIndex" | "requestId">;
      resolve(value: string | null): void;
    }>
  >();
  const workflowNotifications = new Map<string, Array<{ runId: string; result: unknown }>>();
  const workflowNotifying = new Set<string>();
  const notificationTasks = new Set<Promise<void>>();
  const emitter = new Emitter<AcpSessionChanged>();
  const traceEmitter = new Emitter<AcpExecutionTraceChanged>();
  let disposed = false;
  const usageHistoryReader = createCodexUsageHistoryReader();
  let usageHistoryRead: Promise<Map<string, CodexUsageHistory>> | null = null;

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
    receivedAt = Date.now(),
    snapshotWrite?: Promise<void>,
  ): Promise<void> => {
    if (session.provisional || removed.has(session.id)) return Promise.resolve();
    const id = session.id;
    // 时间必须在接收事实时获取；在 IO 队列中取时间会把写盘耗时误算为工具执行时间。
    const record = acpDiagnosticEventSchema.parse({
      ...event,
      eventId: randomUUID(),
      timestamp: receivedAt,
    });
    const previous = diagnosticWrites.get(id) ?? Promise.resolve();
    // 修复原因：ACP 更新可能并发到达；日志按 Host 接收顺序串行写入，且仅记录白名单元数据。
    const next = previous
      .then(async () => {
        await snapshotWrite;
        if (removed.has(id)) return;
        await mkdir(diagnosticDirectory, { recursive: true });
        const path = diagnosticFile(id);
        const bytes = await stat(path)
          .then((value) => value.size)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return 0;
            throw error;
          });
        if (bytes >= MAX_DIAGNOSTIC_BYTES) {
          // 原上限策略永久停止后续记录，长会话看不到新调用；轮转只保留最近有界元数据。
          const retained = (await readFile(path, "utf8"))
            .split("\n")
            .filter(Boolean)
            .slice(-250)
            .flatMap((line) => {
              try {
                const parsed = acpDiagnosticEventSchema.safeParse(JSON.parse(line));
                return parsed.success ? [JSON.stringify(parsed.data)] : [];
              } catch {
                return [];
              }
            });
          const marker = acpDiagnosticEventSchema.parse({
            kind: "trace-truncated",
            timestamp: record.timestamp,
            eventId: randomUUID(),
          });
          const temp = `${path}.tmp`;
          await writeFile(temp, `${JSON.stringify(marker)}\n${retained.join("\n")}\n`, {
            mode: 0o600,
          });
          await rename(temp, path);
          if (!disposed && !removed.has(id))
            traceEmitter.fire(
              acpExecutionTraceChangedSchema.parse({
                workspacePath: session.workspacePath,
                ...(session.workspaceIdentity
                  ? { workspaceIdentity: session.workspaceIdentity }
                  : {}),
                ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
                id,
                event: marker,
              }),
            );
        }
        await appendFile(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
        if (!disposed && !removed.has(id))
          traceEmitter.fire(
            acpExecutionTraceChangedSchema.parse({
              workspacePath: session.workspacePath,
              ...(session.workspaceIdentity
                ? { workspaceIdentity: session.workspaceIdentity }
                : {}),
              ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
              id,
              event: record,
            }),
          );
      })
      .catch((error) =>
        logger.warn(undefined, "ACP diagnostic write failed", { error: failureMessage(error) }),
      );
    diagnosticWrites.set(id, next);
    return next;
  };
  const turnIndexForCommand = (
    session: AcpSession,
    commandId: string | undefined,
  ): number | undefined => {
    if (!commandId) return undefined;
    const index = session.entries.findIndex((entry) => entry.id === `user:${commandId}`);
    return index < 0 ? undefined : index;
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
          if (!disposed && !removed.has(session.id))
            emitter.fire({ kind: "updated", session: snapshot });
        } finally {
          await rm(temporary, { force: true });
        }
      });
    writes.set(session.id, next);
    scheduledSnapshotRevisions.set(session.id, snapshot.revision);
    await next;
  };
  const saveStreaming = (session: AcpSession): Promise<void> => {
    const scheduled = streamingWrites.get(session.id);
    if (scheduled) return scheduled;
    // 修复原因：长会话逐分片克隆、校验和排队写盘会积压完整快照，阻塞 Host 与界面。
    // 仅合并等待现有 IO 的流式任务；执行时才取 owner 的最新事实，不用定时器延后输出。
    const next = (writes.get(session.id) ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        streamingWrites.delete(session.id);
        // 工具/权限/终态可能已保存更高 revision；复用其持久化屏障，不能重复广播或回填旧轮。
        if ((scheduledSnapshotRevisions.get(session.id) ?? -1) >= session.revision)
          return writes.get(session.id);
        return save(session);
      });
    streamingWrites.set(session.id, next);
    return next;
  };
  const mutate = async (
    session: AcpSession,
    change: () => void,
    streaming = false,
  ): Promise<void> => {
    change();
    if (!session.error) delete session.errorCommandId;
    if (session.status !== "running") {
      finishAcpThoughts(
        session,
        session.status === "interrupted" ? "interrupted" : "complete",
        Date.now(),
      );
      interruptAcpCompactions(session);
    }
    session.revision += 1;
    await (streaming ? saveStreaming(session) : save(session));
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
      const hadRunningTerminals = session.terminals.some((t) => t.status === "running");
      // Host 重启不能重新认领磁盘快照中的 PID；运行态必须降为未知终止。
      for (const terminal of session.terminals)
        if (terminal.status === "running") terminal.status = "interrupted";
      if (wasRunning) {
        // 进程已重启，旧执行结果未知；不能把磁盘上的 running 当作仍可取消的活轮。
        session.status = "interrupted";
        finishAcpThoughts(session, "interrupted", Date.now());
        interruptAcpCompactions(session);
        session.usageBaselineKnown = false;
        session.pendingPermission = null;
        session.error = "ACP Agent 已断开，请重试发送新的消息。";
      }
      const recoveredQueue = session.queue.items.length > 0;
      if (recoveredQueue) {
        session.queue.items = session.queue.items.filter(
          (item) => !session.entries.some((entry) => entry.id === `user:${item.commandId}`),
        );
        for (const item of session.queue.items) item.state = "queued";
        session.queue.autoDrain = false;
        session.queue.pauseReason = "error";
      }
      if (migratedLegacyTime || wasRunning || recoveredQueue || hadRunningTerminals) {
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
  const settlePermission = (id: string, receivedAt = Date.now()): void => {
    const request = permissionQueues.get(id)?.[0];
    const session = sessions.get(id);
    if (session && request && pending.get(id)?.requestId === request.request.requestId) {
      // 取消也属于授权事实；关联沿用请求接收时的轮次，不能用已释放的 active 猜测。
      void appendDiagnostic(
        session,
        {
          kind: "permission-resolved",
          ...request.trace,
          permissionDecision: "cancelled",
        },
        receivedAt,
      );
    }
    pending.get(id)?.resolve(null);
    pending.delete(id);
    for (const request of permissionQueues.get(id) ?? []) request.resolve(null);
    permissionQueues.delete(id);
  };
  const requestPermission = (
    session: AcpSession,
    request: AcpPermission,
    runId?: string,
  ): Promise<string | null> =>
    new Promise((resolve) => {
      const queue = permissionQueues.get(session.id) ?? [];
      const commandId = active.get(session.id);
      const toolIndex = runId
        ? -1
        : session.entries.findIndex(
            (entry) => entry.id === `tool:${commandId}:${request.toolCallId}`,
          );
      queue.push({
        request,
        runId,
        resolve,
        receivedAt: Date.now(),
        trace: {
          turnIndex: runId ? undefined : turnIndexForCommand(session, commandId),
          ...(toolIndex >= 0 ? { entryIndex: toolIndex } : {}),
          ...(/^[0-9a-f-]{36}$/i.test(request.requestId) ? { requestId: request.requestId } : {}),
        },
      });
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
      await appendDiagnostic(session, {
        kind: "permission-resolved",
        ...activeRequest.trace,
        permissionDecision: "cancelled",
      });
      // 修复原因：取消一个后台 run 时只撤销它的权限，不能清掉主 ACP 回合或其它 run 的请求。
      await mutate(session, () => {
        session.pendingPermission = null;
      });
      if (remaining.length) void showNextPermission(session);
    }
    for (const item of queue) if (item.runId === runId) item.resolve(null);
  };
  const showNextPermission = async (session: AcpSession): Promise<void> => {
    const next = permissionQueues.get(session.id)?.[0];
    if (!next || pending.has(session.id) || removed.has(session.id)) return;
    pending.set(session.id, { requestId: next.request.requestId, resolve: next.resolve });
    try {
      const snapshotWrite = mutate(session, () => {
        session.pendingPermission = next.request;
      });
      // 先按接收顺序占住诊断队列，队列内部等快照落盘，避免 stop 比请求记录更早写入。
      const diagnosticWrite = appendDiagnostic(
        session,
        {
          kind: "permission-requested",
          ...next.trace,
        },
        next.receivedAt,
        snapshotWrite,
      );
      await snapshotWrite;
      await diagnosticWrite;
    } catch (error) {
      logger.warn(undefined, "ACP permission persistence failed", { error: failureMessage(error) });
      settlePermission(session.id);
    }
  };
  const deliverWorkflowNotifications = async (session: AcpSession): Promise<void> => {
    if (
      disposed ||
      removed.has(session.id) ||
      active.has(session.id) ||
      stopping.has(session.id) ||
      configuring.has(session.id) ||
      (session.status === "interrupted" && Boolean(session.error)) ||
      session.queue.items.length > 0 ||
      workflowNotifying.has(session.id)
    )
      return;
    const notifications = workflowNotifications.get(session.id);
    const port = connections.get(session.id);
    if (!port || !notifications?.length) return;
    workflowNotifying.add(session.id);
    workflowNotifications.delete(session.id);
    const commandId = `workflow-result:${randomUUID()}`;
    active.set(session.id, commandId);
    let delivered = false;
    try {
      await mutate(session, () => {
        session.status = "running";
        session.error = null;
      });
      const text = `ZCode 工作流运行结果：${JSON.stringify(notifications)}。请根据结果继续回答用户原来的问题。`;
      const usage = await port.prompt(text, [{ type: "text", text }]);
      // 无用户行的工作流结果通知仍可失败；保留通知待下次明确输入，不自动重发。
      if (session.error) throw new Error(session.error);
      const completedAt = Date.now();
      if (
        active.get(session.id) === commandId &&
        connections.get(session.id) === port &&
        !removed.has(session.id) &&
        !disposed
      ) {
        await mutate(session, () => {
          recordAcpPromptUsage(session, commandId, usage);
          recordNativeUsage(session, port);
          finishAcpThoughts(
            session,
            port.lastStopReason && port.lastStopReason !== "end_turn" ? "interrupted" : "complete",
            completedAt,
          );
          session.status = "idle";
        });
        delivered = true;
      }
    } catch (error) {
      logger.warn(undefined, "ACP workflow result delivery failed", {
        // 适配器错误详情只保留在 Host 快照，不写入生产日志。
        code: "ACP_WORKFLOW_RESULT_FAILED",
      });
      workflowNotifications.set(session.id, [
        ...notifications,
        ...(workflowNotifications.get(session.id) ?? []),
      ]);
      if (active.get(session.id) === commandId)
        await mutate(session, () => {
          session.status = "interrupted";
          session.error = failureMessage(error);
          session.errorCommandId = commandId;
        });
    } finally {
      if (active.get(session.id) === commandId) active.delete(session.id);
      workflowNotifying.delete(session.id);
      scheduleQueueDrain(session);
      // 修复原因：上一轮发送通知时另一个 run 可能结算；成功后继续清空队列。
      // 本次发送失败时保留通知，等待下一个用户回合，不在失败连接上忙循环。
      if (delivered && workflowNotifications.get(session.id)?.length)
        scheduleWorkflowNotifications(session);
    }
  };
  const scheduleWorkflowNotifications = (session: AcpSession): void => {
    const task = deliverWorkflowNotifications(session);
    notificationTasks.add(task);
    void task
      .catch((error: unknown) => {
        logger.warn(undefined, "ACP workflow notification persistence failed", {
          error: failureMessage(error),
        });
      })
      .finally(() => {
        notificationTasks.delete(task);
      });
  };
  const workflowHost = new AcpWorkflowHost({
    directory,
    connect,
    mcp: workflowMcp,
    mutate,
    sources: async (session) => {
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
      return {
        mcpServers: mcpSettings?.servers ?? [],
        ...(launch ? { launch } : {}),
        ...(plugins ? { pluginServers: plugins.servers } : {}),
      };
    },
    permission: async (session, request, runId) => {
      if (
        disposed ||
        removed.has(session.id) ||
        (!active.has(session.id) && !workflowHost.ownsLive(session.id))
      )
        return null;
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
    const session = sessions.get(id);
    if (session?.terminals.some((t) => t.status === "running")) {
      // 主动断开也要发布失去进程所有权的事实；不能让旧连接的 running 悬挂在面板。
      void mutate(session, () => {
        for (const terminal of session.terminals)
          if (terminal.status === "running") terminal.status = "interrupted";
      });
    }
    generations.delete(id);
    settlePermission(id);
    workflowRegistrations.get(id)?.revoke();
    workflowRegistrations.delete(id);
    delegationRegistrations.get(id)?.revoke();
    delegationRegistrations.delete(id);
    connections.get(id)?.close();
    connections.delete(id);
    connecting.delete(id);
  };
  const attach = async (session: AcpSession): Promise<AcpConnectionPort> => {
    const current = connections.get(session.id);
    if (current) return current;
    const inFlight = connecting.get(session.id);
    if (inFlight) return inFlight;
    // 修复原因：session/load 可能重置权限；先冻结本会话选择，不能被握手通知或新会话偏好覆盖。
    const permissionSelection =
      session.permissionSelection ??
      (session.acpSessionId ? sessionPermissionSelection(session) : undefined);
    const generation = {};
    generations.set(session.id, generation);
    let receivedConfig = false;
    let receivedContextUsage = false;
    let updatedModeId: string | undefined;
    // 修复原因：若仅在设置页检查启用/安装状态，create 与 session/load 仍会从旧静态命令
    // 启动禁用的 Agent。每次新连接都向同一个 Host 设置所有者重新解析，复用连接不重启。
    const connectionTask = (async () => {
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
      const delegationRegistration = await options.delegation?.register(session);
      if (delegationRegistration) delegationRegistrations.set(session.id, delegationRegistration);
      return connect({
        agent: session.agent,
        workspacePath: session.workspacePath,
        sessionId: session.acpSessionId || undefined,
        ...(mcpSettings ? { mcpServers: mcpSettings.servers } : {}),
        workflowServers: [
          workflowRegistration.record,
          ...(delegationRegistration ? [delegationRegistration.record] : []),
        ],
        ...(plugins ? { pluginServers: plugins.servers } : {}),
        ...(launch ? { launch } : {}),
        onUpdate: async (update) => {
          const receivedAt = Date.now();
          if (generations.get(session.id) !== generation || removed.has(session.id)) return;
          if (update.kind === "terminal") {
            // 真实进程可跨 prompt 存活，不能套用正文的 active/running 门禁。
            await mutate(
              session,
              () => {
                const index = session.terminals.findIndex(
                  (t) => t.terminalId === update.terminal.terminalId,
                );
                if (index >= 0) session.terminals[index] = update.terminal;
                else {
                  if (session.terminals.length >= 128) {
                    const finished = session.terminals.findIndex((t) => t.status !== "running");
                    if (finished >= 0) session.terminals.splice(finished, 1);
                  }
                  session.terminals.push(update.terminal);
                }
              },
              update.terminal.status === "running",
            );
            return;
          }
          if (update.kind === "context_usage") {
            receivedContextUsage = true;
            // 修复原因：ACP usage_update 是当前上下文占用，不能依赖 active prompt
            // 的门禁或计入累计 Token 消耗；只更新所属会话的 Host 快照。
            const usage = projectAcpContextUsage(update.usage);
            if (
              session.contextUsage?.used === usage?.used &&
              session.contextUsage?.size === usage?.size
            )
              return;
            if (!session.acpSessionId) {
              session.contextUsage = usage;
              return;
            }
            await mutate(session, () => {
              session.contextUsage = usage;
            });
            return;
          }
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
          // 完成快照已接纳但日志仍在写入时 active 尚未释放；迟到正文不能重写本轮终态。
          if (!commandId || session.status !== "running") return;
          if (update.kind === "failure") {
            await mutate(session, () => {
              if (session.entries.some((entry) => entry.id === `user:${commandId}`))
                recordAcpSessionFailure(session, commandId, update.failure);
              else if (update.failure.severity === "error") {
                session.error = update.failure.title;
                session.errorCommandId = commandId;
              }
            });
            return;
          }
          let toolIndex: number | undefined;
          let statusChanged = false;
          let toolStatus: string | undefined;
          const snapshotWrite = mutate(
            session,
            () => {
              if (update.kind === "text" || update.kind === "thought" || update.kind === "plan") {
                appendAcpConversationEntry(session, commandId, update, receivedAt);
              } else if (update.kind === "compaction" || update.kind === "compaction_summary") {
                applyAcpCompaction(session, commandId, update, receivedAt);
              } else {
                const id = `tool:${commandId}:${update.id}`;
                const index = session.entries.findIndex((entry) => entry.id === id);
                if (index < 0) finishAcpThoughts(session, "complete", receivedAt);
                const previous = session.entries[index];
                statusChanged =
                  previous?.kind !== "tool" ||
                  (update.status !== undefined && update.status !== previous.status);
                toolIndex = index < 0 ? session.entries.length : index;
                const tool: AcpEntry = {
                  ...(previous?.kind === "tool" ? previous : {}),
                  id,
                  kind: "tool",
                  title: update.title ?? (previous?.kind === "tool" ? previous.title : update.id),
                  createdAt: previous?.createdAt ?? receivedAt,
                  status:
                    // 首次只收到局部字段时没有真实起始状态，不能伪造执行中及开始时间。
                    update.status ?? (previous?.kind === "tool" ? previous.status : "unknown"),
                };
                toolStatus = tool.status;
                // ACP 局部通知只替换明确给出的字段；空串是真实空结果，不可复活旧输出。
                for (const key of [
                  "content",
                  "toolKind",
                  "toolName",
                  "terminalIds",
                  "input",
                  "output",
                  "inputTruncated",
                  "outputTruncated",
                  "contentTruncated",
                ] as const) {
                  if (update[key] !== undefined) Object.assign(tool, { [key]: update[key] });
                }
                if (index >= 0) session.entries[index] = tool;
                else session.entries.push(tool);
              }
            },
            update.kind === "text" ||
              update.kind === "thought" ||
              update.kind === "compaction_summary",
          );
          const diagnosticWrite =
            update.kind === "tool" && statusChanged
              ? appendDiagnostic(
                  session,
                  {
                    kind: "tool-update",
                    status: diagnosticToolStatus(toolStatus),
                    turnIndex: turnIndexForCommand(session, commandId),
                    entryIndex: toolIndex,
                  },
                  receivedAt,
                  snapshotWrite,
                )
              : undefined;
          await snapshotWrite;
          await diagnosticWrite;
        },
        onPermission: async (request) => {
          if (!active.has(session.id) || generations.get(session.id) !== generation) return null;
          return requestPermission(session, request);
        },
        onExit: (reason) => {
          const receivedAt = Date.now();
          if (generations.get(session.id) !== generation) return;
          generations.delete(session.id);
          // root 退出不代表所有子进程已退出；旧连接取消认领并同步清除运行态。
          for (const terminal of session.terminals)
            if (terminal.status === "running") terminal.status = "interrupted";
          workflowHost.stopSession(session.id);
          workflowRegistrations.get(session.id)?.revoke();
          workflowRegistrations.delete(session.id);
          // Adapter root 已退出仍需回收其进程组内可能存活的 App Server 后代。
          connections.get(session.id)?.close();
          connections.delete(session.id);
          settlePermission(session.id, receivedAt);
          session.usageBaselineKnown = false;
          if (!active.has(session.id) && !session.queue.items.length) {
            void mutate(session, () => {});
            return;
          }
          const commandId = active.get(session.id);
          active.delete(session.id);
          activeTokens.delete(session.id);
          rejectAdmissions(session.id, new Error(reason));
          queueTasks.delete(session.id);
          scheduleWorkflowNotifications(session);
          void mutate(session, () => {
            session.pendingPermission = null;
            session.status = "interrupted";
            session.usageBaselineKnown = false;
            session.error = reason;
            if (commandId) session.errorCommandId = commandId;
            session.queue.autoDrain = false;
            session.queue.pauseReason = "error";
            for (const item of session.queue.items) item.state = "queued";
            const turnIndex = turnIndexForCommand(session, commandId);
            const entry = turnIndex === undefined ? undefined : session.entries[turnIndex];
            if (entry?.kind === "user") entry.traceError = reason;
            if (commandId)
              recordAcpSessionFailure(session, commandId, failureFromAcpError(reason, commandId));
          })
            .then(() =>
              appendDiagnostic(
                session,
                { kind: "adapter-exited", turnIndex: turnIndexForCommand(session, commandId) },
                receivedAt,
              ),
            )
            .catch((error) =>
              logger.warn(undefined, "ACP process exit update failed", {
                error: failureMessage(error),
              }),
            );
        },
      });
    })();
    const task = (async () => {
      const port = await connectionTask;
      try {
        if (disposed || removed.has(session.id) || generations.get(session.id) !== generation) {
          throw new Error("ACP session closed while connecting");
        }
        // 修复原因：权限恢复完成前连接不能被 prompt/config 复用，所有 attach 等待同一 ready Promise。
        const initialModes = port.modeState
          ? { ...port.modeState, currentModeId: updatedModeId ?? port.modeState.currentModeId }
          : null;
        const restored = await restoreAcpPermission(
          {
            configOptions: receivedConfig ? session.configOptions : (port.configOptions ?? []),
            modeState: initialModes,
          },
          permissionSelection,
          port,
        );
        if (disposed || generations.get(session.id) !== generation || removed.has(session.id))
          throw new Error("ACP session changed while restoring permission");
        // 修复原因：握手后立刻推送的配置比 session/new、session/load 响应更新。
        // 先记录通知，再补齐响应中的目录，不用旧响应反向覆盖 Agent 的新状态。
        if (session.acpSessionId) {
          await mutate(session, () => {
            // 修复原因：新进程重新连接已有 ACP 会话后，适配器可能重置累计计数；
            // 首份报告必须先重建基线，不能与上一个进程的快照直接求差。
            session.usageBaselineKnown = false;
            recordNativeUsage(session, port);
            session.configOptions = restored.configOptions;
            if (permissionSelection) session.permissionSelection = permissionSelection;
            // 修复原因：握手期间的容量此前随历史消息被丢弃；只在连接成功后合入快照。
            // 实时通知可能早于握手结果被 Host 接收，不能用初始值反向覆盖较新的通知。
            if (!receivedContextUsage && port.contextUsage !== undefined)
              session.contextUsage = projectAcpContextUsage(port.contextUsage);
            session.modeState = restored.modeState;
          });
        } else {
          recordNativeUsage(session, port);
          session.configOptions = restored.configOptions;
          if (permissionSelection) session.permissionSelection = permissionSelection;
          if (!receivedContextUsage && port.contextUsage !== undefined)
            session.contextUsage = projectAcpContextUsage(port.contextUsage);
          session.modeState = restored.modeState;
        }
        if (disposed || generations.get(session.id) !== generation || removed.has(session.id)) {
          throw new Error("ACP session closed while connecting");
        }
        connections.set(session.id, port);
        return port;
      } catch (error) {
        if (generations.get(session.id) === generation) detach(session.id);
        port.close();
        throw error;
      }
    })();
    connecting.set(session.id, task);
    try {
      return await task;
    } finally {
      if (connecting.get(session.id) === task) connecting.delete(session.id);
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
      // 新会话恢复只使用被接替会话的权限，不读取后来修改的默认偏好。
      const permissionSelection =
        session.permissionSelection ?? sessionPermissionSelection(session);
      if (permissionSelection) {
        current = await service.setConfigOption({
          workspacePath: session.workspacePath,
          ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
          ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
          id: replacement.id,
          ...permissionSelection,
        });
      }
      let incomplete = false;
      for (const previous of session.configOptions) {
        if (previous.id === permissionSelection?.configId) continue;
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

  const ensureOpen = (session: AcpSession): void => {
    if (disposed || removed.has(session.id)) throw new Error("ACP session closed");
  };
  const editableQueueItem = (session: AcpSession, id: string): AcpQueueItem => {
    const item = session.queue.items.find((candidate) => candidate.commandId === id);
    if (!item) throw new Error("ACP queue item missing");
    if (item.state !== "queued") throw new Error("ACP queue item is not editable");
    return item;
  };
  const changeQueue = async (session: AcpSession, change: () => void): Promise<void> => {
    const before = structuredClone(session.queue);
    try {
      await mutate(session, change);
    } catch (error) {
      // 修复原因：队列 IO 失败只能回滚队列，不能用旧快照覆盖并发流式正文。
      session.queue = before;
      throw error;
    }
  };
  const enqueuePrompt = async (
    session: AcpSession,
    prompt: ReturnType<typeof acpPromptInputSchema.parse>,
  ): Promise<void> => {
    if (session.queue.items.length >= 100) throw new Error("ACP queue is full (100 messages)");
    const port = await attach(session);
    const blocks = await buildAcpPromptBlocks({
      ...prompt,
      workspacePath: session.workspacePath,
      capabilities: port.promptCapabilities,
    });
    const saved = await attachmentStore.save(
      session.id,
      prompt.attachments,
      blocks.slice(1 + prompt.workspaceFiles.length),
    );
    const wasProvisional = session.provisional;
    const previousTitle = session.title;
    try {
      ensureOpen(session);
      if (connections.get(session.id) !== port)
        throw new Error("ACP session changed while queuing");
      await changeQueue(session, () => {
        delete session.provisional;
        if (!session.entries.length && !session.queue.items.length)
          session.title = prompt.text.trim().slice(0, 72) || "Attachments";
        session.queue.items.push({
          commandId: prompt.commandId,
          text: prompt.text,
          attachments: saved.attachments,
          workspaceFiles: prompt.workspaceFiles,
          createdAt: Date.now(),
          state: "queued",
        });
      });
    } catch (error) {
      session.provisional = wasProvisional;
      session.title = previousTitle;
      await attachmentStore.discard(session.id, saved.group);
      throw error;
    }
  };
  const reserveQueuedPrompt = async (session: AcpSession, item: AcpQueueItem): Promise<void> => {
    if (active.has(session.id) || stopping.has(session.id) || configuring.has(session.id))
      throw new Error("ACP session is running");
    active.set(session.id, item.commandId);
    activeTokens.set(session.id, {});
    try {
      await changeQueue(session, () => {
        item.state = "reserved";
      });
    } catch (error) {
      active.delete(session.id);
      session.queue.autoDrain = false;
      session.queue.pauseReason = "error";
      session.error = failureMessage(error);
      await save(session).catch(() => {});
      throw error;
    }
  };
  const launchQueuedPrompt = (session: AcpSession, item: AcpQueueItem): void => {
    const token = activeTokens.get(session.id);
    const ownsRun = () =>
      active.get(session.id) === item.commandId && activeTokens.get(session.id) === token;
    const task = (async () => {
      try {
        const attachments = await attachmentStore.promptInputs(session.id, item.attachments);
        if (!ownsRun() || disposed || removed.has(session.id)) return;
        await executePrompt(
          session,
          {
            commandId: item.commandId,
            text: item.text,
            attachments,
            workspaceFiles: item.workspaceFiles,
          },
          item,
        );
      } catch (error) {
        await queueGate.run(session.id, async () => {
          if (
            disposed ||
            removed.has(session.id) ||
            activeTokens.get(session.id) !== token ||
            stopping.has(session.id) ||
            (active.has(session.id) && !ownsRun())
          )
            return;
          if (ownsRun()) active.delete(session.id);
          await changeQueue(session, () => {
            const current = session.queue.items.find(
              (candidate) => candidate.commandId === item.commandId,
            );
            if (current) current.state = "queued";
            session.queue.autoDrain = false;
            session.queue.pauseReason = "error";
            session.error = failureMessage(error);
          });
        });
      }
    })();
    queueTasks.set(session.id, task);
    notificationTasks.add(task);
    void task
      .catch((error) =>
        logger.warn(undefined, "ACP queue dispatch failed", { error: failureMessage(error) }),
      )
      .finally(() => {
        notificationTasks.delete(task);
        if (queueTasks.get(session.id) === task) {
          queueTasks.delete(session.id);
          scheduleQueueDrain(session);
        }
      });
  };
  const scheduleQueueDrain = (session: AcpSession): void => {
    if (
      disposed ||
      removed.has(session.id) ||
      queueTasks.has(session.id) ||
      active.has(session.id) ||
      stopping.has(session.id) ||
      configuring.has(session.id) ||
      !session.queue.autoDrain ||
      session.queue.items[0]?.state !== "queued"
    )
      return;
    const task = queueGate.run(session.id, async () => {
      const item = session.queue.items[0];
      if (
        disposed ||
        removed.has(session.id) ||
        active.has(session.id) ||
        stopping.has(session.id) ||
        configuring.has(session.id) ||
        !session.queue.autoDrain ||
        item?.state !== "queued"
      )
        return;
      // 修复依据：预留与 active 栅栏同属 Host；不能从 Renderer 或 timer 另起一轮。
      await reserveQueuedPrompt(session, item);
      launchQueuedPrompt(session, item);
    });
    queueTasks.set(session.id, task);
    notificationTasks.add(task);
    void task
      .catch((error) =>
        logger.warn(undefined, "ACP queue reservation failed", { error: failureMessage(error) }),
      )
      .finally(() => {
        notificationTasks.delete(task);
        if (queueTasks.get(session.id) === task) queueTasks.delete(session.id);
      });
  };

  const executePrompt = async (
    session: AcpSession,
    prompt: ReturnType<typeof acpPromptInputSchema.parse>,
    queued?: AcpQueueItem,
  ): Promise<AcpSession> => {
    const commandId = prompt.commandId.trim();
    const token = activeTokens.get(session.id);
    const ownsRun = () =>
      active.get(session.id) === commandId && activeTokens.get(session.id) === token;
    const goal = session.goal;
    let admitted = false;
    let attachmentGroup: string | null = null;
    let attachmentWrite: Promise<void> | undefined;
    let finishAttachmentWrite: (() => void) | undefined;
    const finishAttachmentIO = () => {
      if (!attachmentWrite) return;
      const inFlight = attachmentWrites.get(session.id);
      inFlight?.delete(attachmentWrite);
      if (!inFlight?.size) attachmentWrites.delete(session.id);
      finishAttachmentWrite?.();
      attachmentWrite = undefined;
    };
    try {
      if (!internalResults.has(commandId)) await options.delegation?.onInput(session);
      const port = await attach(session);
      const delegationInstruction =
        port.provisionedMcpNames?.has("zcode-delegation") &&
        delegationRegistrations.get(session.id)?.canDelegate !== false
          ? "用户提到委派或 @智能体时，使用 zcode-delegation 的 ListDelegationAgents / DelegateTask；保持当前主智能体，显式传递必要上下文，不复制全部历史。子任务完成只汇总，不自动继续修改、合并或推送。"
          : undefined;
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
      if (!ownsRun() || removed.has(session.id) || disposed || connections.get(session.id) !== port)
        return structuredClone(session);
      // 图片必须保存发送时的内容；快照只记录引用，不能把临时路径或 base64 当成历史。
      if (prompt.attachments.length) {
        attachmentWrite = new Promise<void>((resolve) => {
          finishAttachmentWrite = resolve;
        });
        const inFlight = attachmentWrites.get(session.id) ?? new Set<Promise<void>>();
        inFlight.add(attachmentWrite);
        attachmentWrites.set(session.id, inFlight);
      }
      const savedAttachments = queued
        ? { attachments: queued.attachments, group: null }
        : await attachmentStore.save(
            session.id,
            prompt.attachments,
            blocks.slice(1 + prompt.workspaceFiles.length),
          );
      attachmentGroup = savedAttachments.group;
      if (!ownsRun() || removed.has(session.id) || disposed || connections.get(session.id) !== port)
        return structuredClone(session);
      if (workflowInstruction) blocks.unshift({ type: "text", text: workflowInstruction });
      if (delegationInstruction) blocks.unshift({ type: "text", text: delegationInstruction });
      const notifications = workflowNotifications.get(session.id);
      if (notifications?.length) {
        workflowNotifications.delete(session.id);
        blocks.unshift({
          type: "text",
          text: `ZCode 工作流运行结果：${JSON.stringify(notifications)}`,
        });
      }
      if (goal) {
        // 目标属于 Host 会话，不是 ZCode CLI 的 /goal 命令；仅向 Agent 传入本轮有效目标。
        blocks.unshift({ type: "text", text: `Session objective: ${goal}` });
      }
      if (internalResults.has(commandId))
        await options.delegation?.onResultInput(session, commandId);
      if (!ownsRun() || removed.has(session.id)) {
        return structuredClone(session);
      }
      const admittedAt = Date.now();
      await queueGate.run(session.id, async () => {
        if (!ownsRun() || disposed || removed.has(session.id)) return;
        const beforeAdmission = structuredClone(session);
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
            if (queued)
              session.queue.items = session.queue.items.filter(
                (item) => item.commandId !== commandId,
              );
            session.entries.push({
              id: `user:${commandId}`,
              kind: "user",
              text: prompt.text,
              createdAt: admittedAt,
              ...(session.configOptions.length
                ? {
                    traceSelections: session.configOptions.map((option) => ({
                      name: option.name,
                      value: option.currentValue,
                    })),
                  }
                : session.modeState
                  ? {
                      traceSelections: [{ name: "Mode", value: session.modeState.currentModeId }],
                    }
                  : {}),
              ...(savedAttachments.attachments.length
                ? { attachments: savedAttachments.attachments }
                : {}),
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
          // 接受凭证来自成功落盘的同一快照；后续诊断、模型重连和整轮执行都不阻塞输入框。
          promptAdmissions
            .get(`${session.id}:${commandId}`)
            ?.resolve(acpSessionSchema.parse(structuredClone(session)));
          finishAttachmentIO();
          await appendDiagnostic(
            session,
            { kind: "prompt-accepted", turnIndex: turnIndexForCommand(session, commandId) },
            admittedAt,
          );
        } catch (error) {
          // 修复原因：user row 落盘后已返回接受凭证；诊断写入失败属于该轮，不能回滚已接受正文。
          if (!admitted) Object.assign(session, beforeAdmission);
          throw error;
        }
      });
      if (!admitted || !ownsRun() || removed.has(session.id)) {
        return structuredClone(session);
      }
      const usage = await port.prompt(prompt.text, blocks);
      const completedAt = Date.now();
      await queueGate.run(session.id, async () => {
        if (ownsRun() && connections.get(session.id) === port && !disposed) {
          await mutate(session, () => {
            recordAcpPromptUsage(session, commandId, usage);
            recordNativeUsage(session, port);
            // 修复原因：Codex 的结构化失败也返回 end_turn；不能以 RPC 成功判断本轮成功。
            session.status = session.error ? "interrupted" : "idle";
            finishAcpThoughts(
              session,
              session.error || (port.lastStopReason && port.lastStopReason !== "end_turn")
                ? "interrupted"
                : "complete",
              completedAt,
            );
            session.pendingPermission = null;
            // 修复依据：只有正常 end_turn 可自动继续，Agent 自行取消/拒绝/限额需暂停。
            if (session.error || (port.lastStopReason && port.lastStopReason !== "end_turn")) {
              session.queue.autoDrain = false;
              session.queue.pauseReason = port.lastStopReason === "cancelled" ? "stopped" : "error";
            }
          });
          await appendDiagnostic(
            session,
            {
              kind: session.error ? "turn-interrupted" : "turn-completed",
              turnIndex: turnIndexForCommand(session, commandId),
              stopReason: port.lastStopReason,
            },
            completedAt,
          );
          active.delete(session.id);
          // 修复原因：工作流可在主回合占用 ACP 连接时先完成；释放连接后必须主动派送结果。
          scheduleQueueDrain(session);
          scheduleWorkflowNotifications(session);
        }
      });
    } catch (error) {
      if (!admitted) promptAdmissions.get(`${session.id}:${commandId}`)?.reject(error);
      const interruptedAt = Date.now();
      await queueGate.run(session.id, async () => {
        if (ownsRun()) {
          active.delete(session.id);
          // Capability/file validation precedes admission: rejected input never enters history.
          if (!admitted) {
            // 另一条输入可在本轮准备阶段入队；准备失败也必须暂停这些已接受输入。
            if (session.queue.items.length) {
              await changeQueue(session, () => {
                session.queue.autoDrain = false;
                session.queue.pauseReason = "error";
                for (const item of session.queue.items) item.state = "queued";
              }).catch(() => {});
            }
            throw error;
          }
          await mutate(session, () => {
            session.status = "interrupted";
            session.queue.autoDrain = false;
            session.queue.pauseReason = "error";
            session.usageBaselineKnown = false;
            session.pendingPermission = null;
            const failure = failureFromAcpError(error, commandId);
            session.error = failure.title;
            recordAcpSessionFailure(session, commandId, failure);
            const turnIndex = turnIndexForCommand(session, commandId);
            const entry = turnIndex === undefined ? undefined : session.entries[turnIndex];
            if (entry?.kind === "user") entry.traceError = failure.title;
          }).catch((persistenceError) => {
            logger.warn(undefined, "ACP turn interruption persistence failed", {
              error: failureMessage(persistenceError),
            });
          });
          await appendDiagnostic(
            session,
            { kind: "turn-interrupted", turnIndex: turnIndexForCommand(session, commandId) },
            interruptedAt,
          );
          scheduleWorkflowNotifications(session);
          throw error;
        }
      });
      // 用户已停止本轮或旧进程已退出：结果由 Host 快照决定，不重复报告取消为发送失败。
    } finally {
      if (!admitted)
        promptAdmissions
          .get(`${session.id}:${commandId}`)
          ?.reject(new Error("ACP prompt was not admitted"));
      // stop 后新轮可先完成，不能覆盖旧轮 IO；删除/关闭必须等到所有未接受副本清理完。
      try {
        if (!admitted) await attachmentStore.discard(session.id, attachmentGroup);
      } finally {
        finishAttachmentIO();
      }
    }
    return structuredClone(session);
  };

  const stopSession = async (
    session: AcpSession,
    parsed?: ReturnType<typeof acpStopInputSchema.parse>,
  ): Promise<void> => {
    // 待办观察取消只针对其实际 command；旧取消请求不能停止用户后续的新消息或工作流。
    if (parsed?.expectedCommandId && active.get(session.id) !== parsed?.expectedCommandId) return;
    if (stopping.has(session.id)) return;
    const hadActive = active.has(session.id);
    const commandId = active.get(session.id);
    const stoppedAt = Date.now();
    stopping.add(session.id);
    active.delete(session.id);
    // 修复原因：取消结束后新队列无需等待旧异步准备返回；旧 task 只负责清理，失去消费权。
    activeTokens.delete(session.id);
    queueTasks.delete(session.id);
    try {
      // 停止栅栏先占位，再异步暂停委派；不能在 await 间隙接收新轮消息。
      await options.delegation?.onStop(session);
      workflowHost.stopSession(session.id);
      await changeQueue(session, () => {
        session.queue.autoDrain = false;
        session.queue.pauseReason = "stopped";
        for (const item of session.queue.items) item.state = "queued";
      });
      rejectAdmissions(session.id, new Error("ACP prompt stopped before admission"));
      if (!hadActive) return;
      settlePermission(session.id, stoppedAt);
      await mutate(session, () => {
        finishAcpThoughts(session, "interrupted", stoppedAt);
        session.status = "idle";
        session.usageBaselineKnown = false;
        session.pendingPermission = null;
      });
      await appendDiagnostic(
        session,
        {
          kind: "turn-stopped",
          turnIndex: turnIndexForCommand(session, commandId),
          stopReason: "cancelled",
        },
        stoppedAt,
      );
      await connections.get(session.id)?.cancel();
    } finally {
      // 取消后终止旧连接，避免旧 prompt 未结束时新轮进入同一 Agent 进程。
      if (hadActive) detach(session.id);
      stopping.delete(session.id);
    }
  };

  // 两个公开接口只选择等待边界，共用唯一的校验、幂等、串行 admission 和 Agent 执行路径。
  const dispatchPrompt = async (
    input: AcpWorkspace & { id: string } & AcpPromptInput,
    observeAdmission?: (admission: Promise<AcpSession>) => void,
  ) => {
    const submission = acpPromptSubmissionSchema.parse(input);
    const session = await scoped(submission);
    if (stopping.has(session.id) || configuring.has(session.id))
      throw new Error("ACP session is running");
    const prompt = acpPromptInputSchema.parse(submission);
    prompt.commandId = prompt.commandId.trim();
    if (
      !prompt.commandId ||
      (!prompt.text.trim() && !prompt.attachments.length && !prompt.workspaceFiles.length)
    )
      throw new Error("ACP prompt is empty");
    const receipt = await queueGate.run(session.id, async () => {
      ensureOpen(session);
      if (
        session.entries.some((entry) => entry.id === `user:${prompt.commandId}`) ||
        session.queue.items.some((item) => item.commandId === prompt.commandId) ||
        session.queue.discardedCommandIds?.includes(prompt.commandId)
      )
        return { snapshot: structuredClone(session) };
      const existing = promptTasks.get(`${session.id}:${prompt.commandId}`);
      if (existing) {
        const admission = promptAdmissions.get(`${session.id}:${prompt.commandId}`)!.promise;
        observeAdmission?.(admission);
        return { turn: existing, admission };
      }
      if (stopping.has(session.id) || configuring.has(session.id))
        throw new Error("ACP session is running");
      if (
        internalResults.has(prompt.commandId) &&
        (active.has(session.id) || session.queue.items.length)
      )
        throw new Error("ACP session is running");
      if (active.has(session.id) || session.status === "running" || session.queue.items.length) {
        const key = `${session.id}:${prompt.commandId}`;
        const admission = beginAdmission(session, prompt.commandId);
        observeAdmission?.(admission.promise);
        try {
          await enqueuePrompt(session, prompt);
          const snapshot = acpSessionSchema.parse(structuredClone(session));
          admission.resolve(snapshot);
          return { snapshot };
        } catch (error) {
          admission.reject(error);
          throw error;
        } finally {
          promptAdmissions.delete(key);
        }
      }
      active.set(session.id, prompt.commandId);
      activeTokens.set(session.id, {});
      const key = `${session.id}:${prompt.commandId}`;
      const admission = beginAdmission(session, prompt.commandId).promise;
      observeAdmission?.(admission);
      const turn = executePrompt(session, prompt);
      promptTasks.set(key, turn);
      void turn
        .finally(() => {
          if (promptTasks.get(key) === turn) {
            promptTasks.delete(key);
            promptAdmissions.delete(key);
          }
        })
        .catch(() => {});
      return { turn, admission };
    });
    scheduleQueueDrain(session);
    return receipt;
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
    listAgents: (options) => agentManager.listAgents(options),
    listGeminiProviders: () => agentManager.listGeminiProviders(),
    updateGeminiProviders: (input) => agentManager.updateGeminiProviders(input),
    listAvailableAgents: async () =>
      acpAgentAvailabilityListSchema.parse(await agentManager.listAvailableAgents()),
    async listAgentConfigs(input) {
      if (disposed) throw new Error("ACP service closed");
      return readAcpAgentConfigs(directory, acpWorkspaceSchema.parse(input), sessions, removed);
    },
    onDynamicAgentConfigsChanged() {
      return (listener) => {
        const observed = new Map(
          [...sessions.values()].map((session) => [session.id, acpAgentConfigFingerprint(session)]),
        );
        return emitter.event((change) => {
          if (change.kind === "removed") {
            observed.delete(change.id);
            listener();
            return;
          }
          const signature = acpAgentConfigFingerprint(change.session);
          const previous = observed.get(change.session.id);
          observed.set(change.session.id, signature);
          // 配置目录是会话快照的派生投影；消息流不能反复触发全 Host 文件查询。
          if (previous === signature) return;
          if (
            previous === undefined &&
            !change.session.configOptions.length &&
            !change.session.modeState
          )
            return;
          listener();
        });
      };
    },
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
    async prepareWorktreeRemoval(workspace) {
      const scopedSessions = await listScopedSessions(workspace);
      // 修复原因：删除工作树时不能用 remove() 清理连接，它会连持久对话一起删除。
      // Host 自身的 active/workflow 所有者先拒绝运行，再仅断开空闲适配器。
      if (
        scopedSessions.some(
          (session) =>
            active.has(session.id) ||
            session.queue.items.length > 0 ||
            workflowHost.ownsLive(session.id),
        )
      ) {
        return false;
      }
      for (const session of scopedSessions) detach(session.id);
      return true;
    },
    async getUsageStats(request) {
      if (request.range !== "all" && request.range !== "7d" && request.range !== "30d")
        throw new Error("Invalid app usage range");
      const current = await listAllSessions();
      // 修复原因：统计页从未接入 Codex 原生请求，因而全是未知轮次；只读回溯
      // 不启动 Agent，也不把会话累计硬塞给当前用户消息。并发区间查询共用一次 IO。
      if (!usageHistoryRead) {
        usageHistoryRead = (async () => {
          const root = await agentManager.resolveCodexHome?.();
          return root
            ? usageHistoryReader.read(current, root)
            : new Map<string, CodexUsageHistory>();
        })().catch(() => new Map<string, CodexUsageHistory>());
      }
      const flight = usageHistoryRead;
      let histories: Map<string, CodexUsageHistory>;
      try {
        histories = await flight;
      } finally {
        if (usageHistoryRead === flight) usageHistoryRead = null;
      }
      if (disposed) throw new Error("ACP service closed");
      return summarizeAcpUsage(
        current.filter((session) => !removed.has(session.id)),
        request,
        Date.now(),
        histories,
      );
    },
    async search(input) {
      const query = acpSessionSearchInputSchema.parse(input);
      return searchAcpSessions(await listScopedSessions(query), query);
    },
    async read(input) {
      const session = await scoped(input);
      const snapshot = structuredClone(session);
      // 修复原因：只等待快照里尚在提交的接受事实，不占 queue gate 等待 stop/cancel。
      // 否则取消 RPC 等 Agent 时，重连 read 也会被锁住；未落盘的 user row 又不能当 ACK。
      await Promise.all(
        [...promptAdmissions.values()]
          .filter(
            (admission) =>
              admission.sessionId === session.id &&
              (snapshot.entries.some((entry) => entry.id === `user:${admission.commandId}`) ||
                snapshot.queue.items.some((item) => item.commandId === admission.commandId)),
          )
          .map((admission) => admission.promise),
      );
      return snapshot;
    },
    async readAttachment(input) {
      const params = acpAttachmentReadInputSchema.parse(input);
      const session = await scoped(params);
      if (removed.has(session.id) || disposed) throw new Error("ACP session closed");
      const attachment = session.entries
        .flatMap((entry) => (entry.kind === "user" ? (entry.attachments ?? []) : []))
        .find((item) => item.ref === params.ref);
      if (!attachment) throw new Error("ACP attachment does not belong to this session");
      return acpAttachmentReadResultSchema.parse(
        await attachmentStore.read(session.id, attachment, params.offset, params.limit),
      );
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
          session.queue.items.length > 0 ||
          session.goal !== null
        )
          throw error;
        return structuredClone(await recoverEmptySession(session));
      }
      return structuredClone(session);
    },
    async create(input) {
      if (disposed) throw new Error("ACP service closed");
      const { agent, requestId, deferPersistence, usePermissionPreference, ...target } =
        acpCreateInputSchema.parse(input);
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
          contextUsage: null,
          entries: [],
          terminals: [],
          queue: { items: [], autoDrain: true },
          usageBaselineKnown: true,
          usageBaseline: null,
          usageTurns: [],
          pendingPermission: null,
          error: null,
        };
        try {
          // 空草稿不落会话历史，但显式权限偏好由 Host 独立持久化；内部 create 不继承它。
          if (usePermissionPreference)
            session.permissionSelection = await permissionPreferences.read(target, agent);
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
    async notifyResult(input) {
      const session = await scoped(input);
      if (session.entries.some((entry) => entry.id === `user:${input.commandId}`)) return true;
      if (
        disposed ||
        removed.has(session.id) ||
        !connections.has(session.id) ||
        active.has(session.id) ||
        stopping.has(session.id) ||
        configuring.has(session.id) ||
        session.queue.items.length > 0 ||
        session.status === "running"
      )
        return false;
      // 复用普通 prompt 的唯一 admission；只等待落盘，不阻塞委派 lease 心跳。
      let resolveAdmission!: (value: boolean) => void;
      let rejectAdmission!: (error: unknown) => void;
      const receipt = new Promise<boolean>((resolve, reject) => {
        resolveAdmission = resolve;
        rejectAdmission = reject;
      });
      const listener = emitter.event((change) => {
        if (
          change.kind === "updated" &&
          change.session.id === session.id &&
          change.session.entries.some((entry) => entry.id === `user:${input.commandId}`)
        )
          resolveAdmission(true);
      });
      internalResults.add(input.commandId);
      const prompt = service.prompt({ ...input, attachments: [], workspaceFiles: [] });
      void prompt
        .then(
          () =>
            resolveAdmission(
              session.entries.some((entry) => entry.id === `user:${input.commandId}`),
            ),
          rejectAdmission,
        )
        .finally(() => internalResults.delete(input.commandId));
      try {
        return await receipt;
      } finally {
        listener.dispose();
      }
    },
    submitPrompt(input) {
      // 关闭可先终结接受等待，附件复制仍由原 gate 收尾；不等待未接受 IO 才释放输入框。
      return new Promise<AcpSession>((resolve, reject) => {
        void dispatchPrompt(input, (admission) => {
          void admission.then(resolve, reject);
        }).then((receipt) => {
          if (receipt.snapshot) resolve(receipt.snapshot);
        }, reject);
      });
    },
    async prompt(input) {
      const receipt = await dispatchPrompt(input);
      return receipt.turn ? receipt.turn : receipt.snapshot!;
    },
    async deleteQueueItem(input) {
      const parsed = acpQueueItemInputSchema.parse(input);
      const session = await scoped(parsed);
      await queueGate.run(session.id, async () => {
        ensureOpen(session);
        if (session.queue.discardedCommandIds?.includes(parsed.queueItemId)) return;
        const item = editableQueueItem(session, parsed.queueItemId);
        await changeQueue(session, () => {
          session.queue.items = session.queue.items.filter((candidate) => candidate !== item);
          (session.queue.discardedCommandIds ??= []).push(item.commandId);
        });
        await attachmentStore.discardRefs(session.id, item.attachments);
      });
      scheduleQueueDrain(session);
      scheduleWorkflowNotifications(session);
      return structuredClone(session);
    },
    async editQueueItem(input) {
      const parsed = acpQueueEditInputSchema.parse(input);
      const session = await scoped(parsed);
      await queueGate.run(session.id, async () => {
        ensureOpen(session);
        const item = editableQueueItem(session, parsed.queueItemId);
        if (!parsed.text.trim() && !item.attachments.length && !item.workspaceFiles.length)
          throw new Error("ACP prompt is empty");
        await changeQueue(session, () => {
          item.text = parsed.text;
        });
      });
      return structuredClone(session);
    },
    async reorderQueueItem(input) {
      const parsed = acpQueueReorderInputSchema.parse(input);
      const session = await scoped(parsed);
      await queueGate.run(session.id, async () => {
        ensureOpen(session);
        const item = editableQueueItem(session, parsed.queueItemId);
        if (parsed.beforeQueueItemId === item.commandId) return;
        if (parsed.beforeQueueItemId) editableQueueItem(session, parsed.beforeQueueItemId);
        await changeQueue(session, () => {
          const items = session.queue.items.filter((candidate) => candidate !== item);
          const index = parsed.beforeQueueItemId
            ? items.findIndex((candidate) => candidate.commandId === parsed.beforeQueueItemId)
            : items.length;
          items.splice(index, 0, item);
          session.queue.items = items;
        });
      });
      scheduleQueueDrain(session);
      return structuredClone(session);
    },
    async setQueueAutoDrain(input) {
      const parsed = acpQueueAutoDrainInputSchema.parse(input);
      const session = await scoped(parsed);
      await queueGate.run(session.id, async () => {
        ensureOpen(session);
        await changeQueue(session, () => {
          session.queue.autoDrain = parsed.autoDrain;
          if (parsed.autoDrain) delete session.queue.pauseReason;
          else session.queue.pauseReason = "manual";
        });
      });
      scheduleQueueDrain(session);
      return structuredClone(session);
    },
    async sendQueuedNow(input) {
      const parsed = acpQueueItemInputSchema.parse(input);
      const session = await scoped(parsed);
      await queueGate.run(session.id, async () => {
        ensureOpen(session);
        if (configuring.has(session.id)) throw new Error("ACP session is running");
        const item = editableQueueItem(session, parsed.queueItemId);
        const previous = {
          autoDrain: session.queue.autoDrain,
          pauseReason: session.queue.pauseReason,
        };
        await stopSession(session);
        ensureOpen(session);
        await changeQueue(session, () => {
          session.queue.autoDrain = previous.autoDrain;
          session.queue.pauseReason = previous.pauseReason;
        });
        await reserveQueuedPrompt(session, item);
        launchQueuedPrompt(session, item);
      });
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
      input = acpSetConfigOptionInputSchema.parse(input);
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
          if (option.currentValue !== input.value) {
            const next = await port.setConfigOption(option.id, input.value);
            if (disposed || connections.get(session.id) !== port || removed.has(session.id))
              throw new Error("ACP session changed while configuring");
            await mutate(session, () => {
              session.configOptions = next;
            });
          }
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
          if (session.modeState.currentModeId !== input.value) {
            await port.setMode(input.value);
            if (disposed || connections.get(session.id) !== port || removed.has(session.id))
              throw new Error("ACP session changed while configuring");
            await mutate(session, () => {
              session.modeState!.currentModeId = input.value as string;
            });
          }
        } else throw new Error("ACP config option is not available");
        const isPermission = option ? isAcpPermissionOption(option) : input.configId === "mode";
        if (isPermission && typeof input.value === "string") {
          const selection = sessionPermissionSelection(session, input.configId);
          if (
            !selection ||
            selection.configId !== input.configId ||
            selection.value !== input.value
          )
            throw new Error("ACP Agent did not apply the selected permission mode");
          if (disposed || connections.get(session.id) !== port || removed.has(session.id))
            throw new Error("ACP session changed while configuring");
          if (
            session.permissionSelection?.configId !== selection.configId ||
            session.permissionSelection.value !== selection.value
          )
            await mutate(session, () => {
              session.permissionSelection = selection;
            });
          if (input.rememberPermission)
            await permissionPreferences.remember(session, session.agent, selection);
        }
        return structuredClone(session);
      } finally {
        configuring.delete(session.id);
        scheduleQueueDrain(session);
      }
    },
    async stop(input) {
      const parsed = acpStopInputSchema.parse(input);
      const session = await scoped(parsed);
      await queueGate.run(session.id, () => {
        ensureOpen(session);
        return stopSession(session, parsed);
      });
    },
    async stopTerminal(input) {
      const params = acpTerminalControlSchema.parse(input);
      const session = await scoped(params);
      ensureOpen(session);
      const terminal = session.terminals.find((t) => t.terminalId === params.terminalId);
      if (!terminal) throw new Error("Unknown ACP terminal");
      if (terminal.status !== "running") return;
      const port = connections.get(session.id);
      if (!port?.stopTerminal) throw new Error("ACP terminal is no longer connected");
      await port.stopTerminal(params.terminalId);
    },
    async cancelWorkflow(input) {
      const params = acpWorkflowControlSchema.parse(input);
      const session = await scoped(params);
      await workflowHost.get(session, params.runId);
      await settleWorkflowPermissions(session, params.runId);
      try {
        await workflowHost.cancel(session, params.runId);
      } finally {
        await settleWorkflowPermissions(session, params.runId);
      }
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
      const receivedAt = Date.now();
      const session = await scoped(input);
      const decision = pending.get(session.id);
      if (!decision || decision.requestId !== input.requestId)
        throw new Error("ACP permission expired");
      if (!session.pendingPermission?.options.some((item) => item.optionId === input.optionId)) {
        throw new Error("Invalid ACP permission option");
      }
      const selectedKind = session.pendingPermission.options.find(
        (item) => item.optionId === input.optionId,
      )?.kind;
      const requestTrace = permissionQueues.get(session.id)?.[0]?.trace ?? {};
      await mutate(session, () => {
        session.pendingPermission = null;
      });
      // 写入快照期间 stop/remove 可能已取消此请求；迟到的允许不能到达 Agent。
      if (
        pending.get(session.id) !== decision ||
        (!active.has(session.id) && !workflowHost.ownsLive(session.id))
      ) {
        throw new Error("ACP permission expired");
      }
      // 修复原因：先完成 Host 轨迹再允许适配器恢复，否则 fast adapter 的完成事件可跑在授权记录前。
      await diagnosticWrites.get(session.id);
      await appendDiagnostic(
        session,
        {
          kind: "permission-resolved",
          ...requestTrace,
          ...(/^[0-9a-f-]{36}$/i.test(input.requestId) ? { requestId: input.requestId } : {}),
          permissionDecision:
            selectedKind === "allow_once" ||
            selectedKind === "allow_always" ||
            selectedKind === "reject_once" ||
            selectedKind === "reject_always"
              ? selectedKind
              : "unknown",
        },
        receivedAt,
      );
      if (
        pending.get(session.id) !== decision ||
        (!active.has(session.id) && !workflowHost.ownsLive(session.id))
      ) {
        throw new Error("ACP permission expired");
      }
      pending.delete(session.id);
      const queue = permissionQueues.get(session.id);
      if (queue?.[0]?.request.requestId === input.requestId) {
        queue.shift();
        if (!queue.length) permissionQueues.delete(session.id);
        else
          queueMicrotask(() => {
            void showNextPermission(session);
          });
      }
      decision.resolve(input.optionId);
    },
    async remove(input) {
      const session = await scoped(input);
      const admitted = await queueGate.run(session.id, async () => {
        // 修复原因：与 enqueue/admission 共用栅栏，清理预连接不能删除刚接受的队列。
        if (input.provisionalOnly && (!session.provisional || active.has(session.id))) return false;
        workflowHost.stopSession(session.id);
        removed.add(session.id);
        rejectAdmissions(session.id, new Error("ACP session removed before admission"));
        active.delete(session.id);
        activeTokens.delete(session.id);
        detach(session.id);
        return true;
      });
      if (!admitted) return;
      await options.delegation?.onStop(session);
      for (const [key, id] of created) if (id === session.id) created.delete(key);
      removed.add(session.id);
      active.delete(session.id);
      stopping.delete(session.id);
      detach(session.id);
      await streamingWrites.get(session.id);
      await writes.get(session.id);
      await diagnosticWrites.get(session.id);
      await Promise.allSettled(attachmentWrites.get(session.id) ?? []);
      await attachmentStore.remove(session.id);
      await rm(file(session.id), { force: true });
      await rm(diagnosticFile(session.id), { force: true });
      sessions.delete(session.id);
      streamingWrites.delete(session.id);
      scheduledSnapshotRevisions.delete(session.id);
      emitter.fire({
        kind: "removed",
        id: session.id,
        workspaceKey: workspaceKey(session),
        workspacePath: session.workspacePath,
        ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
      });
    },
    onDynamicExecutionTraceChanged(workspace) {
      const target = acpWorkspaceSchema.parse(workspace);
      return (listener) =>
        traceEmitter.event((change) => {
          if (
            workspaceKey(change) === workspaceKey(target) &&
            change.workspacePath === target.workspacePath
          )
            listener(change);
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
      usageHistoryReader.dispose();
      for (const admission of promptAdmissions.values())
        admission.reject(new Error("ACP service closed before admission"));
      // Host 换代即撤销全部旧轮消费权；迟到 rejection 不能再写入新 Host 已恢复的快照。
      active.clear();
      activeTokens.clear();
      queueTasks.clear();
      workflowHost.dispose();
      for (const id of connections.keys()) detach(id);
      for (const id of connecting.keys()) detach(id);
      for (const id of pending.keys()) settlePermission(id);
      workflowMcp.dispose();
      emitter.dispose();
      traceEmitter.dispose();
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
      // 排队复制属于同一 admission 栅栏；关闭 Host 也必须等未接受附件完成清理。
      await queueGate.settle();
      await workflowHost.settleAll();
      await Promise.allSettled([...notificationTasks]);
      // 流式待写任务执行后才创建完整快照 IO；先等任务，不能提前读取 writes 后漏等尾段。
      await Promise.allSettled(streamingWrites.values());
      await Promise.allSettled([...writes.values()]);
      await permissionPreferences.settle();
      await Promise.allSettled(diagnosticWrites.values());
      await Promise.allSettled([...attachmentWrites.values()].flatMap((tasks) => [...tasks]));
    },
  };
  return service;
}

function recordNativeUsage(session: AcpSession, port: AcpConnectionPort): void {
  const report = port.nativeUsage;
  // 修复原因：原生文件迟到或恢复到其它会话时，不能将旧 ID 的累计量串入当前快照。
  if (
    report &&
    report.nativeSessionId === port.sessionId &&
    (!session.acpSessionId || session.acpSessionId === port.sessionId)
  )
    session.nativeUsage = structuredClone(report);
}
