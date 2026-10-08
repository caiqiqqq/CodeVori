import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { PRODUCT_NAME, acpAgentDefinition } from "@zcode/shared";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type Implementation,
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

const START_TIMEOUT_MS = 20_000;
const MAX_INITIAL_USAGE_SESSIONS = 16;

/** Only native-session restore failures may trigger empty-session replacement in the Host. */
export class AcpSessionLoadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "AcpSessionLoadError";
  }
}

export const connectAcpAgent: AcpConnectionFactory = async (input) => {
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
  let exitReason = "ACP Agent 已退出";
  const closedPromise = new Promise<void>((resolve) => child.once("close", () => resolve()));
  const exited = new Promise<never>((_, reject) => {
    child.once("error", (error) => {
      exitReason = error.message;
      reject(error);
    });
    child.once("exit", (code, signal) => {
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
  let receivingInitialUsage = false;
  const initialUsageBySession = new Map<string, AcpUpdate & { kind: "context_usage" }>();
  const client: Client = {
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
      if (update.sessionUpdate === "config_option_update") {
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
        mapped = {
          kind: "tool",
          id: update.toolCallId,
          ...(update.title ? { title: update.title } : {}),
          ...(update.status ? { status: update.status } : {}),
          ...projectAcpToolDetails(update),
        };
      }
      if (mapped) await input.onUpdate(mapped);
    },
    async requestPermission(request) {
      if (!receivingLiveUpdates || request.sessionId !== sessionId) {
        return { outcome: { outcome: "cancelled" } };
      }
      // 部分适配器只在授权请求中给出工具信息；先交给同一 Host owner，避免丢失参数和关联行。
      await input.onUpdate({
        kind: "tool",
        id: request.toolCall.toolCallId,
        ...(request.toolCall.title ? { title: request.toolCall.title } : {}),
        ...(request.toolCall.status ? { status: request.toolCall.status } : {}),
        ...projectAcpToolDetails(request.toolCall),
      });
      const optionId = await input.onPermission({
        requestId: randomUUID(),
        toolCallId: request.toolCall.toolCallId,
        title: request.toolCall.title ?? request.toolCall.toolCallId,
        options: request.options.map(({ optionId, name, kind }) => ({ optionId, name, kind })),
      });
      return { outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" } };
    },
  };
  const connection = new ClientSideConnection(
    () => client,
    ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
  );
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
        const initialized = await connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { session: { configOptions: { boolean: {} } } },
          clientInfo: { name: PRODUCT_NAME, version: "3.14.0" },
        });
        if (initialized.protocolVersion !== PROTOCOL_VERSION) {
          throw new Error(`不支持的 ACP 协议版本: ${initialized.protocolVersion}`);
        }
        agentInfo = initialized.agentInfo;
        promptCapabilities = initialized.agentCapabilities?.promptCapabilities;
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
          if (!initialized.agentCapabilities?.loadSession) {
            // 修复原因：升级后的适配器可能不再声明 loadSession；空会话仍可安全接替，
            // 有聊天内容时 Host 会保留历史并报告原错误。
            throw new AcpSessionLoadError(new Error("此 ACP Agent 不支持恢复会话，请创建新会话"));
          }
          let loaded;
          try {
            loaded = await connection.loadSession({
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
          const created = await connection.newSession({ cwd: input.workspacePath, mcpServers });
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
    let lastStopReason: AcpConnectionPort["lastStopReason"];
    const readNativeUsage = () =>
      input.agent === "codex" && agentInfo?.name === "@agentclientprotocol/codex-acp"
        ? readCodexNativeUsage({
            sessionId: activeSessionId,
            workspacePath: input.workspacePath,
            env: launch.env,
          })
        : Promise.resolve(null);
    let nativeUsage = await readNativeUsage();
    return {
      sessionId: activeSessionId,
      closed: closedPromise,
      promptCapabilities,
      provisionedMcpNames,
      configOptions,
      modeState,
      get nativeUsage() {
        return nativeUsage;
      },
      get lastStopReason() {
        return lastStopReason;
      },
      ...(initialUsage ? { contextUsage: initialUsage.usage } : {}),
      async setConfigOption(configId, value) {
        const result = await connection.setSessionConfigOption({
          sessionId: activeSessionId,
          configId,
          ...(typeof value === "boolean" ? { type: "boolean" as const, value } : { value }),
        });
        return projectAcpConfigOptions(result.configOptions);
      },
      async setMode(modeId) {
        await connection.setSessionMode({ sessionId: activeSessionId, modeId });
      },
      async prompt(text, blocks) {
        const response = await connection.prompt({
          sessionId: activeSessionId,
          prompt: blocks ?? [{ type: "text", text }],
        });
        lastStopReason = response.stopReason;
        nativeUsage = await readNativeUsage();
        return projectAcpPromptUsage(input.agent, agentInfo, response);
      },
      async cancel() {
        await connection.cancel({ sessionId: activeSessionId });
      },
      close,
    };
  } catch (error) {
    close();
    throw error;
  } finally {
    if (startTimer) clearTimeout(startTimer);
  }
};
