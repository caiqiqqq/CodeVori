/* oxlint-disable eslint(max-lines) -- ACP Host owner keeps admission, persistence, permission and process-generation checks in one state machine. */
import { randomUUID } from "node:crypto";
import {
  appendAcpConversationEntry,
  finishAcpThoughts,
  finishAcpTurn,
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
import { AcpStreamDiagnostics } from "./acpStreamDiagnostics.js";
import { AcpConversationProjection } from "./acpConversationProjection.js";
import { AcpCompactionTiming } from "./acpCompactionTiming.js";
import {
  acpConversationTargetSchema,
  PhaseTimer,
  acpConversationReadSchema,
  acpConversationRowsRangeSchema,
  summarizeAcpSession,
  resolveDynamicWorkflowClientConfig,
  type DynamicWorkflowClientConfig,
  type AcpSessionSummary,
} from "@zcode/shared";
import type { ConversationDelta } from "@zcode/shared/zcode-protocol-v4";
import type { ContentBlock, PromptCapabilities } from "@agentclientprotocol/sdk";
import {
  acpAgentAvailabilityListSchema,
  ACP_AGENT_MODEL_ENV,
  acpAgentModelsInputSchema,
  acpAgentUpdateSchema,
  acpAgentDefinition,
  acpCreateInputSchema,
  acpSetConfigOptionInputSchema,
  acpDiagnosticEventSchema,
  acpExecutionTraceChangedSchema,
  acpPromptInputSchema,
  acpPromptSubmissionSchema,
  acpQueueItemInputSchema,
  acpQueueItemSchema,
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
  acpElicitationSchema,
  acpElicitationResponseSchema,
  validateAcpElicitationContent,
  type AcpElicitation,
  type AcpElicitationResponse,
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
import { OperationDiagnostics } from "@zcode/rpc";
import { getZCodeDataRootDir } from "../paths.js";
import type { IMcpSyncService } from "../mcp-sync/mcpSync.js";
import type { ISkillsService } from "../skills/skills.js";
import type { IComposerPreferenceService } from "../composer-preference/contract.js";
import type { ComposerPreference } from "@zcode/shared";
import type { IAcpService } from "./acpService.js";
import { AcpSessionLoadError, connectAcpAgent } from "./acpStdioConnection.js";
import { buildAcpPromptBlocks } from "./acpPromptBlocks.js";
import type { ProjectMemoryContext } from "../memory/projectMemoryContext.js";
import { AcpQueueGate } from "./acpQueueGate.js";
import { AcpAttachmentStore } from "./acpAttachmentStore.js";
import {
  ACP_ATTACHMENTS_MCP_NAME,
  acpAttachmentMcpEndpoint,
  acpAttachmentPromptContext,
  sentAcpAttachments,
} from "./acpSessionAttachments.js";
import { projectAcpPluginMcpServers } from "./acpMcpServers.js";
import { createAcpWorkflowMcp } from "./acpWorkflowMcp.js";
import { AcpWorkflowHost } from "./acpWorkflowHost.js";
import { acpConfigValues } from "./acpConfigOptions.js";
import {
  acpConfigOptionsRestored,
  defaultAcpModelSelection,
  restoreAcpConfigOptions,
} from "./acpConfigRestore.js";
import {
  AcpPermissionPreferences,
  isAcpPermissionOption,
  restoreAcpPermission,
  sessionPermissionSelection,
} from "./acpPermissionPreferences.js";
import {
  acpAgentConfigFingerprint,
  projectAcpAgentModels,
  readAcpAgentConfigs,
} from "./acpAgentConfigs.js";
import { projectAcpContextUsage } from "./acpContextUsage.js";
import type { AcpToolDetails } from "./acpToolDetails.js";
import { excludeDelegatedAcpSessions, searchAcpSessions } from "./acpSessionSearch.js";
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
import { AcpTextGeneration } from "./acpTextGeneration.js";
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
  /** Isolated Claude text request; no built-in tools, settings or Host terminal access. */
  textOnly?: boolean;
  onUpdate: (update: AcpUpdate) => Promise<void>;
  onPermission: (request: AcpPermission) => Promise<string | null>;
  onElicitation?: (
    request: AcpElicitation,
    signal?: AbortSignal,
  ) => Promise<AcpElicitationResponse>;
  onExit: (reason: string) => void;
}) => Promise<AcpConnectionPort>;

const logger = createServiceLogger("acp-sessions");
const performanceDiagnostics = new OperationDiagnostics(
  (record) => logger.info(undefined, "[diagnostics]", record),
  { scope: "acp-host" },
);
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
    composerPreferenceService?: IComposerPreferenceService;
    resolveInstallEnv?: () => Promise<Record<string, string>>;
    /** Same Host policy as the management page and API session tools. */
    resolveDynamicWorkflowClientConfig?: () => Promise<DynamicWorkflowClientConfig>;
    /** Projection-only membership; exact read and internal execution keep child access. */
    delegatedSessionIds?: (scope: AcpWorkspace) => Promise<string[]>;
    connect?: AcpConnectionFactory;
    agentManager?: AcpAgentManager;
    memoryContext?: ProjectMemoryContext;
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
      canPurge?(session: AcpSession): Promise<boolean>;
      onResultInput(session: AcpSession, commandId: string): Promise<void>;
    };
    issuesMcp?: {
      register(
        session: AcpSession,
      ): Promise<{ record: NativeMcpServerRecord; revoke(): void } | undefined>;
    };
  } = {},
): IAcpService & { disposeAll(): void; disposeAllAndWait(): Promise<void> } {
  const directory = options.directory ?? join(getZCodeDataRootDir(), "acp-sessions");
  const permissionPreferences = new AcpPermissionPreferences(
    join(directory, "permission-preferences"),
  );
  const initialModelPreferences = new Map<string, ComposerPreference["acpModels"][AcpAgent]>();
  const attachmentStore = new AcpAttachmentStore(join(directory, "attachments"));
  const attachmentWrites = new Map<string, Set<Promise<void>>>();
  const connect = options.connect ?? connectAcpAgent;
  const agentManager =
    options.agentManager ??
    createAcpAgentManager({
      directory: options.directory ? join(options.directory, "agent-settings") : undefined,
      resolveInstallEnv: options.resolveInstallEnv,
    });
  const sessions = new Map<string, AcpSession>();
  const streamDiagnostics = new AcpStreamDiagnostics();
  const compactionTiming = new AcpCompactionTiming();
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
  type InteractionResult = string | AcpElicitationResponse | null;
  const pending = new Map<
    string,
    { requestId: string; responding?: boolean; resolve(value: InteractionResult): void }
  >();
  const workflowMcp = createAcpWorkflowMcp(directory);
  const workflowRegistrations = new Map<string, { revoke(): void }>();
  const issuesRegistrations = new Map<string, { revoke(): void }>();
  const attachmentRegistrations = new Map<string, { revoke(): void }>();
  const interactionQueues = new Map<
    string,
    Array<{
      request: AcpPermission | AcpElicitation;
      runId?: string;
      receivedAt: number;
      trace: Pick<AcpDiagnosticEvent, "turnIndex" | "entryIndex" | "requestId">;
      resolve(value: InteractionResult): void;
    }>
  >();
  const workflowNotifications = new Map<string, Array<{ runId: string; result: unknown }>>();
  const workflowNotifying = new Set<string>();
  const notificationTasks = new Set<Promise<void>>();
  const emitter = new Emitter<AcpSessionChanged>();
  const projectionEpoch = randomUUID();
  const projections = new Map<
    string,
    {
      users: number;
      projection?: AcpConversationProjection;
      session?: AcpSessionSummary;
      fromSeq: number;
      deltas: ConversationDelta[];
    }
  >();
  const project = (session: AcpSession, streaming = false) => {
    const cached = projections.get(session.id) ?? { users: 0, fromSeq: 0, deltas: [] };
    if (!cached.projection) {
      cached.projection = new AcpConversationProjection(session, projectionEpoch);
      cached.session = summarizeAcpSession(session);
    } else if (session.revision > cached.projection.tail().seq) {
      cached.fromSeq = cached.projection.tail().seq;
      cached.deltas = cached.projection.update(session, streaming);
      cached.session = summarizeAcpSession(session);
    }
    return cached as typeof cached & {
      projection: AcpConversationProjection;
      session: AcpSessionSummary;
    };
  };
  const traceEmitter = new Emitter<AcpExecutionTraceChanged>();
  let disposed = false;
  const textGeneration = new AcpTextGeneration({
    read: (input) => service.read(input),
    connect,
    manager: agentManager,
    customConnect: !!options.connect && !options.agentManager,
  });
  const usageHistoryReader = createCodexUsageHistoryReader(
    join(directory, "usage-cache", "codex-history-v1.json"),
  );
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
  const save = async (
    session: AcpSession,
    streaming = false,
    timing?: PhaseTimer,
  ): Promise<void> => {
    if (removed.has(session.id)) return;
    const snapshotStartedAt = Date.now();
    timing?.phase("snapshot_clone");
    const cloned = structuredClone(session);
    timing?.phase("snapshot_validate");
    const snapshot = acpSessionSchema.parse(cloned);
    const receipt = streamDiagnostics.capture(session.id, snapshot.revision);
    if (snapshot.provisional) {
      // 修复原因：Codeg 会预连接取得 Agent 选项，但空草稿不能先进入持久会话历史。
      if (!disposed) {
        if (projections.has(snapshot.id)) project(snapshot, streaming);
        emitter.fire({ kind: "updated", session: snapshot });
      }
      return;
    }
    const previous = writes.get(session.id) ?? Promise.resolve();
    timing?.phase("snapshot_io_queue");
    const next = previous
      .catch(() => {})
      .then(async () => {
        timing?.phase("snapshot_mkdir");
        await mkdir(directory, { recursive: true });
        const temporary = `${file(snapshot.id)}.${randomUUID()}.tmp`;
        try {
          timing?.phase("snapshot_serialize");
          const serialized = JSON.stringify(snapshot);
          timing?.setFacts({ snapshotBytes: Buffer.byteLength(serialized) });
          timing?.phase("snapshot_write");
          await writeFile(temporary, serialized, { mode: 0o600 });
          timing?.phase("snapshot_rename");
          await rename(temporary, file(snapshot.id));
          if (!disposed && !removed.has(session.id)) {
            // 取证依据：只有原子替换成功后的通知才代表可显示事实；诊断不进入磁盘会话。
            const trace = streamDiagnostics.broadcast(
              session.id,
              snapshot.revision,
              receipt,
              snapshotStartedAt,
              Date.now(),
              snapshot.status !== "running",
            );
            timing?.phase("snapshot_projection");
            if (projections.has(snapshot.id)) project(snapshot, streaming);
            timing?.phase("snapshot_broadcast");
            emitter.fire({
              kind: "updated",
              session: snapshot,
              ...(trace ? { streamDiagnostics: trace } : {}),
            });
          }
        } finally {
          timing?.phase("snapshot_cleanup");
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
        return save(session, true);
      });
    streamingWrites.set(session.id, next);
    return next;
  };
  const mutate = async (
    session: AcpSession,
    change: () => void,
    streaming = false,
    timing?: PhaseTimer,
  ): Promise<void> => {
    if (session.deletionState) throw new Error("conversation deletion pending; retry deletion");
    const wasRunning = session.status === "running";
    change();
    // 修复依据：ACP 以前只有菜单写 unreadAt，后台回合结束没有未读事实可供侧栏投影。
    // 终态与未读在同一快照保存；停止/草稿/归档不产生完成未读，重复终态不重复标记。
    if (
      wasRunning &&
      session.status !== "running" &&
      !stopping.has(session.id) &&
      !session.archived &&
      isAcpHistorySession(session)
    ) {
      session.unreadAt = Math.max(Date.now(), (session.unreadAt ?? 0) + 1);
    }
    if (!session.error) delete session.errorCommandId;
    if (session.status !== "running") {
      finishAcpThoughts(
        session,
        session.status === "interrupted" ? "interrupted" : "complete",
        Date.now(),
      );
      interruptAcpCompactions(session);
      compactionTiming.removeSession(session.id);
    }
    session.revision += 1;
    await (streaming ? saveStreaming(session) : save(session, false, timing));
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
      const hadInteraction = Boolean(session.pendingPermission || session.pendingElicitation);
      session.pendingPermission = null;
      session.pendingElicitation = null;
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
      if (
        migratedLegacyTime ||
        wasRunning ||
        recoveredQueue ||
        hadRunningTerminals ||
        hadInteraction
      ) {
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
  const readProjection = async (input: AcpWorkspace & { id: string }) => {
    const owner = await scoped(input);
    const cached = projections.get(owner.id);
    if (removed.has(owner.id) || disposed) throw new Error("ACP session closed");
    if (cached?.projection && cached.session)
      return { projection: cached.projection, session: cached.session };
    // 修复依据：owner 在等待 IO 时仍可接收分片，首次读取只能以原子保存事实建立水位。
    const snapshot = owner.provisional
      ? structuredClone(owner)
      : acpSessionSchema.parse(JSON.parse(await readFile(file(owner.id), "utf8")));
    if (removed.has(owner.id) || disposed) throw new Error("ACP session closed");
    return project(snapshot);
  };
  const settleInteractions = (id: string, receivedAt = Date.now()): void => {
    const request = interactionQueues.get(id)?.[0];
    const session = sessions.get(id);
    if (session && request && pending.get(id)?.requestId === request.request.requestId) {
      // 取消也属于授权事实；关联沿用请求接收时的轮次，不能用已释放的 active 猜测。
      void appendDiagnostic(
        session,
        {
          kind: "fields" in request.request ? "elicitation-resolved" : "permission-resolved",
          ...request.trace,
          ...("fields" in request.request ? {} : { permissionDecision: "cancelled" as const }),
        },
        receivedAt,
      );
    }
    pending.get(id)?.resolve(null);
    pending.delete(id);
    for (const request of interactionQueues.get(id) ?? []) request.resolve(null);
    interactionQueues.delete(id);
  };
  const requestInteraction = (
    session: AcpSession,
    request: AcpPermission | AcpElicitation,
    runId?: string,
  ): Promise<InteractionResult> =>
    new Promise((resolve) => {
      const queue = interactionQueues.get(session.id) ?? [];
      const commandId = active.get(session.id);
      const toolIndex = runId
        ? -1
        : session.entries.findIndex(
            (entry) =>
              entry.id === `tool:${commandId}:${"toolCallId" in request ? request.toolCallId : ""}`,
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
      interactionQueues.set(session.id, queue);
      if (queue.length === 1) void showNextInteraction(session);
    });
  const requestPermission = async (session: AcpSession, request: AcpPermission, runId?: string) => {
    const result = await requestInteraction(session, request, runId);
    return typeof result === "string" ? result : null;
  };
  const cancelInteractions = async (
    session: AcpSession,
    matches: (request: { request: AcpPermission | AcpElicitation; runId?: string }) => boolean,
  ): Promise<void> => {
    const queue = interactionQueues.get(session.id);
    const cancelled = queue?.filter(matches) ?? [];
    if (!cancelled.length) return;
    const remaining = queue!.filter((request) => !matches(request));
    if (remaining.length) interactionQueues.set(session.id, remaining);
    else interactionQueues.delete(session.id);
    try {
      if (
        cancelled.some(
          (request) => pending.get(session.id)?.requestId === request.request.requestId,
        )
      ) {
        pending.delete(session.id);
        await mutate(session, () => {
          session.pendingPermission = null;
          session.pendingElicitation = null;
        });
        const request = cancelled[0]!;
        await appendDiagnostic(session, {
          kind: "fields" in request.request ? "elicitation-resolved" : "permission-resolved",
          ...request.trace,
          ...("fields" in request.request ? {} : { permissionDecision: "cancelled" as const }),
        });
        if (remaining.length) void showNextInteraction(session);
      }
    } finally {
      for (const request of cancelled) request.resolve(null);
    }
  };
  const settleWorkflowPermissions = async (session: AcpSession, runId: string): Promise<void> => {
    const queue = interactionQueues.get(session.id);
    if (!queue?.some((item) => item.runId === runId)) return;
    const activeRequest = queue[0]?.runId === runId ? queue[0] : undefined;
    const remaining = queue.filter((item) => item.runId !== runId);
    if (remaining.length) interactionQueues.set(session.id, remaining);
    else interactionQueues.delete(session.id);
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
      if (remaining.length) void showNextInteraction(session);
    }
    for (const item of queue) if (item.runId === runId) item.resolve(null);
  };
  const showNextInteraction = async (session: AcpSession): Promise<void> => {
    const next = interactionQueues.get(session.id)?.[0];
    if (!next || pending.has(session.id) || removed.has(session.id)) return;
    pending.set(session.id, { requestId: next.request.requestId, resolve: next.resolve });
    try {
      const snapshotWrite = mutate(session, () => {
        session.pendingPermission = "fields" in next.request ? null : next.request;
        session.pendingElicitation = "fields" in next.request ? next.request : null;
      });
      // 先按接收顺序占住诊断队列，队列内部等快照落盘，避免 stop 比请求记录更早写入。
      const diagnosticWrite = appendDiagnostic(
        session,
        {
          kind: "fields" in next.request ? "elicitation-requested" : "permission-requested",
          ...next.trace,
        },
        next.receivedAt,
        snapshotWrite,
      );
      await snapshotWrite;
      await diagnosticWrite;
    } catch (error) {
      logger.warn(undefined, "ACP permission persistence failed", { error: failureMessage(error) });
      settleInteractions(session.id);
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
    compactionTiming.removeSession(id);
    const session = sessions.get(id);
    if (!session?.deletionState && session?.terminals.some((t) => t.status === "running")) {
      // 主动断开也要发布失去进程所有权的事实；不能让旧连接的 running 悬挂在面板。
      void mutate(session, () => {
        for (const terminal of session.terminals)
          if (terminal.status === "running") terminal.status = "interrupted";
      });
    }
    generations.delete(id);
    settleInteractions(id);
    workflowRegistrations.get(id)?.revoke();
    workflowRegistrations.delete(id);
    delegationRegistrations.get(id)?.revoke();
    delegationRegistrations.delete(id);
    issuesRegistrations.get(id)?.revoke();
    issuesRegistrations.delete(id);
    attachmentRegistrations.get(id)?.revoke();
    attachmentRegistrations.delete(id);
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
    // 修复原因：重连握手通知可能先于 load 返回；必须在连接前冻结旧选择，恢复完成才发布。
    const savedConfigOptions = structuredClone(session.configOptions);
    let configuredDefaultModel: string | undefined;
    const generation = {};
    generations.set(session.id, generation);
    let receivedConfig = false;
    let pendingConfigOptions: AcpConfigOption[] = [];
    let configVersion = 0;
    let connectionReady = false;
    let receivedContextUsage = false;
    let updatedModeId: string | undefined;
    let issuesRegistration: { record: NativeMcpServerRecord; revoke(): void } | undefined;
    let attachmentRegistration: { record: NativeMcpServerRecord; revoke(): void } | undefined;
    // 修复原因：若仅在设置页检查启用/安装状态，create 与 session/load 仍会从旧静态命令
    // 启动禁用的 Agent。每次新连接都向同一个 Host 设置所有者重新解析，复用连接不重启。
    const connectionTask = (async () => {
      const [mcpSettings, launch, plugins] = await Promise.all([
        performanceDiagnostics.run(`acp.attach.mcp-settings.${session.agent}`, async () =>
          options.mcpSyncService?.loadMcpFromUserDirectory({
            workspacePath: session.workspacePath,
          }),
        ),
        options.connect && !options.agentManager
          ? undefined
          : performanceDiagnostics.run(`acp.attach.launch.${session.agent}`, () =>
              agentManager.resolveLaunch(session.agent),
            ),
        performanceDiagnostics.run(`acp.attach.plugins.${session.agent}`, async () =>
          options.pluginSource?.getAcpPluginCapabilities({
            workspacePath: session.workspacePath,
            ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
            ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
          }),
        ),
      ]);
      configuredDefaultModel = launch?.defaultModel;
      // 修复原因：ACP 曾绕过管理页的能力开关；新连接复用 Host 本地策略，已有运行不热撤。
      const workflowConfig = options.resolveDynamicWorkflowClientConfig
        ? await options.resolveDynamicWorkflowClientConfig()
        : resolveDynamicWorkflowClientConfig({ env: process.env });
      const workflowRegistration = workflowConfig.enabled
        ? await performanceDiagnostics.run(`acp.attach.workflow.${session.agent}`, () =>
            workflowHost.register(session),
          )
        : undefined;
      if (workflowRegistration) workflowRegistrations.set(session.id, workflowRegistration);
      const delegationRegistration = await performanceDiagnostics.run(
        `acp.attach.delegation.${session.agent}`,
        async () => options.delegation?.register(session),
      );
      if (delegationRegistration) delegationRegistrations.set(session.id, delegationRegistration);
      issuesRegistration = await options.issuesMcp?.register(session);
      // 注册期间可能已 detach；迟到的 capability 不能挂到下一代连接或继续启动 Agent。
      if (disposed || generations.get(session.id) !== generation || removed.has(session.id)) {
        issuesRegistration?.revoke();
        issuesRegistration = undefined;
        throw new Error("ACP session closed while registering issues MCP");
      }
      if (issuesRegistration) issuesRegistrations.set(session.id, issuesRegistration);
      // 首次握手就提供恢复工具；同一轮内部压缩后不依赖 Host 再次发送提示。
      attachmentRegistration = await workflowMcp.register(
        ACP_ATTACHMENTS_MCP_NAME,
        acpAttachmentMcpEndpoint({
          assertActive() {
            if (disposed || generations.get(session.id) !== generation || removed.has(session.id))
              throw new Error("ACP attachment connection is no longer active");
          },
          list: () => sentAcpAttachments(session),
          read: (ref, offset) =>
            service.readAttachment({
              workspacePath: session.workspacePath,
              ...(session.workspaceIdentity
                ? { workspaceIdentity: session.workspaceIdentity }
                : {}),
              ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
              id: session.id,
              ref,
              offset,
            }),
        }),
      );
      if (disposed || generations.get(session.id) !== generation || removed.has(session.id)) {
        attachmentRegistration.revoke();
        if (disposed) workflowMcp.dispose();
        throw new Error("ACP session closed while registering attachments MCP");
      }
      attachmentRegistrations.set(session.id, attachmentRegistration);
      return connect({
        agent: session.agent,
        workspacePath: session.workspacePath,
        sessionId: session.acpSessionId || undefined,
        ...(mcpSettings ? { mcpServers: mcpSettings.servers } : {}),
        workflowServers: [
          ...(workflowRegistration ? [workflowRegistration.record] : []),
          ...(delegationRegistration ? [delegationRegistration.record] : []),
          ...(issuesRegistration ? [issuesRegistration.record] : []),
          attachmentRegistration.record,
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
            if (update.kind === "config") {
              receivedConfig = true;
              pendingConfigOptions = update.configOptions;
              configVersion++;
            } else updatedModeId = update.modeId;
            // 恢复中的原生默认值不是已确认的会话事实；失败时保留旧选择供下一次重试。
            if (!connectionReady) return;
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
                compactionTiming.update(session, commandId, update);
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
              if (
                (update.kind === "text" ||
                  update.kind === "thought" ||
                  update.kind === "compaction_summary") &&
                update.text
              ) {
                // 只观察已通过 generation/command 门禁的分片；下一 revision 由 mutate 唯一递增。
                const entryIndex =
                  update.kind === "compaction_summary"
                    ? session.entries.findIndex(
                        (entry) =>
                          entry.kind === "compaction" &&
                          entry.id === `compaction:${commandId}:${update.id}` &&
                          entry.status === "running",
                      )
                    : session.entries.length - 1;
                if (entryIndex >= 0)
                  streamDiagnostics.received(session.id, {
                    receivedRevision: session.revision + 1,
                    receivedAt,
                    kind: update.kind,
                    chunkChars: update.text.length,
                    entryIndex,
                    entryCount: session.entries.length,
                  });
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
        onElicitation: async (request, signal) => {
          if (
            disposed ||
            signal?.aborted ||
            !active.has(session.id) ||
            stopping.has(session.id) ||
            generations.get(session.id) !== generation
          )
            return { action: "cancel" };
          const validated = acpElicitationSchema.parse(request);
          const result = requestInteraction(session, validated);
          const cancel = () => {
            void cancelInteractions(
              session,
              (item) => item.request.requestId === validated.requestId,
            ).catch(() => {
              // 修复原因：协议撤销不能被磁盘失败阻塞，失败时取消该会话的全部等待对象。
              settleInteractions(session.id);
            });
          };
          signal?.addEventListener("abort", cancel, { once: true });
          try {
            const response = await result;
            return response && typeof response !== "string" ? response : { action: "cancel" };
          } finally {
            signal?.removeEventListener("abort", cancel);
          }
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
          issuesRegistrations.get(session.id)?.revoke();
          issuesRegistrations.delete(session.id);
          attachmentRegistrations.get(session.id)?.revoke();
          attachmentRegistrations.delete(session.id);
          // Adapter root 已退出仍需回收其进程组内可能存活的 App Server 后代。
          connections.get(session.id)?.close();
          connections.delete(session.id);
          settleInteractions(session.id, receivedAt);
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
            finishAcpTurn(session, commandId, receivedAt);
            session.pendingPermission = null;
            session.pendingElicitation = null;
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
        // 恢复完成前连接不能被 prompt/config 复用，所有 attach 等待同一 ready Promise。
        const ensureGeneration = () => {
          if (disposed || generations.get(session.id) !== generation || removed.has(session.id))
            throw new Error("ACP session changed while restoring configuration");
        };
        const setRestoredConfig = async (configId: string, value: string | boolean) => {
          ensureGeneration();
          const version = configVersion;
          const next = await port.setConfigOption(configId, value);
          ensureGeneration();
          // setter 期间较新的通知优先；返回完整目录，不能复活模型切换后已移除的选项。
          return configVersion !== version ? pendingConfigOptions : next;
        };
        const initialConfig = receivedConfig ? pendingConfigOptions : (port.configOptions ?? []);
        // 新默认值只用于全新会话；重连必须恢复该会话原有的模型，不能套用新的全局偏好。
        const rememberedModel =
          !session.acpSessionId && !savedConfigOptions.length
            ? initialModelPreferences.get(session.id)
            : undefined;
        const initialModel = rememberedModel
          ? initialConfig.find(
              (item) =>
                item.id === rememberedModel.configId &&
                item.type === "select" &&
                (item.category === "model" || item.id === "model"),
            )
          : undefined;
        const rememberedSelection =
          rememberedModel &&
          initialModel?.type === "select" &&
          acpConfigValues(initialModel).includes(rememberedModel.value)
            ? [{ ...initialModel, currentValue: rememberedModel.value }]
            : undefined;
        // 新任务偏好不是会话执行事实；目录移除模型时允许打开菜单重新选择，保留原偏好供用户修复。
        if (rememberedModel && !rememberedSelection)
          logger.warn(
            undefined,
            "ACP composer model preference is unavailable in the current catalog",
            { agent: session.agent },
          );
        const selections = rememberedSelection
          ? rememberedSelection
          : !session.acpSessionId && !savedConfigOptions.length && configuredDefaultModel
            ? defaultAcpModelSelection(initialConfig, configuredDefaultModel)
            : savedConfigOptions;
        const restoredConfig = await restoreAcpConfigOptions(
          selections,
          initialConfig,
          permissionSelection?.configId,
          setRestoredConfig,
          (configId, error) =>
            logger.warn(undefined, "ACP saved option could not be restored", {
              agent: session.agent,
              configId,
              error: failureMessage(error),
            }),
        );
        ensureGeneration();
        if (restoredConfig.incomplete)
          throw new Error(
            "ACP saved configuration could not be restored; check model, reasoning and collaboration settings",
          );
        // 模型或协作模式切换也可能重置权限；最后应用专用权限恢复，保留原有严格校验。
        const restored = await restoreAcpPermission(
          {
            configOptions: restoredConfig.configOptions,
            modeState: port.modeState
              ? { ...port.modeState, currentModeId: updatedModeId ?? port.modeState.currentModeId }
              : null,
          },
          permissionSelection,
          {
            setConfigOption: setRestoredConfig,
            setMode: (modeId) => port.setMode(modeId),
          },
        );
        ensureGeneration();
        if (
          !acpConfigOptionsRestored(
            selections,
            restored.configOptions,
            permissionSelection?.configId,
          )
        )
          throw new Error("ACP saved configuration changed while restoring permission mode");
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
            connectionReady = true;
          });
        } else {
          recordNativeUsage(session, port);
          session.configOptions = restored.configOptions;
          if (permissionSelection) session.permissionSelection = permissionSelection;
          if (!receivedContextUsage && port.contextUsage !== undefined)
            session.contextUsage = projectAcpContextUsage(port.contextUsage);
          session.modeState = restored.modeState;
          connectionReady = true;
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
    } catch (error) {
      // 握手失败时 connectionTask 可能在拿到 port 前拒绝，仍需回收已签发的议题 capability。
      if (issuesRegistration && issuesRegistrations.get(session.id) === issuesRegistration) {
        issuesRegistration.revoke();
        issuesRegistrations.delete(session.id);
      }
      if (
        attachmentRegistration &&
        attachmentRegistrations.get(session.id) === attachmentRegistration
      ) {
        attachmentRegistration.revoke();
        attachmentRegistrations.delete(session.id);
      }
      throw error;
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
      const restored = await restoreAcpConfigOptions(
        session.configOptions,
        current.configOptions,
        permissionSelection?.configId,
        async (configId, value) => {
          current = await service.setConfigOption({
            workspacePath: session.workspacePath,
            ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
            ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
            id: replacement.id,
            configId,
            value,
          });
          return current.configOptions;
        },
        (configId, error) =>
          logger.warn(undefined, "ACP replacement could not restore an option", {
            agent: session.agent,
            configId,
            error: failureMessage(error),
          }),
      );
      if (permissionSelection) {
        current = await service.setConfigOption({
          workspacePath: session.workspacePath,
          ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
          ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
          id: replacement.id,
          ...permissionSelection,
        });
      }
      if (restored.incomplete) {
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
  const listVisibleSessions = async (workspace: AcpWorkspace): Promise<AcpSession[]> => {
    const sessions = await listScopedSessions(workspace);
    if (!options.delegatedSessionIds) return sessions;
    return excludeDelegatedAcpSessions(sessions, await options.delegatedSessionIds(workspace));
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
    if (session.deletionState) throw new Error("conversation deletion pending; retry deletion");
  };
  const editableQueueItem = (session: AcpSession, id: string): AcpQueueItem => {
    const item = session.queue.items.find((candidate) => candidate.commandId === id);
    if (!item) throw new Error("ACP queue item missing");
    if (item.state !== "queued") throw new Error("ACP queue item is not editable");
    return item;
  };
  const changeQueue = async (
    session: AcpSession,
    change: () => void,
    timing?: PhaseTimer,
  ): Promise<void> => {
    const before = structuredClone(session.queue);
    try {
      await mutate(session, change, false, timing);
    } catch (error) {
      // 修复原因：队列 IO 失败只能回滚队列，不能用旧快照覆盖并发流式正文。
      session.queue = before;
      throw error;
    }
  };
  const enqueuePrompt = async (
    session: AcpSession,
    prompt: ReturnType<typeof acpPromptInputSchema.parse>,
    timing?: PhaseTimer,
  ): Promise<void> => {
    if (session.queue.items.length >= 100) throw new Error("ACP queue is full (100 messages)");
    timing?.phase("agent_attach");
    const port = await attach(session);
    timing?.phase("prompt_blocks");
    const blocks = await buildAcpPromptBlocks({
      ...prompt,
      workspacePath: session.workspacePath,
      capabilities: port.promptCapabilities,
    });
    timing?.phase("attachments_save");
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
      await changeQueue(
        session,
        () => {
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
        },
        timing,
      );
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
    timing?: PhaseTimer,
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
      timing?.phase("delegation_input");
      if (!internalResults.has(commandId)) await options.delegation?.onInput(session);
      timing?.phase("agent_attach");
      const port = await attach(session);
      timing?.phase("plugin_references");
      const delegationInstruction =
        port.provisionedMcpNames?.has("zcode-delegation") &&
        delegationRegistrations.get(session.id)?.canDelegate !== false
          ? "用户提到委派或 @智能体时，使用 zcode-delegation 的 ListDelegationAgents / DelegateTask；保持当前主智能体，显式传递必要上下文，不复制全部历史。子任务完成只汇总，不自动继续修改、合并或推送。"
          : undefined;
      const workflowInstruction = /^\/workflow(?:\s|$)/i.test(prompt.text.trimStart())
        ? workflowRegistrations.has(session.id)
          ? `Use the ZCode zcode-workflows MCP ReadWorkflowInstructions tool, then call CreateWorkflow for this request: ${prompt.text.trimStart().replace(/^\/workflow\s*/i, "")}`
          : "ZCode workflows are disabled on this Host. Explain that the requested workflow cannot start; do not claim it ran or substitute another execution method."
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
      timing?.phase("skills_context");
      const skillContext = await options.skillsService?.buildPromptContext({
        workspacePath: session.workspacePath,
        ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
        prompt: prompt.text,
      });
      // 记忆由目标 Host 读取，不能借用桌面路径；只附加到模型请求，保留用户原始历史。
      timing?.phase("memory_context");
      const memoryContext = await options.memoryContext?.buildPromptContext({
        workspacePath: session.workspacePath,
        ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
        ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
      });
      timing?.phase("prompt_blocks");
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
      if (memoryContext) blocks.push({ type: "text", text: memoryContext });
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
      timing?.phase("attachments_save");
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
      timing?.phase("admission_prepare");
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
      timing?.phase("admission_queue");
      await queueGate.run(session.id, async () => {
        timing?.phase("admission_backup");
        if (!ownsRun() || disposed || removed.has(session.id)) return;
        const beforeAdmission = structuredClone(session);
        try {
          await mutate(
            session,
            () => {
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
            },
            false,
            timing,
          );
          admitted = true;
          // 接受凭证来自成功落盘的同一快照；后续诊断、模型重连和整轮执行都不阻塞输入框。
          timing?.phase("receipt_clone_validate");
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
      // admission 已接受本轮附件后再派生清单；不改用户历史，也不反复发送历史图片字节。
      const attachmentContext = acpAttachmentPromptContext(session);
      if (attachmentContext) blocks.push({ type: "text", text: attachmentContext });
      const usage = await port.prompt(prompt.text, blocks);
      const completedAt = Date.now();
      if (ownsRun()) await cancelInteractions(session, (item) => !item.runId);
      await queueGate.run(session.id, async () => {
        if (ownsRun() && connections.get(session.id) === port && !disposed) {
          await mutate(session, () => {
            finishAcpTurn(session, commandId, completedAt, port.lastStopReason ?? "end_turn");
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
            session.pendingElicitation = null;
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
          await cancelInteractions(session, (item) => !item.runId);
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
            finishAcpTurn(session, commandId, interruptedAt);
            session.status = "interrupted";
            session.queue.autoDrain = false;
            session.queue.pauseReason = "error";
            session.usageBaselineKnown = false;
            session.pendingPermission = null;
            session.pendingElicitation = null;
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
      settleInteractions(session.id, stoppedAt);
      await mutate(session, () => {
        finishAcpTurn(session, commandId, stoppedAt, "cancelled");
        finishAcpThoughts(session, "interrupted", stoppedAt);
        session.status = "idle";
        session.usageBaselineKnown = false;
        session.pendingPermission = null;
        session.pendingElicitation = null;
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
    timing?: PhaseTimer,
  ) => {
    const submission = acpPromptSubmissionSchema.parse(input);
    timing?.phase("session_load");
    const session = await scoped(submission);
    timing?.setFacts({ entries: session.entries.length, queueItems: session.queue.items.length });
    timing?.phase("input_validate");
    if (stopping.has(session.id) || configuring.has(session.id))
      throw new Error("ACP session is running");
    const prompt = acpPromptInputSchema.parse(submission);
    prompt.commandId = prompt.commandId.trim();
    if (
      !prompt.commandId ||
      (!prompt.text.trim() && !prompt.attachments.length && !prompt.workspaceFiles.length)
    )
      throw new Error("ACP prompt is empty");
    timing?.phase("dispatch_queue");
    const receipt = await queueGate.run(session.id, async () => {
      timing?.phase("dispatch_check");
      ensureOpen(session);
      if (session.archived) throw new Error("Restore the archived conversation before sending");
      if (
        session.entries.some((entry) => entry.id === `user:${prompt.commandId}`) ||
        session.queue.items.some((item) => item.commandId === prompt.commandId) ||
        session.queue.discardedCommandIds?.includes(prompt.commandId)
      ) {
        timing?.setFacts({ duplicate: true });
        return { snapshot: structuredClone(session) };
      }
      const existing = promptTasks.get(`${session.id}:${prompt.commandId}`);
      if (existing) {
        timing?.phase("existing_admission");
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
          await enqueuePrompt(session, prompt, timing);
          timing?.phase("receipt_clone_validate");
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
      const turn = executePrompt(session, prompt, undefined, timing);
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

  const removeSession = async (
    input: AcpWorkspace & { id: string; provisionalOnly?: boolean },
    archivedOnly: boolean,
  ): Promise<boolean> => {
    let session: AcpSession;
    try {
      session = await scoped(input);
    } catch (error) {
      if (archivedOnly && (error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
    return queueGate.run(session.id, async () => {
      if (
        archivedOnly &&
        (!session.archived ||
          active.has(session.id) ||
          stopping.has(session.id) ||
          configuring.has(session.id) ||
          session.terminals.some((terminal) => terminal.status === "running") ||
          session.queue.items.length ||
          pending.has(session.id) ||
          workflowHost.ownsLive(session.id) ||
          session.status === "running")
      )
        return false;
      if (input.provisionalOnly && (!session.provisional || active.has(session.id))) return false;
      if (
        archivedOnly &&
        options.delegation?.canPurge &&
        !(await options.delegation.canPurge(session))
      )
        return false;
      if (!archivedOnly) removed.add(session.id);
      // 修复原因：旧归档删除检查只在 UI，另一端恢复后仍会被删除；检查与 restore 共用 admission gate。
      // 快照最后删除，失败时保留 pending，可重启后继续清理附件和诊断。
      if (archivedOnly) {
        session.deletionState = "pending";
        session.revision += 1;
        await save(session);
      }
      workflowHost.stopSession(session.id);
      rejectAdmissions(session.id, new Error("ACP session removed before admission"));
      active.delete(session.id);
      activeTokens.delete(session.id);
      detach(session.id);
      await options.delegation?.onStop(session);
      for (const [key, id] of created) if (id === session.id) created.delete(key);
      await streamingWrites.get(session.id);
      await writes.get(session.id);
      await diagnosticWrites.get(session.id);
      await Promise.allSettled(attachmentWrites.get(session.id) ?? []);
      await attachmentStore.remove(session.id);
      await rm(diagnosticFile(session.id), { force: true });
      await rm(file(session.id), { force: true });
      removed.add(session.id);
      stopping.delete(session.id);
      sessions.delete(session.id);
      streamingWrites.delete(session.id);
      scheduledSnapshotRevisions.delete(session.id);
      streamDiagnostics.remove(session.id);
      emitter.fire({
        kind: "removed",
        id: session.id,
        workspaceKey: workspaceKey(session),
        workspacePath: session.workspacePath,
        ...(session.remoteSessionId ? { remoteSessionId: session.remoteSessionId } : {}),
      });
      return true;
    });
  };

  const service: IAcpService & { disposeAll(): void; disposeAllAndWait(): Promise<void> } = {
    generateText: (input) => textGeneration.generate(input),
    cancelGenerateText: (input) => textGeneration.cancel(input),
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
    async updateAgent(input) {
      const parsed = acpAgentUpdateSchema.parse(input);
      if (parsed.defaultModel && !ACP_AGENT_MODEL_ENV[parsed.agent]) {
        const models = await service.listAgentModels({ agent: parsed.agent });
        if (!models.some((model) => model.slug === parsed.defaultModel))
          throw new Error("默认模型不在已知 ACP 模型列表中，请先连接智能体后刷新列表。");
      }
      return agentManager.updateAgent(parsed);
    },
    readCodexConfig: () => agentManager.readCodexConfig(),
    updateCodexConfig: (input) => agentManager.updateCodexConfig(input),
    listCodexModels: () => agentManager.listCodexModels(),
    async listAgentModels(input) {
      if (disposed) throw new Error("ACP service closed");
      const { agent } = acpAgentModelsInputSchema.parse(input);
      const configs = await readAcpAgentConfigs(directory, undefined, sessions, removed);
      return projectAcpAgentModels(configs.find((item) => item.agent === agent));
    },
    manageAgent: (input) => agentManager.manageAgent(input),
    readAgentManagement: async () => agentManager.readAgentManagement(),
    cancelAgentOperation: async (input) => agentManager.cancelAgentOperation(input),
    onDynamicAgentManagement: () => agentManager.onAgentManagement,
    onDynamicAgentOperation(operationId) {
      return (listener) =>
        agentManager.onAgentOperation((event) => {
          if (event.operationId === operationId) listener(event);
        });
    },
    async list(workspace) {
      return (await listScopedSessions(workspace)).map((value) => structuredClone(value));
    },
    async listSummaries(workspace) {
      return (await listVisibleSessions(workspace)).map((value) =>
        structuredClone(summarizeAcpSession(value)),
      );
    },
    onDynamicSessionSummaryChanged(workspace) {
      return (listener) =>
        service.onDynamicSessionChanged(workspace)((change) => {
          if (change.kind === "removed") {
            listener(change);
            return;
          }
          const delegatedSessionIds = options.delegatedSessionIds;
          if (!delegatedSessionIds) {
            listener({
              kind: "updated",
              session:
                projections.get(change.session.id)?.session ?? summarizeAcpSession(change.session),
            });
            return;
          }
          // 修复原因：新增会话的 Host 事件可能早于委派绑定写回，历史资格与持久归属
          // 都确认后才向普通列表发布；归属读取失败时宁可保留旧投影。
          if (!isAcpHistorySession(change.session)) return;
          void (async () => {
            const hidden = await delegatedSessionIds(workspace);
            if (hidden.includes(change.session.id)) return;
            listener({
              kind: "updated",
              session:
                projections.get(change.session.id)?.session ?? summarizeAcpSession(change.session),
            });
          })().catch((error: unknown) =>
            logger.warn(undefined, "ACP child membership unavailable", { error }),
          );
        });
    },
    async readConversation(input) {
      const params = acpConversationReadSchema.parse(input);
      const value = await readProjection(params);
      return value.projection
        .frame(params.subscriptionId, params.recovery ? "recovery" : "initial")
        .map((wire) => ({ session: value.session, wire }));
    },
    async conversationRowsRange(input) {
      const params = acpConversationRowsRangeSchema.parse(input);
      return (await readProjection(params)).projection.rowsRange(params.beforeRowId, params.limit);
    },
    onDynamicConversationChanged(input) {
      const params = acpConversationTargetSchema.parse(input);
      return (listener) => {
        const cached = projections.get(params.id) ?? { users: 0, fromSeq: 0, deltas: [] };
        cached.users++;
        projections.set(params.id, cached);
        const subscription = service.onDynamicSessionChanged(params)((change) => {
          if (change.kind !== "updated" || change.session.id !== params.id) return;
          const value = project(change.session);
          const update = value.deltas.length
            ? { fromSeq: value.fromSeq, deltas: value.deltas }
            : undefined;
          for (const wire of value.projection.frame(params.subscriptionId, "online", update))
            listener({
              session: value.session,
              wire,
              ...(change.streamDiagnostics ? { streamDiagnostics: change.streamDiagnostics } : {}),
            });
        });
        return {
          dispose() {
            subscription.dispose();
            if (--cached.users === 0 && projections.get(params.id) === cached)
              projections.delete(params.id);
          },
        };
      };
    },
    async listArchivedWorkspaces() {
      const scopes = new Map<string, { scope: AcpWorkspace; sessionIds: string[] }>();
      for (const session of await listAllSessions()) {
        if (!session.archived) continue;
        const key = JSON.stringify([workspaceKey(session), session.workspacePath]);
        const group = scopes.get(key) ?? {
          scope: {
            workspacePath: session.workspacePath,
            ...(session.workspaceIdentity ? { workspaceIdentity: session.workspaceIdentity } : {}),
          },
          sessionIds: [],
        };
        group.sessionIds.push(session.id);
        scopes.set(key, group);
      }
      const visible = await Promise.all(
        [...scopes.values()].map(async ({ scope, sessionIds }) => {
          const hidden = new Set((await options.delegatedSessionIds?.(scope)) ?? []);
          return sessionIds.some((id) => !hidden.has(id)) ? scope : null;
        }),
      );
      return visible.filter((scope): scope is AcpWorkspace => scope !== null);
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
      return searchAcpSessions(await listVisibleSessions(query), query);
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
      // 修复依据：撤回编辑要先取得冻结副本；只扩大到同会话的已接受队列，不允许任意 ref。
      const attachment = [
        ...session.entries.flatMap((entry) =>
          entry.kind === "user" ? (entry.attachments ?? []) : [],
        ),
        ...session.queue.items.flatMap((item) => item.attachments),
      ].find((item) => item.ref === params.ref);
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
      return queueGate.run(session.id, async () => {
        if (session.deletionState) throw new Error("conversation deletion pending; retry deletion");
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
        } else if (
          session.unreadAt !== null &&
          (action.expectedUnreadAt === undefined || action.expectedUnreadAt === session.unreadAt)
        ) {
          await mutate(session, () => {
            session.unreadAt = null;
          });
        }
        // 修复原因：ACP id 不能交给原生 task service；列表状态必须在目标 Host
        // 的快照写入后发布，远端重连才能通过同一 revision 恢复置顶和未读。
        return structuredClone(session);
      });
    },
    async refresh(input) {
      const session = await scoped(input);
      ensureOpen(session);
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
      const {
        agent,
        requestId,
        deferPersistence,
        usePermissionPreference,
        useModelPreference,
        ...target
      } = acpCreateInputSchema.parse(input);
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
          pendingElicitation: null,
          error: null,
        };
        try {
          // 空草稿不落会话历史，但显式权限偏好由 Host 独立持久化；内部 create 不继承它。
          if (usePermissionPreference)
            session.permissionSelection = await permissionPreferences.read(target, agent);
          if (useModelPreference && options.composerPreferenceService) {
            const preference = await options.composerPreferenceService.get(target);
            initialModelPreferences.set(id, preference.acpModels[agent]);
          }
          const port = await attach(session).finally(() => initialModelPreferences.delete(id));
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
      // 接受耗时与 Agent 整轮耗时分开；只在发送时计量快照，流式分片不新增日志。
      const timing = new PhaseTimer(
        {
          scope: "acp.send",
          sessionId: input.id,
          commandId: input.commandId,
          commandType: "sendText",
        },
        (record) => logger.info(undefined, "[latency]", record),
      );
      timing.setFacts({
        textChars: input.text?.length ?? 0,
        attachments: input.attachments?.length ?? 0,
      });
      timing.phase("input_validate");
      // 关闭可先终结接受等待，附件复制仍由原 gate 收尾；不等待未接受 IO 才释放输入框。
      const receipt = new Promise<AcpSession>((resolve, reject) => {
        void dispatchPrompt(
          input,
          (admission) => {
            void admission.then(resolve, reject);
          },
          timing,
        ).then((receipt) => {
          if (receipt.snapshot) resolve(receipt.snapshot);
        }, reject);
      });
      return receipt.then(
        (snapshot) => {
          timing.finish(
            snapshot.queue.items.some((item) => item.commandId === input.commandId)
              ? "queued"
              : "accepted",
          );
          return snapshot;
        },
        (error: unknown) => {
          timing.finish("failed");
          throw error;
        },
      );
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
        // 撤回读取附件期间其他端可能编辑正文；在同一 gate 内比较内容，不能误删新版本。
        if (
          parsed.expectedItem &&
          JSON.stringify(acpQueueItemSchema.parse(item)) !== JSON.stringify(parsed.expectedItem)
        )
          throw new Error("ACP queue item changed before withdrawal");
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
      ensureOpen(session);
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
      ensureOpen(session);
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
        if (
          input.rememberModel &&
          options.composerPreferenceService &&
          option?.type === "select" &&
          (option.category === "model" || option.id === "model") &&
          typeof input.value === "string"
        ) {
          // 修复原因：ACP 模型只存在会话内，新任务和手机无法继承；Agent 确认成功后才记录共享偏好。
          if (
            session.configOptions.find((item) => item.id === option.id)?.currentValue !==
            input.value
          )
            throw new Error("ACP Agent did not apply the selected model");
          await options.composerPreferenceService.update({
            workspacePath: session.workspacePath,
            workspaceIdentity: session.workspaceIdentity,
            commandId: randomUUID(),
            acpModel: { agent: session.agent, configId: option.id, value: input.value },
          });
        }
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
      const requestTrace = interactionQueues.get(session.id)?.[0]?.trace ?? {};
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
      const queue = interactionQueues.get(session.id);
      if (queue?.[0]?.request.requestId === input.requestId) {
        queue.shift();
        if (!queue.length) interactionQueues.delete(session.id);
        else
          queueMicrotask(() => {
            void showNextInteraction(session);
          });
      }
      decision.resolve(input.optionId);
    },
    async respondElicitation(input) {
      const response = acpElicitationResponseSchema.parse(
        input.action === "accept"
          ? { action: input.action, content: input.content }
          : { action: input.action },
      );
      const session = await scoped(input);
      const decision = pending.get(session.id);
      const request = session.pendingElicitation;
      if (
        !decision ||
        decision.responding ||
        !request ||
        decision.requestId !== input.requestId ||
        request.requestId !== input.requestId ||
        !active.has(session.id) ||
        stopping.has(session.id)
      )
        throw new Error("ACP elicitation expired");
      if (
        response.action === "accept" &&
        !validateAcpElicitationContent(request.fields, response.content)
      )
        throw new Error("Invalid ACP elicitation answer");
      // 修复原因：多个端可同时回答；先认领同一 request，清除快照后复核 live 等待对象。
      decision.responding = true;
      try {
        await mutate(session, () => {
          session.pendingElicitation = null;
        });
        await appendDiagnostic(session, {
          kind: "elicitation-resolved",
          ...(interactionQueues.get(session.id)?.[0]?.trace ?? {}),
        });
        if (
          pending.get(session.id) !== decision ||
          !active.has(session.id) ||
          stopping.has(session.id)
        )
          throw new Error("ACP elicitation expired");
        pending.delete(session.id);
        const queue = interactionQueues.get(session.id);
        if (queue?.[0]?.request.requestId === input.requestId) {
          queue.shift();
          if (!queue.length) interactionQueues.delete(session.id);
          else void showNextInteraction(session);
        }
        decision.resolve(response);
      } catch (error) {
        if (pending.get(session.id) === decision) {
          decision.responding = false;
          await mutate(session, () => {
            session.pendingElicitation = request;
          });
        }
        throw error;
      }
    },
    remove: (input) => removeSession(input, false).then(() => {}),
    removeArchived: (input) => removeSession(input, true),
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
      compactionTiming.dispose();
      disposed = true;
      streamDiagnostics.clear();
      projections.clear();
      textGeneration.dispose();
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
      for (const id of pending.keys()) settleInteractions(id);
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
      await textGeneration.settle();
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
