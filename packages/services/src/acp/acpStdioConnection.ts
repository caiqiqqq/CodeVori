import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { acpAgentDefinition } from "@zcode/shared";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type ToolCallContent,
  type Implementation,
} from "@agentclientprotocol/sdk";
import {
  shouldSpawnInDetachedProcessGroup,
  terminateProcessTree,
} from "../process/processTreeTerminator.js";
import type { AcpConnectionFactory, AcpConnectionPort, AcpUpdate } from "./acpServiceImpl.js";
import { projectAcpConfigOptions, projectAcpModeState } from "./acpConfigOptions.js";
import { projectAcpPromptUsage } from "./acpUsageResponse.js";
import { projectAcpMcpServers } from "./acpMcpServers.js";

const START_TIMEOUT_MS = 20_000;

/** Only native-session restore failures may trigger empty-session replacement in the Host. */
export class AcpSessionLoadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "AcpSessionLoadError";
  }
}

function contentText(content?: ToolCallContent[] | null): string | undefined {
  const text = content
    ?.filter((part) => part.type === "content" && part.content.type === "text")
    .map((part) =>
      part.type === "content" && part.content.type === "text" ? part.content.text : "",
    )
    .join("\n");
  return text || undefined;
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
  let configOptions: AcpConnectionPort["configOptions"] = [];
  let modeState: AcpConnectionPort["modeState"] = null;
  let receivingLiveUpdates = false;
  const client: Client = {
    async sessionUpdate(notification) {
      // session/load may replay history. The Host already owns the displayed transcript.
      if (!receivingLiveUpdates || notification.sessionId !== sessionId) return;
      const update = notification.update;
      let mapped: AcpUpdate | undefined;
      if (update.sessionUpdate === "config_option_update") {
        mapped = { kind: "config", configOptions: projectAcpConfigOptions(update.configOptions) };
      } else if (update.sessionUpdate === "current_mode_update") {
        mapped = { kind: "mode", modeId: update.currentModeId };
      } else if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        mapped = {
          kind: "text",
          text: update.content.text,
          messageId: update.messageId ?? undefined,
        };
      } else if (
        update.sessionUpdate === "tool_call" ||
        update.sessionUpdate === "tool_call_update"
      ) {
        const content = contentText(update.content);
        mapped = {
          kind: "tool",
          id: update.toolCallId,
          ...(update.title ? { title: update.title } : {}),
          ...(update.status ? { status: update.status } : {}),
          ...(content ? { content } : {}),
        };
      }
      if (mapped) await input.onUpdate(mapped);
    },
    async requestPermission(request) {
      if (!receivingLiveUpdates || request.sessionId !== sessionId) {
        return { outcome: { outcome: "cancelled" } };
      }
      const optionId = await input.onPermission({
        requestId: randomUUID(),
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
          clientInfo: { name: "ZCode", version: "3.14.0" },
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
    receivingLiveUpdates = true;
    const activeSessionId = sessionId;
    return {
      sessionId: activeSessionId,
      closed: closedPromise,
      promptCapabilities,
      configOptions,
      modeState,
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
