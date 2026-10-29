import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { PRODUCT_NAME, acpAgentDefinition } from "@zcode/shared";
import {
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type Implementation,
  type ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import {
  shouldSpawnInDetachedProcessGroup,
  terminateProcessTree,
} from "../process/processTreeTerminator.js";
import type { AcpConnectionFactory, AcpConnectionPort, AcpUpdate } from "./acpServiceImpl.js";
import { projectAcpConfigOptions, projectAcpModeState } from "./acpConfigOptions.js";
import { readCodexNativeUsage } from "./acpNativeUsage.js";
import { projectAcpPromptUsage } from "./acpUsageResponse.js";
import { projectAcpContextUsage } from "./acpContextUsage.js";
import { projectAcpMcpServers, projectAcpPluginMcpServers } from "./acpMcpServers.js";
import { projectAcpToolDetails } from "./acpToolDetails.js";
import { projectLegacyCompaction, projectTypedCompaction } from "./acpCompaction.js";
import { AcpSessionLoadError, projectAcpSessionFailure } from "./acpSessionFailures.js";
import { AcpTerminals } from "./acpTerminals.js";
import { connectAcpClientTransport } from "./acpClientTransport.js";
import { OperationDiagnostics } from "@zcode/rpc";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { acpTextConnectionPolicy } from "./acpTextConnectionPolicy.js";
import { AcpPromptLifecycle } from "./acpPromptLifecycle.js";

const diagnosticLogger = createServiceLogger("acp-connection");
const diagnostics = new OperationDiagnostics(
  (record) => diagnosticLogger.info(undefined, "[diagnostics]", record),
  { scope: "acp-connection" },
);

const START_TIMEOUT_MS = 20_000;
const MAX_INITIAL_USAGE_SESSIONS = 16;

export { AcpSessionLoadError } from "./acpSessionFailures.js";

export const connectAcpAgent: AcpConnectionFactory = (input) =>
  diagnostics.run(`acp.connect.${input.agent}`, (timing) => connectWithDiagnostics(input, timing));

async function connectWithDiagnostics(
  input: Parameters<AcpConnectionFactory>[0],
  timing: Pick<ReturnType<OperationDiagnostics["start"]>, "phase">,
): Promise<AcpConnectionPort> {
  const textPolicy = acpTextConnectionPolicy(input);
  timing.phase("spawn");
  const launch = input.launch ?? {
    command: acpAgentDefinition(input.agent).command,
    args: [...acpAgentDefinition(input.agent).args],
    env: process.env,
  };
  const child = spawn(launch.command, launch.args, {
    cwd: input.workspacePath,
    env: launch.env,
    shell: launch.shell,
    stdio: ["pipe", "pipe", "pipe"],
    detached: shouldSpawnInDetachedProcessGroup(),
    windowsHide: true,
  });
  let closed = false;
  const terminals = new AcpTerminals(input.workspacePath, launch.env, (terminal) =>
    input.onUpdate({ kind: "terminal", terminal }),
  );
  let terminalsClosed: Promise<void> = Promise.resolve();
  let exitReason = "ACP Agent 已退出";
  const closedPromise = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const exited = new Promise<never>((_, reject) => {
    child.once("error", (error) => {
      exitReason = error.message;
      reject(error);
    });
    child.once("exit", (code, signal) => {
      diagnostics.event(`acp.exit.${input.agent}.${signal ?? "exit"}`, {
        pid: child.pid ?? null,
        exitCode: code,
        requested: closed,
        signaled: signal !== null,
      });
      exitReason = `ACP Agent 已退出 (${signal ?? code ?? "unknown"})`;
      reject(new Error(exitReason));
    });
  });
  // Adapter stderr may contain private paths or credentials; keep it out of snapshots/logs.
  child.stderr.resume();
  child.once("exit", () => {
    if (!closed) input.onExit(exitReason);
  });

  const close = () => {
    if (closed) return;
    closed = true;
    terminalsClosed = terminals.dispose();
    // close 为非等待接口；closed Promise 保留清理结果，避免无人等待时 rejection。
    void terminalsClosed.catch(() => {});
    terminateProcessTree(
      child,
      process.platform !== "win32" && child.pid ? { ownedProcessGroupId: child.pid } : {},
    );
  };

  let sessionId = input.sessionId;
  let agentInfo: Implementation | null | undefined;
  let promptCapabilities: AcpConnectionPort["promptCapabilities"];
  const provisionedMcpNames = new Set<string>();
  let configOptions: AcpConnectionPort["configOptions"] = [];
  let modeState: AcpConnectionPort["modeState"] = null;
  let receivingLiveUpdates = false;
  const promptLifecycle = new AcpPromptLifecycle(input.onUpdate);
  const compactionIds = new Set<string>();
  let receivingInitialUsage = false;
  const initialUsageBySession = new Map<string, AcpUpdate & { kind: "context_usage" }>();
  const projectToolUpdate = (update: ToolCallUpdate): AcpUpdate => {
    const compaction = projectLegacyCompaction(update, compactionIds.has(update.toolCallId));
    if (compaction) compactionIds.add(update.toolCallId);
    return (
      compaction ?? {
        kind: "tool",
        id: update.toolCallId,
        ...(update.title ? { title: update.title } : {}),
        ...(update.status ? { status: update.status } : {}),
        ...projectAcpToolDetails(update),
      }
    );
  };
  const client: Client = {
    async createTerminal(request) {
      if (input.textOnly) throw new Error("Auxiliary generation has no terminal capability");
      if (closed || !promptLifecycle.accepting || request.sessionId !== sessionId)
        throw new Error("ACP terminal session is not active");
      return terminals.create(request);
    },
    terminalOutput(request) {
      if (closed || request.sessionId !== sessionId)
        throw new Error("ACP terminal session mismatch");
      return terminals.output(request.terminalId);
    },
    waitForTerminalExit(request) {
      if (closed || request.sessionId !== sessionId)
        throw new Error("ACP terminal session mismatch");
      return terminals.wait(request.terminalId);
    },
    killTerminal(request) {
      if (closed || request.sessionId !== sessionId)
        throw new Error("ACP terminal session mismatch");
      return terminals.kill(request.terminalId);
    },
    releaseTerminal(request) {
      if (closed || request.sessionId !== sessionId)
        throw new Error("ACP terminal session mismatch");
      return terminals.release(request.terminalId);
    },
    async sessionUpdate(notification) {
      const update = notification.update;
      if (!receivingLiveUpdates) {
        // 修复原因：恢复回放的消息不能重复追加，但容量元数据不是历史消息。
        // session/new 的 ID 此时未知；只暂存有界元数据，成功后按真实 ID 合并。
        if (
          receivingInitialUsage &&
          update.sessionUpdate === "usage_update" &&
          (!sessionId || notification.sessionId === sessionId)
        ) {
          initialUsageBySession.delete(notification.sessionId);
          initialUsageBySession.set(notification.sessionId, {
            kind: "context_usage",
            usage: projectAcpContextUsage(update),
          });
          if (initialUsageBySession.size > MAX_INITIAL_USAGE_SESSIONS) {
            const oldest = initialUsageBySession.keys().next().value;
            if (oldest !== undefined) initialUsageBySession.delete(oldest);
          }
        }
        return;
      }
      // session/load may replay history. The Host already owns the displayed transcript.
      if (notification.sessionId !== sessionId) return;
      let mapped: AcpUpdate | undefined;
      if (update.sessionUpdate === "session_info_update") {
        const failure = projectAcpSessionFailure(update._meta);
        if (failure) mapped = { kind: "failure", failure };
      } else if (update.sessionUpdate === "config_option_update") {
        mapped = { kind: "config", configOptions: projectAcpConfigOptions(update.configOptions) };
      } else if (update.sessionUpdate === "current_mode_update") {
        mapped = { kind: "mode", modeId: update.currentModeId };
      } else if (update.sessionUpdate === "usage_update") {
        // 修复原因：usage_update 是 Agent 的上下文窗口占用，并非 prompt 消耗报告。
        // 无效或未知值清空旧容量，让共享圆环显示未知，避免误导性的 0% 和旧会话值。
        mapped = {
          kind: "context_usage",
          usage: projectAcpContextUsage(update),
        };
      } else if (update.sessionUpdate === "compaction_update") {
        compactionIds.add(update.compactionId);
        mapped = projectTypedCompaction(update);
      } else if (update.sessionUpdate === "compaction_summary_chunk") {
        if (update.content.type === "text")
          mapped = {
            kind: "compaction_summary",
            id: update.compactionId,
            text: update.content.text.slice(0, 32_000),
          };
      } else if (update.sessionUpdate === "plan") {
        mapped = {
          kind: "plan",
          entries: update.entries.map(({ content, priority, status }) => ({
            content,
            priority,
            status,
          })),
        };
      } else if (
        (update.sessionUpdate === "agent_message_chunk" ||
          update.sessionUpdate === "agent_thought_chunk") &&
        update.content.type === "text"
      ) {
        mapped = {
          kind: update.sessionUpdate === "agent_thought_chunk" ? "thought" : "text",
          text: update.content.text,
          messageId: update.messageId ?? undefined,
        };
      } else if (
        update.sessionUpdate === "tool_call" ||
        update.sessionUpdate === "tool_call_update"
      ) {
        mapped = projectToolUpdate(update);
      }
      if (mapped) await promptLifecycle.update(mapped);
    },
    async requestPermission(request) {
      if (input.textOnly || !receivingLiveUpdates || request.sessionId !== sessionId) {
        return { outcome: { outcome: "cancelled" } };
      }
      // 部分适配器只在授权请求中给出工具信息；先交给同一 Host owner，避免丢失参数和关联行。
      const optionId = await promptLifecycle.authorize(projectToolUpdate(request.toolCall), () =>
        input.onPermission({
          requestId: randomUUID(),
          toolCallId: request.toolCall.toolCallId,
          title: request.toolCall.title ?? request.toolCall.toolCallId,
          options: request.options.map(({ optionId, name, kind }) => ({ optionId, name, kind })),
        }),
      );
      return { outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" } };
    },
  };
  const transport = connectAcpClientTransport({
    client,
    isActiveSession: (id) => !closed && receivingLiveUpdates && id === sessionId,
    onElicitation: input.onElicitation,
    stream: ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
  });
  const connection = transport.agent;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    startTimer = setTimeout(() => reject(new Error("ACP Agent 启动超时")), START_TIMEOUT_MS);
    startTimer.unref();
  });
  try {
    await Promise.race([
      exited,
      timeout,
      (async () => {
        timing.phase("initialize");
        const initialized = await connection.request("initialize", {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            terminal: textPolicy.terminal,
            ...(input.onElicitation ? { elicitation: { form: {} } } : {}),
            session: { compaction: {}, configOptions: { boolean: {} } },
            _meta: { jetbrains: { air: { version: 1, capabilities: ["sessionFailure"] } } },
          },
          clientInfo: { name: PRODUCT_NAME, version: "3.14.0" },
        });
        if (initialized.protocolVersion !== PROTOCOL_VERSION) {
          throw new Error(`不支持的 ACP 协议版本: ${initialized.protocolVersion}`);
        }
        agentInfo = initialized.agentInfo;
        promptCapabilities = initialized.agentCapabilities?.promptCapabilities;
        timing.phase("mcp-projection");
        const mcpServers = await projectAcpMcpServers(
          input.mcpServers ?? [],
          initialized.agentCapabilities?.mcpCapabilities,
          input.workspacePath,
          launch.env,
        );
        // 修复原因：工作流工具是目标 Host 的会话能力，不属于用户可编辑的普通 MCP 配置。
        // 独立接线避免普通配置的禁用与同名条目遮蔽执行器。
        const workflowServers = await projectAcpMcpServers(
          input.workflowServers ?? [],
          initialized.agentCapabilities?.mcpCapabilities,
          input.workspacePath,
          launch.env,
        );
        for (const workflow of workflowServers) {
          if (mcpServers.some((server) => server.name === workflow.name))
            throw new Error(
              `MCP 名称 ${workflow.name} 已由 ${PRODUCT_NAME} 工作流占用，请重命名用户 MCP 配置`,
            );
        }
        mcpServers.push(...workflowServers);
        for (const server of workflowServers) provisionedMcpNames.add(server.name);
        // 修复原因：插件配置由 CLI loader 展开，普通设置仍需严格失败；单个插件的
        // OAuth/CUA/不支持的 transport 不应阻断其它 ACP 插件或普通 MCP 连接。
        const pluginServers = await projectAcpPluginMcpServers(
          input.pluginServers ?? [],
          initialized.agentCapabilities?.mcpCapabilities,
          input.workspacePath,
          launch.env,
          new Set(mcpServers.map((server) => server.name)),
        );
        mcpServers.push(...pluginServers);
        for (const server of pluginServers) provisionedMcpNames.add(server.name);
        receivingInitialUsage = true;
        if (sessionId) {
          timing.phase("session-load");
          if (!initialized.agentCapabilities?.loadSession) {
            // 修复原因：升级后的适配器可能不再声明 loadSession；空会话仍可安全接替，
            // 有聊天内容时 Host 会保留历史并报告原错误。
            throw new AcpSessionLoadError(new Error("此 ACP Agent 不支持恢复会话，请创建新会话"));
          }
          let loaded;
          try {
            loaded = await connection.request("session/load", {
              sessionId,
              cwd: input.workspacePath,
              mcpServers,
            });
          } catch (error) {
            // Bug 原因：旧原生 ID 失效与认证、启动失败可能都报 Internal error；
            // 仅给 session/load 的失败附加阶段信息，Host 才能安全决定是否接替空会话。
            throw new AcpSessionLoadError(error);
          }
          configOptions = projectAcpConfigOptions(loaded.configOptions);
          modeState = projectAcpModeState(loaded.modes);
        } else {
          timing.phase("session-new");
          const created = await connection.request("session/new", {
            cwd: input.workspacePath,
            mcpServers,
            ...textPolicy.sessionMeta,
          });
          sessionId = created.sessionId;
          configOptions = projectAcpConfigOptions(created.configOptions);
          modeState = projectAcpModeState(created.modes);
        }
      })(),
    ]);
    if (!sessionId) throw new Error("ACP Agent 未返回会话 ID");
    const initialUsage = initialUsageBySession.get(sessionId);
    initialUsageBySession.clear();
    receivingLiveUpdates = true;
    const activeSessionId = sessionId;
    const readNativeUsage = () =>
      input.agent === "codex" && agentInfo?.name === "@agentclientprotocol/codex-acp"
        ? readCodexNativeUsage({
            sessionId: activeSessionId,
            workspacePath: input.workspacePath,
            env: launch.env,
          })
        : Promise.resolve(null);
    timing.phase("native-usage");
    let nativeUsage = await readNativeUsage();
    return {
      sessionId: activeSessionId,
      closed: closedPromise.then(() => terminalsClosed),
      async stopTerminal(terminalId) {
        await terminals.kill(terminalId);
      },
      promptCapabilities,
      provisionedMcpNames,
      configOptions,
      modeState,
      get nativeUsage() {
        return nativeUsage;
      },
      get lastStopReason() {
        return promptLifecycle.lastStopReason;
      },
      ...(initialUsage ? { contextUsage: initialUsage.usage } : {}),
      async setConfigOption(configId, value) {
        const result = await connection.request("session/set_config_option", {
          sessionId: activeSessionId,
          configId,
          ...(typeof value === "boolean" ? { type: "boolean" as const, value } : { value }),
        });
        return projectAcpConfigOptions(result.configOptions);
      },
      async setMode(modeId) {
        await connection.request("session/set_mode", { sessionId: activeSessionId, modeId });
      },
      async prompt(text, blocks) {
        // 仅保留本轮 legacy 工具的路由身份；生命周期与终态仍由 Host 唯一持有。
        compactionIds.clear();
        const response = await promptLifecycle.run(() =>
          connection.request("session/prompt", {
            sessionId: activeSessionId,
            prompt: blocks ?? [{ type: "text", text }],
          }),
        );
        nativeUsage = await readNativeUsage();
        return projectAcpPromptUsage(input.agent, agentInfo, response);
      },
      async cancel() {
        promptLifecycle.cancel();
        await Promise.all([
          connection.notify("session/cancel", { sessionId: activeSessionId }),
          terminals.interrupt(),
        ]);
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  } finally {
    if (startTimer) clearTimeout(startTimer);
  }
}
