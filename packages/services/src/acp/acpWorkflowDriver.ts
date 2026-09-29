import {
  WorkflowError,
  refToString,
  type ActorRef,
  type AskMessage,
  type InstanceRef,
  type PersonaSpec,
  type SessionRef,
  type SubmitVerdict,
  type WorkflowDriver,
  type WorkflowReportSink,
  type JournalStorePort,
  type RunEvent,
} from "@zcode/dynamic-workflow";
import type {
  AcpAgent,
  AcpConfigOption,
  AcpModeState,
  AcpUsageReport,
  NativeMcpServerRecord,
} from "@zcode/shared";
import type { AcpConnectionFactory, AcpConnectionPort, AcpPermission } from "./acpServiceImpl.js";
import type { AcpWorkflowMcp } from "./acpWorkflowMcp.js";
import { createAcpWorkflowWorld } from "./acpWorkflowWorld.js";

type Actor = {
  port: AcpConnectionPort;
  revoke(): void;
  text: string;
  tools: number;
  current?: InstanceRef;
  persona: PersonaSpec;
  typed: boolean;
  pending?: (verdict: SubmitVerdict) => void;
};

/** ACP actor adapter. The dynamic-workflow engine remains the only scheduler and validator. */
export function createAcpWorkflowDriver(input: {
  runId: string;
  workspacePath: string;
  agent: AcpAgent;
  configOptions: AcpConfigOption[];
  modeState: AcpModeState | null;
  connect: AcpConnectionFactory;
  mcp: AcpWorkflowMcp;
  mcpServers: NativeMcpServerRecord[];
  pluginServers?: Parameters<AcpConnectionFactory>[0]["pluginServers"];
  launch?: Parameters<AcpConnectionFactory>[0]["launch"];
  journal: JournalStorePort & { flush(): Promise<void> };
  sink: WorkflowReportSink;
  signal: AbortSignal;
  commands: ReadonlySet<string>;
  permission(request: AcpPermission): Promise<string | null>;
  emit(event: RunEvent): void;
}): WorkflowDriver {
  const actors = new Map<string, Actor>();
  const world = createAcpWorkflowWorld({
    cwd: input.workspacePath,
    runId: input.runId,
    commands: input.commands,
    signal: input.signal,
  });

  const driver: WorkflowDriver = {
    journal: input.journal,
    emit: input.emit,
    async createActorSession(ref: ActorRef, persona: PersonaSpec): Promise<SessionRef> {
      const id = `${input.runId}:${refToString(ref)}`;
      if (actors.has(id)) return { id };
      await input.journal.flush();
      const actor: Actor = {
        port: null as unknown as AcpConnectionPort,
        text: "",
        tools: 0,
        typed: false,
        persona,
        revoke() {},
      };
      const registration = await input.mcp.register("zcode-workflow-result", {
        names: ["submit_result"],
        async call(name, args) {
          if (name !== "submit_result" || !actor.current || !actor.typed)
            return {
              kind: "reject",
              violations: [{ path: "$", expected: "active typed ask", got: "none" }],
            };
          if (actor.pending)
            return {
              kind: "reject",
              violations: [
                { path: "$", expected: "one result submission at a time", got: "pending" },
              ],
            };
          return new Promise<SubmitVerdict>((resolve) => {
            actor.pending = resolve;
            input.sink.askSubmitAttempted(actor.current!, args.result);
          });
        },
      });
      actor.revoke = registration.revoke;
      try {
        const port = await input.connect({
          agent: input.agent,
          workspacePath: input.workspacePath,
          mcpServers: input.mcpServers,
          workflowServers: [registration.record],
          ...(input.pluginServers ? { pluginServers: input.pluginServers } : {}),
          ...(input.launch ? { launch: input.launch } : {}),
          onUpdate: async (update) => {
            if (update.kind === "text") actor.text += update.text;
            if (update.kind === "tool") {
              actor.tools++;
              if (actor.current)
                input.sink.askProgress(actor.current, {
                  turn: 1,
                  toolCalls: actor.tools,
                  lastTool: { name: update.title?.slice(0, 64) ?? "ACP tool" },
                });
            }
          },
          onPermission: (request) =>
            input.signal.aborted ? Promise.resolve(null) : input.permission(request),
          onExit: (reason) => {
            if (actor.current)
              input.sink.askFailed(actor.current, new WorkflowError("DriverError", reason));
            actor.pending?.({
              kind: "reject",
              violations: [{ path: "$", expected: "live ACP actor", got: "closed" }],
            });
            actor.revoke();
          },
        });
        actor.port = port;
        // 修复原因：子任务的模型和模式由父 ACP 会话启动时的快照冻结，不能回退到适配器默认模型。
        for (const selected of input.configOptions) {
          const available = port.configOptions.find((option) => option.id === selected.id);
          if (available && available.currentValue !== selected.currentValue)
            await port.setConfigOption(selected.id, selected.currentValue);
        }
        if (input.modeState && port.modeState?.currentModeId !== input.modeState.currentModeId)
          await port.setMode(input.modeState.currentModeId);
        actors.set(id, actor);
        return { id };
      } catch (error) {
        actor.revoke();
        actor.port?.close();
        throw error;
      }
    },
    startAsk(session: SessionRef, instance: InstanceRef, message: AskMessage): void {
      const actor = actors.get(session.id);
      if (!actor) {
        input.sink.askFailed(instance, new WorkflowError("DriverError", "ACP actor missing"));
        return;
      }
      actor.current = instance;
      actor.typed = message.typed;
      actor.text = "";
      actor.tools = 0;
      void (async () => {
        await input.journal.flush();
        if (input.signal.aborted || actor.current !== instance) return;
        const resultHint = message.typed
          ? `\n\n结果必须通过 zcode-workflow-result 的 submit_result 工具提交，参数 {"result": <符合 schema 的 JSON>}。结果类型：${JSON.stringify(message.schema)}。校验拒绝后根据 violations 修复并再次提交。`
          : "\n\n完成后直接用自然语言回复结果。";
        const role = actor.persona.system
          ? `角色：${actor.persona.name ?? "子代理"}\n${actor.persona.system}\n\n`
          : "";
        const usage = await actor.port.prompt(`${role}${message.instructions}${resultHint}`);
        if (actor.current !== instance || input.signal.aborted) return;
        const report = usage as AcpUsageReport | null | undefined;
        input.sink.askProgress(instance, { turn: 1, toolCalls: actor.tools });
        input.sink.askStats(instance, {
          tokens: report?.usage?.totalTokens ?? 0,
          toolCalls: actor.tools,
          worldToolCalls: actor.tools,
          turns: 1,
        });
        actor.current = undefined;
        input.sink.askTurnEnded(instance, actor.text);
      })().catch((error: unknown) => {
        if (actor.current !== instance) return;
        actor.current = undefined;
        input.sink.askFailed(
          instance,
          new WorkflowError("DriverError", error instanceof Error ? error.message : String(error)),
        );
      });
    },
    respondToSubmit(instance: InstanceRef, verdict: SubmitVerdict): void {
      for (const actor of actors.values()) {
        if (actor.current !== instance || !actor.pending) continue;
        const resolve = actor.pending;
        actor.pending = undefined;
        resolve(verdict);
        return;
      }
    },
    cancelAsk(instance: InstanceRef): void {
      for (const actor of actors.values()) {
        if (actor.current !== instance) continue;
        actor.current = undefined;
        actor.pending?.({
          kind: "reject",
          violations: [{ path: "$", expected: "live ask", got: "cancelled" }],
        });
        actor.pending = undefined;
        void actor.port.cancel().catch(() => {});
      }
    },
    async executeWorldRead(op, args) {
      await input.journal.flush();
      return world.read(op, args);
    },
    async executeArtifactPublish(request) {
      await input.journal.flush();
      return world.publish(request);
    },
    dispose() {
      for (const actor of actors.values()) {
        actor.revoke();
        actor.port.close();
      }
      actors.clear();
    },
  };
  return driver;
}
