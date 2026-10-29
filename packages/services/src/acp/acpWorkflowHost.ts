import { randomUUID } from "node:crypto";

import {
  validate,
  type RunEvent,
  type RunRecord,
  type ArtifactVersionRecord,
} from "@zcode/dynamic-workflow";
import { runWorkflowScript } from "@zcode/dynamic-workflow-runtime";
import { reduceWorkflowRunsState } from "@zcode/shared/zcode-protocol-v4";
import type { AcpSession, AcpEntry, NativeMcpServerRecord } from "@zcode/shared";
import type { AcpConnectionFactory, AcpPermission } from "./acpServiceImpl.js";
import { createAcpWorkflowDriver } from "./acpWorkflowDriver.js";
import { AcpWorkflowJournal } from "./acpWorkflowJournal.js";
import type { AcpWorkflowMcp } from "./acpWorkflowMcp.js";
import { resolveAcpWorkflowArtifact } from "./acpWorkflowWorld.js";
import {
  compileAcpWorkflow,
  freezeWorkflowSelection,
  instructions,
  readWorkflowSelection,
  workflowGraph,
  type Compiled,
  type FrozenActorSelection,
} from "./acpWorkflowPlan.js";
import { restoreAcpWorkflowProjection } from "./acpWorkflowRestore.js";
import {
  callSavedWorkflowTool,
  savedWorkflowTools,
  type AcpSavedWorkflowService,
} from "./acpSavedWorkflows.js";

type Live = { cancel: AbortController; settled: Promise<void> };
/** Per-parent Host controller; run decisions live only in the shared engine/journal. */
export class AcpWorkflowHost {
  private readonly journals = new Map<string, Promise<AcpWorkflowJournal>>();
  private readonly live = new Map<string, Live>();
  private readonly admission = new Map<string, Promise<void>>();
  private readonly progressQueues = new Map<string, Promise<void>>();
  private readonly runOwners = new Map<string, string>();

  constructor(
    private readonly options: {
      directory: string;
      savedWorkflows?: AcpSavedWorkflowService;
      connect: AcpConnectionFactory;
      mcp: AcpWorkflowMcp;
      mutate(session: AcpSession, change: () => void): Promise<void>;
      permission(
        session: AcpSession,
        request: AcpPermission,
        runId?: string,
      ): Promise<string | null>;
      notify(session: AcpSession, runId: string, result: unknown): Promise<void>;
      sources(session: AcpSession): Promise<{
        mcpServers: NativeMcpServerRecord[];
        launch?: Parameters<AcpConnectionFactory>[0]["launch"];
        pluginServers?: Parameters<AcpConnectionFactory>[0]["pluginServers"];
      }>;
    },
  ) {}

  private journal(id: string): Promise<AcpWorkflowJournal> {
    let value = this.journals.get(id);
    if (!value) {
      value = AcpWorkflowJournal.open(this.options.directory, id);
      this.journals.set(id, value);
    }
    return value;
  }
  async restore(session: AcpSession): Promise<void> {
    await restoreAcpWorkflowProjection(
      session,
      await this.journal(session.id),
      this.options.mutate,
    );
  }

  async register(session: AcpSession): Promise<{ record: NativeMcpServerRecord; revoke(): void }> {
    const savedTools = this.options.savedWorkflows ? savedWorkflowTools : [];
    return this.options.mcp.register("zcode-workflows", {
      names: [
        "ReadWorkflowInstructions",
        "CreateWorkflow",
        "GetWorkflowRun",
        "CancelWorkflowRun",
        "ResumeWorkflowRun",
        ...savedTools.map((tool) => tool.name),
      ],
      call: async (name, args) => {
        if (savedTools.some((tool) => tool.name === name))
          return callSavedWorkflowTool(
            name,
            args,
            session,
            this.options.savedWorkflows!,
            this.options.permission,
          );
        if (name === "ReadWorkflowInstructions")
          return {
            instructions: this.options.savedWorkflows
              ? `${instructions}\nCreateWorkflow starts a run; it does not save a reusable definition. Only when the user explicitly asks or agrees, use SaveWorkflow with name (file-safe identifier), description, required scope (project/global), optional whenToUse/args declarations, and exactly one of script/script_path. Saving checks the script, asks one-time permission and writes without running. ListSavedWorkflows lists definitions; saved ones are available in Automations → Workflows.`
              : instructions,
          };
        if (name === "CreateWorkflow") return this.create(session, args);
        const runId = args.runId;
        if (typeof runId !== "string") throw new Error("runId is required");
        if (name === "GetWorkflowRun") return this.get(session, runId);
        if (name === "CancelWorkflowRun") {
          await this.cancel(session, runId);
          return { status: "stopped" };
        }
        if (name === "ResumeWorkflowRun") {
          await this.resume(session, runId);
          return { status: "backgrounded", backgroundTaskId: runId };
        }
        throw new Error("Unknown workflow command");
      },
    });
  }

  async create(session: AcpSession, args: Record<string, unknown>) {
    if (typeof args.script !== "string") throw new Error("CreateWorkflow requires a script");
    const compiled = compileAcpWorkflow(args.script);
    if (
      compiled.diagnostics.length ||
      !compiled.lowered ||
      !compiled.askSpecs ||
      !compiled.commands ||
      !compiled.hash
    )
      return { status: "diagnostics", diagnostics: compiled.diagnostics };
    const name =
      typeof args.name === "string" && args.name.trim() ? args.name.trim().slice(0, 128) : "工作流";
    const permission = await this.options.permission(session, {
      requestId: randomUUID(),
      title: `启动工作流「${name}」？\n${args.script}\n命令：${[...compiled.commands].join(", ") || "无"}`,
      options: [
        { optionId: "allow", name: "允许", kind: "allow_once" },
        { optionId: "reject", name: "拒绝", kind: "reject" },
      ],
    });
    if (permission !== "allow") return { status: "rejected", message: "用户拒绝启动工作流" };
    const runId = `acp-workflow-${randomUUID()}`;
    const toolCallId = `tool:workflow:${runId}`;
    const graph = workflowGraph(compiled.analysis);
    const selection = await freezeWorkflowSelection(this.options.directory, session, runId);
    await this.options.mutate(session, () => {
      const entry: AcpEntry = {
        id: toolCallId,
        kind: "tool",
        title: name,
        status: "in_progress",
        createdAt: Date.now(),
        workflow: { runId, name, ...(graph ? { graph } : {}) },
      };
      session.entries.push(entry);
    });
    await this.launch(session, runId, args.script, compiled, toolCallId, name, selection);
    return { status: "backgrounded", backgroundTaskId: runId };
  }

  private launch(
    session: AcpSession,
    runId: string,
    script: string,
    compiled: Compiled,
    toolCallId: string,
    name: string,
    selection: FrozenActorSelection,
  ): Promise<void> {
    if (!compiled.lowered || !compiled.askSpecs || !compiled.commands || !compiled.hash)
      throw new Error("Workflow was not compiled");
    const cancel = new AbortController();
    let accepted = false;
    let accept!: () => void;
    let reject!: (error: Error) => void;
    const admission = new Promise<void>((resolve, fail) => {
      accept = resolve;
      reject = fail;
    });
    const settled = (async () => {
      const journal = await this.journal(session.id);
      const sources = await this.options.sources(session);
      const outcome = await runWorkflowScript({
        runId,
        scriptText: script,
        lowered: compiled.lowered,
        scriptHash: compiled.hash,
        parentSessionId: session.id,
        toolCallId,
        name,
        cwd: session.workspacePath,
        caps: { maxConcurrency: 4 },
        askSpecs: compiled.askSpecs,
        validate: (schema, value) => validate(schema as Parameters<typeof validate>[0], value),
        signal: cancel.signal,
        launch: { inputId: toolCallId },
        makeDriver: (sink) =>
          createAcpWorkflowDriver({
            runId,
            workspacePath: session.workspacePath,
            agent: selection.agent,
            configOptions: selection.configOptions,
            modeState: selection.modeState,
            journal,
            sink,
            signal: cancel.signal,
            commands: compiled.commands!,
            connect: this.options.connect,
            mcp: this.options.mcp,
            mcpServers: sources.mcpServers,
            ...(sources.launch ? { launch: sources.launch } : {}),
            ...(sources.pluginServers ? { pluginServers: sources.pluginServers } : {}),
            permission: (request) => this.options.permission(session, request, runId),
            emit: (event) => {
              const sequence = journal.listEvents(runId).at(-1)?.sequence ?? 0;
              void this.progress(session, runId, toolCallId, sequence, event);
              if (event.type === "run-started" && !accepted) {
                accepted = true;
                void journal
                  .flush()
                  .then(() => this.progressQueues.get(runId))
                  .then(accept, reject);
              }
            },
          }),
      });
      await journal.flush();
      await this.progressQueues.get(runId);
      await this.options.mutate(session, () => {
        const entry = session.entries.find((item) => item.id === toolCallId);
        if (entry?.kind === "tool") {
          entry.status =
            outcome.status === "completed"
              ? "completed"
              : outcome.status === "stopped"
                ? "cancelled"
                : "failed";
          entry.content = JSON.stringify(outcome);
        }
      });
      if (!accepted) reject(new Error("Workflow did not start"));
      await this.options.notify(session, runId, outcome);
    })()
      .catch(async (error: unknown) => {
        if (!accepted) reject(error instanceof Error ? error : new Error(String(error)));
        await this.options.mutate(session, () => {
          const entry = session.entries.find((item) => item.id === toolCallId);
          if (entry?.kind === "tool") {
            entry.status = "failed";
            entry.content = error instanceof Error ? error.message : String(error);
          }
        });
      })
      .finally(() => {
        this.live.delete(runId);
        this.runOwners.delete(runId);
      });
    this.runOwners.set(runId, session.id);
    this.live.set(runId, { cancel, settled });
    return admission;
  }

  private async progress(
    session: AcpSession,
    runId: string,
    toolCallId: string | undefined,
    sequence: number,
    event: RunEvent,
  ): Promise<void> {
    const { type, ...payload } = event;
    const previous = this.progressQueues.get(runId) ?? Promise.resolve();
    const task = previous.then(async () => {
      const next = reduceWorkflowRunsState(session.workflowRuns, {
        runId,
        ...(toolCallId ? { toolCallId } : {}),
        sequence,
        eventType: type,
        payload: {
          ...payload,
          ...(type === "run-settled" && event.status === "stopped" ? { resumable: true } : {}),
        },
      });
      if (next)
        await this.options.mutate(session, () => {
          session.workflowRuns = next;
        });
    });
    this.progressQueues.set(runId, task);
    await task;
  }

  async get(session: AcpSession, runId: string) {
    const journal = await this.journal(session.id);
    const row = journal.getRun(runId);
    if (!row || row.parentSessionId !== session.id)
      throw new Error("Workflow run does not belong to this session");
    return {
      status: row.status,
      result: row.result,
      stopReason: row.stopReason,
      events: journal
        .listEvents(runId, { limit: 100 })
        .map((item) => ({ sequence: item.sequence, type: item.event.type })),
    };
  }

  async getArtifact(
    session: AcpSession,
    runId: string,
    artifactId: string,
  ): Promise<{ path: string }> {
    await this.get(session, runId);
    const journal = await this.journal(session.id);
    const records = journal.listNodes(runId).flatMap((node) => {
      const value = node.result as Partial<ArtifactVersionRecord> | undefined;
      if (
        node.kind !== "artifact" ||
        node.status !== "completed" ||
        value?.id !== artifactId ||
        (value.kind !== "file" && value.kind !== "markdown") ||
        !Number.isInteger(value.version)
      )
        return [];
      return [value as ArtifactVersionRecord];
    });
    const latest = records.sort((left, right) => right.version - left.version)[0];
    if (!latest) throw new Error("Workflow artifact not found");
    return { path: await resolveAcpWorkflowArtifact(session.workspacePath, runId, latest) };
  }

  async cancel(session: AcpSession, runId: string): Promise<void> {
    await this.get(session, runId);
    this.live.get(runId)?.cancel.abort("user");
    await this.live.get(runId)?.settled;
  }

  async resume(session: AcpSession, runId: string): Promise<void> {
    if (this.admission.has(runId)) return this.admission.get(runId);
    if (this.live.has(runId)) throw new Error("Workflow run is already running");
    const task = (async () => {
      const journal = await this.journal(session.id);
      const row: RunRecord | undefined = journal.getRun(runId);
      if (!row || row.parentSessionId !== session.id)
        throw new Error("Workflow run does not belong to this session");
      if (
        row.status !== "stopped" ||
        row.stopReason === "superseded" ||
        !row.scriptText ||
        !row.toolCallId
      )
        throw new Error("Workflow run cannot be resumed");
      const compiled = compileAcpWorkflow(row.scriptText);
      if (compiled.diagnostics.length) throw new Error("Stored workflow script no longer compiles");
      const selection = await readWorkflowSelection(this.options.directory, session, runId);
      await this.launch(
        session,
        runId,
        row.scriptText,
        compiled,
        row.toolCallId,
        row.name ?? "工作流",
        selection,
      );
    })();
    this.admission.set(runId, task);
    try {
      await task;
    } finally {
      this.admission.delete(runId);
    }
  }

  stopSession(id: string): void {
    for (const [runId, live] of this.live) {
      if (this.runOwners.get(runId) === id) live.cancel.abort("user");
    }
  }

  ownsLive(id: string): boolean {
    return [...this.runOwners.values()].includes(id);
  }

  dispose(): void {
    for (const live of this.live.values()) live.cancel.abort("interrupted");
  }
  async settleAll(): Promise<void> {
    await Promise.allSettled([...this.live.values()].map((value) => value.settled));
    await Promise.allSettled([...this.progressQueues.values()]);
  }
}
