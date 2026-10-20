import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  analyzeWorkflowScript,
  FLOW_SINK,
  FLOW_ENTRY,
  FLOW_ABORT,
  buildAskSpecs,
  collectSites,
  collectWorldRunCommands,
  createWorkflowProgram,
  lowerWorkflow,
  synthesizeAskSchemas,
} from "@zcode/dynamic-workflow";
import type {
  AcpSession,
  AcpWorkflowTool,
  AcpConfigOption,
  AcpModeState,
  AcpAgent,
} from "@zcode/shared";

const MAX_SCRIPT = 128 * 1024;
export const instructions = `ZCode ACP dynamic workflows. Call CreateWorkflow with {script: string, name?: string}.
The script is TypeScript checked against ZCode's workflow facade and executed by its isolated workflow engine.
Use phase("用户语言阶段名") at the start of each working stage, agent("name") to create an actor, and
await actor.ask<T>("instructions") for a typed JSON answer (actor must call submit_result), or
await actor.ask("instructions") for a plain text answer. Promise.all supports parallel asks.
Use report(item) for progress, world.run("literal-command", ["args"]) for approved commands;
files.read/glob/grep and git.status/log/diff/changedFiles are journalled world reads.
Use artifact.markdown("id", "# report") or artifact.file("id", "relative/path") to publish deliverables.
Finish the script with return <serializable result>. Commands and script are shown for human confirmation.
Read GetWorkflowRun with {runId} to inspect progress; CancelWorkflowRun and ResumeWorkflowRun use {runId}.
Only the ZCode Host executes these tools; ordinary ACP tool titles do not launch a workflow.`;

export type Compiled = ReturnType<typeof compileAcpWorkflow>;
export function compileAcpWorkflow(script: string) {
  if (!script || Buffer.byteLength(script) > MAX_SCRIPT)
    throw new Error("Workflow script must be 1..131072 bytes");
  const analysis = analyzeWorkflowScript(script);
  if (!analysis.ok) return { analysis, diagnostics: analysis.diagnostics };
  const program = createWorkflowProgram(script);
  const table = collectSites(program);
  const schemas = synthesizeAskSchemas(program, table);
  if (schemas.diagnostics.length) return { analysis, diagnostics: schemas.diagnostics };
  const world = collectWorldRunCommands(program, table);
  if (world.diagnostics.length) return { analysis, diagnostics: world.diagnostics };
  return {
    analysis,
    diagnostics: [],
    askSpecs: buildAskSpecs(table, schemas.schemas),
    lowered: lowerWorkflow(program, table).code,
    commands: new Set(world.commands),
    hash: createHash("sha256").update(script).digest("hex"),
  };
}

export type FrozenActorSelection = {
  parentId: string;
  agent: AcpAgent;
  workspacePath: string;
  workspaceKey: string;
  configOptions: AcpConfigOption[];
  modeState: AcpModeState | null;
};

export function workflowGraph(
  analysis: Compiled["analysis"],
): AcpWorkflowTool["graph"] | undefined {
  const causality = analysis.causality;
  if (!causality) return undefined;
  // Bounded Host-owned graph: no ACP adapter payload is allowed into native display schema.
  const stepIds = new Set(causality.steps.slice(0, 64).map((step) => step.id));
  const participantList = (analysis.handoff?.participants ?? [])
    .filter((item) => item.steps.some((step) => stepIds.has(step)))
    .slice(0, 64);
  const participantIds = new Set(participantList.map((item) => item.id));
  const phaseIds = new Set((analysis.flow?.phases ?? []).slice(0, 32).map((phase) => phase.id));
  const phaseEdges = (analysis.flow?.phaseEdges ?? [])
    .filter((edge) => phaseIds.has(edge.from) && phaseIds.has(edge.to) && edge.from !== edge.to)
    .slice(0, 128)
    .map((edge) => ({
      from: edge.from.slice(0, 64),
      to: edge.to.slice(0, 64),
      ...(edge.kind === "loop" ? { back: true as const } : {}),
    }));
  const exits = (analysis.flow?.phaseEdges ?? [])
    .filter(
      (edge) =>
        edge.to === FLOW_SINK &&
        phaseIds.has(edge.from) &&
        edge.from !== FLOW_ENTRY &&
        edge.from !== FLOW_ABORT,
    )
    .map((edge) => edge.from.slice(0, 64))
    .slice(0, 32);
  return {
    steps: causality.steps.slice(0, 64).map((step) => ({
      id: step.id.slice(0, 64),
      kind: step.kind === "ask" ? ("ask" as const) : ("world-read" as const),
      label: (step.label || step.id).slice(0, 128),
      lane: step.lane.slice(0, 64),
      ...(step.phase && phaseIds.has(step.phase) ? { phase: step.phase.slice(0, 64) } : {}),
    })),
    lanes: causality.lanes.slice(0, 32).map((lane) => ({
      id: lane.id.slice(0, 64),
      ...(lane.name ? { name: lane.name.slice(0, 128) } : {}),
    })),
    participants: participantList.map((item) => ({
      id: item.id.slice(0, 64),
      phase: item.phase.slice(0, 64),
      lane: item.lane.slice(0, 64),
      steps: item.steps.filter((step) => stepIds.has(step)).slice(0, 64),
      ...(item.member ? { member: item.member } : {}),
      ...(item.many ? { many: true as const } : {}),
    })),
    handoffs: (analysis.handoff?.handoffs ?? [])
      .filter((edge) => participantIds.has(edge.from) && participantIds.has(edge.to))
      .slice(0, 256)
      .map((edge) => ({
        from: edge.from.slice(0, 64),
        to: edge.to.slice(0, 64),
        ...(edge.back ? { back: true as const } : {}),
        ...(edge.types?.length
          ? { types: edge.types.slice(0, 8).map((value) => value.slice(0, 128)) }
          : {}),
      })),
    ...(analysis.flow?.phases
      ? {
          phases: analysis.flow.phases.slice(0, 32).map((phase) => ({
            id: phase.id.slice(0, 64),
            ...(phase.name ? { name: phase.name.slice(0, 128) } : {}),
            ...(phase.alongside?.length
              ? { alongside: phase.alongside.filter((id) => phaseIds.has(id)).slice(0, 32) }
              : {}),
          })),
          phaseEdges,
          exits,
        }
      : {}),
  };
}

function selectionPath(directory: string, runId: string): string {
  return join(directory, "workflows", `${runId}.selection.json`);
}
export async function freezeWorkflowSelection(
  directory: string,
  session: AcpSession,
  runId: string,
): Promise<FrozenActorSelection> {
  const selection: FrozenActorSelection = {
    parentId: session.id,
    agent: session.agent,
    workspacePath: session.workspacePath,
    workspaceKey: session.workspaceIdentity?.trim() || session.workspacePath,
    configOptions: structuredClone(session.configOptions),
    modeState: structuredClone(session.modeState),
  };
  const file = selectionPath(directory, runId);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await mkdir(join(directory, "workflows"), { recursive: true });
  try {
    await writeFile(temporary, JSON.stringify(selection), { mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return selection;
}
export async function readWorkflowSelection(
  directory: string,
  session: AcpSession,
  runId: string,
): Promise<FrozenActorSelection> {
  const selection = JSON.parse(
    await readFile(selectionPath(directory, runId), "utf8"),
  ) as FrozenActorSelection;
  if (
    selection.parentId !== session.id ||
    selection.workspacePath !== session.workspacePath ||
    selection.workspaceKey !== (session.workspaceIdentity?.trim() || session.workspacePath) ||
    selection.agent !== session.agent
  )
    throw new Error("Workflow actor selection belongs to another session");
  return selection;
}
