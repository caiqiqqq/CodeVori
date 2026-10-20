import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acpGenerateTextSchema,
  acpCancelGenerateTextSchema,
  acpGeneratedTextSchema,
  resolveWorkspaceKey,
  type AcpGenerateText,
  type AcpCancelGenerateText,
  type AcpSession,
} from "@zcode/shared";
import type { AcpConnectionFactory, AcpConnectionPort } from "./acpServiceImpl.js";
import type { AcpAgentManager } from "./acpAgentManager.js";
import { acpConfigValues } from "./acpConfigOptions.js";
import { acpTextSource, acpTextConfigFingerprint } from "./acpTextSource.js";
import { generateCodexText } from "./acpCodexText.js";

/** ACP Host 的辅助运行所有者；不注册 session、workflow、delegation 或消息队列。 */
export class AcpTextGeneration {
  private closed = false;
  private readonly pending = new Map<
    string,
    {
      input: AcpGenerateText;
      abort: AbortController;
      finished: Promise<unknown>;
    }
  >();
  constructor(
    private readonly deps: {
      read(input: AcpGenerateText): Promise<AcpSession>;
      connect: AcpConnectionFactory;
      manager: AcpAgentManager;
      customConnect?: boolean;
      codex?: typeof generateCodexText;
    },
  ) {}

  generate(input: AcpGenerateText) {
    input = acpGenerateTextSchema.parse(input);
    if (this.closed) throw new Error("work-task.result-canceled");
    if (input.workspaceIdentity || input.remoteSessionId)
      throw new Error("work-task.remote-unsupported");
    if (
      this.pending.has(input.requestId) ||
      [...this.pending.values()].some(
        (run) =>
          run.input.id === input.id &&
          resolveWorkspaceKey(run.input) === resolveWorkspaceKey(input),
      )
    )
      throw new Error("work-task.result-busy");
    const abort = new AbortController();
    const finished = this.run(input, abort.signal)
      .catch((error: unknown) => {
        if (abort.signal.aborted) throw new Error("work-task.result-canceled");
        if (error instanceof Error && error.message.startsWith("work-task.")) throw error;
        // 原生配置/认证异常不能把文件内容或凭据片段带入 RPC 错误。
        throw new Error("work-task.result-generation-failed");
      })
      .finally(() => this.pending.delete(input.requestId));
    this.pending.set(input.requestId, { input, abort, finished });
    return finished;
  }
  async cancel(input: AcpCancelGenerateText) {
    input = acpCancelGenerateTextSchema.parse(input);
    if (input.workspaceIdentity || input.remoteSessionId)
      throw new Error("work-task.remote-unsupported");
    const run = this.pending.get(input.requestId);
    if (
      run &&
      run.input.id === input.id &&
      resolveWorkspaceKey(run.input) === resolveWorkspaceKey(input)
    )
      run.abort.abort();
  }
  dispose() {
    this.closed = true;
    for (const run of this.pending.values()) run.abort.abort();
  }
  async settle() {
    await Promise.allSettled([...this.pending.values()].map((run) => run.finished));
  }

  private async run(input: AcpGenerateText, signal: AbortSignal) {
    const session = await this.deps.read(input);
    if (
      session.id !== input.id ||
      resolveWorkspaceKey(session) !== resolveWorkspaceKey(input) ||
      session.workspaceIdentity ||
      session.remoteSessionId ||
      session.pendingPermission ||
      session.revision !== input.expectedRevision ||
      session.status !== "idle" ||
      session.queue.items.length ||
      session.provisional ||
      session.supersededBy
    )
      throw new Error("work-task.result-source-changed");
    const source = acpTextSource(session);
    const fingerprint = acpTextConfigFingerprint(session);
    if (signal.aborted) throw new Error("work-task.result-canceled");
    const launch = this.deps.customConnect
      ? undefined
      : await this.deps.manager.resolveLaunch(session.agent);
    if (signal.aborted) throw new Error("work-task.result-canceled");
    const directory = await mkdtemp(join(tmpdir(), "zcode-text-"));
    let port: AcpConnectionPort | undefined;
    const stop = () => {
      // 只取消辅助连接；不得触碰原会话的 active run、权限或待办状态。
      if (port) {
        void port.cancel().catch(() => {});
        port.close();
      }
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      let text = "";
      if (session.agent === "codex") {
        if (!launch) throw new Error("work-task.result-agent-unsupported");
        text = await (this.deps.codex ?? generateCodexText)({
          session,
          launch,
          directory,
          prompt: input.prompt,
          signal,
          codexHome: await this.deps.manager.resolveCodexHome?.(),
        });
      } else {
        let failed = false;
        port = await this.deps.connect({
          agent: session.agent,
          workspacePath: directory,
          launch,
          textOnly: true,
          onUpdate: async (update) => {
            if (signal.aborted) return;
            if (update.kind === "text") {
              text += update.text;
              if (text.length > 12_000) {
                failed = true;
                stop();
              }
            } else if (
              update.kind === "tool" ||
              update.kind === "terminal" ||
              update.kind === "failure"
            ) {
              failed = true;
              stop();
            }
          },
          onPermission: async () => null,
          onExit: () => {
            failed = true;
          },
        });
        // 取消可能先于握手完成；迟到连接同样属于本请求，必须关闭且不能发送 prompt。
        if (signal.aborted) {
          stop();
          throw new Error("work-task.result-canceled");
        }
        if (failed) throw new Error("work-task.result-generation-failed");
        for (const option of session.configOptions.filter(
          (option) =>
            option.category === "model" ||
            option.category === "thought_level" ||
            ["model", "reasoning_effort", "thinking", "effort"].includes(option.id),
        )) {
          const target = port.configOptions.find((item) => item.id === option.id);
          if (
            !target ||
            target.type !== option.type ||
            (target.type === "select" &&
              !acpConfigValues(target).includes(String(option.currentValue)))
          )
            throw new Error("work-task.result-model-unavailable");
          if (target.currentValue !== option.currentValue) {
            const options = await port.setConfigOption(option.id, option.currentValue);
            port.configOptions = options;
            if (options.find((item) => item.id === option.id)?.currentValue !== option.currentValue)
              throw new Error("work-task.result-model-unavailable");
          }
          if (signal.aborted) throw new Error("work-task.result-canceled");
        }
        await port.prompt(input.prompt);
        if (failed || (port.lastStopReason && port.lastStopReason !== "end_turn"))
          throw new Error("work-task.result-generation-failed");
      }
      if (signal.aborted) throw new Error("work-task.result-canceled");
      const current = await this.deps.read(input);
      if (current.status !== "idle" || acpTextConfigFingerprint(current) !== fingerprint)
        throw new Error("work-task.result-source-changed");
      const result = acpGeneratedTextSchema.safeParse({ text, source });
      if (!result.success) throw new Error("work-task.result-invalid-output");
      return result.data;
    } finally {
      signal.removeEventListener("abort", stop);
      port?.close();
      try {
        await port?.closed;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}
