import { z } from "zod";
import {
  delegationCreateSchema,
  delegationSquadCreateSchema,
  delegationProfileCreateSchema,
  delegationFollowUpSchema,
  delegationResultSchema,
  getDelegationAgentReference,
  uuidv7,
  resolveWorkspaceKey,
  type DelegationParent,
  type NativeMcpServerRecord,
  type ZCodeProtocolMcpServer,
  type WorkTaskExecution,
  workTaskExecutionSchema,
} from "@zcode/shared";
import { createAcpWorkflowMcp } from "../acp/acpWorkflowMcp.js";
import type { AgentDelegationService } from "./agentDelegationService.js";
import type { DelegationAcpModelSelection } from "./delegationModelInheritance.js";

const idSchema = z.object({ id: z.string().uuid() }).strict();
const acpExecutionSchema = workTaskExecutionSchema.options[1];
const delegationExecutionSchema = z.discriminatedUnion("kind", [
  workTaskExecutionSchema.options[0],
  acpExecutionSchema
    .omit({ modelPreference: true })
    .extend({ config: acpExecutionSchema.shape.config.optional().default([]) }),
]);
const schemas = {
  ListDelegationAgents: z.object({}).strict(),
  DelegateTask: delegationCreateSchema
    .omit({
      workspacePath: true,
      workspaceIdentity: true,
      remoteSessionId: true,
      kind: true,
      sessionId: true,
      requestId: true,
      execution: true,
    })
    .extend({
      requestId: z.string().uuid().optional(),
      execution: delegationExecutionSchema.optional(),
      squadId: z.string().uuid().optional(),
      profileId: z.string().uuid().optional(),
    })
    .refine(
      (input) =>
        [input.execution, input.squadId, input.profileId].filter(Boolean).length === 1 &&
        (!(input.squadId || input.profileId) || !input.squadMemberId),
      "Provide exactly one execution, squadId or profileId; member IDs require execution",
    ),
  GetDelegationTask: idSchema,
  ListDelegationTasks: z.object({}).strict(),
  WaitDelegationTask: idSchema.extend({
    timeoutMs: z.number().int().min(0).max(25_000).default(20_000),
  }),
  FollowUpDelegation: idSchema.extend({
    task: z.string().trim().min(1).max(100_000),
    requestId: z.string().uuid().optional(),
    attachments: delegationFollowUpSchema.shape.attachments,
    workspaceFiles: delegationFollowUpSchema.shape.workspaceFiles,
  }),
  RetryDelegation: idSchema,
  ResumeDelegation: idSchema,
  CancelDelegation: idSchema,
  CancelAllDelegations: z.object({}).strict(),
};
const descriptions: Record<keyof typeof schemas, string> = {
  ListDelegationAgents:
    "List saved agent profiles, available API models, ACP runtimes and saved squads without launching them. A profile reference agent.<id> uses profileId without execution; the Host supplies its saved instructions and model. Match an explicit @ reference to the exact target. For kind=squad, call DelegateTask with squadId instead of execution. For a squad leader this tool lists only its allowed members: copy squadMemberId and full execution. API selections must retain provider/model/options. Do not switch the main agent.",
  DelegateTask:
    "Delegate only when requested; discover exact targets with ListDelegationAgents. A saved agent profile uses profileId without execution or squadId. A saved squad uses squadId and no execution: only its leader starts, coordinates its members, and returns a summary. Squad leaders must use the returned squadMemberId and full execution for each member. Direct API delegation requires the exact full modelSelection. For ACP omit config when no model is specified so Host preferences apply. Pass only necessary context/files/constraints, never full history. edit uses an isolated worktree; analysis shares cwd and is not a sandbox. dependsOn enforces prerequisites. Reuse requestId for the same call. Results authorize summarizing only, not further edits, commits, merges or pushes.",
  GetDelegationTask:
    "Read durable task status, child session, all execution attempts and results. Scope is this conversation only.",
  ListDelegationTasks: "List this conversation's durable delegation tasks.",
  WaitDelegationTask:
    "Wait up to timeoutMs for a task to settle. Bounded wait; status/cancel tools remain usable concurrently.",
  FollowUpDelegation:
    "Create a NEW follow-up task using the previous child conversation and worktree. Does not overwrite the previous result. Child must not be busy.",
  RetryDelegation:
    "Explicitly retry a failed task in a new child session; retain isolated worktree. Never automatically retry potentially destructive writes.",
  ResumeDelegation:
    "Explicitly resume an interrupted task in its existing child session. Check its transcript and changes first; adapter must support restoring its session.",
  CancelDelegation: "Cancel one task, preserving child history and worktree.",
  CancelAllDelegations: "Cancel all delegation tasks in this conversation.",
};

export function createDelegationMcp(
  directory: string,
  service: AgentDelegationService,
  options: {
    resolveAcpExecution?: (
      parent: DelegationParent,
      execution: Extract<WorkTaskExecution, { kind: "acp" }>,
      parentModel?: DelegationAcpModelSelection,
    ) => Promise<Extract<WorkTaskExecution, { kind: "acp" }>>;
  } = {},
) {
  const bridge = createAcpWorkflowMcp(directory);
  const registrations = new Map<string, { workspaceKey: string; revoke(): void }>();
  return {
    async register(
      parent: DelegationParent,
      requestId?: string,
      parentModel?: DelegationAcpModelSelection,
    ) {
      const child = await service.binding(parent, requestId);
      const settings = await service.getSettings(child?.rootParent ?? parent);
      const allowTools =
        settings.enabled &&
        (!child ||
          child.squad?.role === "leader" ||
          (child.squad?.role !== "member" &&
            settings.allowNested &&
            child.depth < settings.maxDepth));
      const names = [
        ...(allowTools ? Object.keys(schemas) : []),
        ...(child ? ["SubmitDelegationResult"] : []),
      ];
      if (!names.length || parent.workspaceIdentity || parent.remoteSessionId) return undefined;
      const key = JSON.stringify([
        parent.workspaceIdentity ?? parent.workspacePath,
        parent.kind,
        parent.sessionId,
      ]);
      const registration = await bridge.register("zcode-delegation", {
        names,
        tools: names.map((name) => ({
          name,
          description:
            name === "SubmitDelegationResult"
              ? "Persist actual conclusions, changedFiles, tests, risks and blockers for THIS execution. Include the commandId from the current task prompt. Do not claim tests you did not run. Call before finishing the answer."
              : descriptions[name as keyof typeof schemas],
          inputSchema: z.toJSONSchema(
            name === "SubmitDelegationResult"
              ? delegationResultSchema.extend({ commandId: z.string().uuid() })
              : schemas[name as keyof typeof schemas],
          ) as Record<string, unknown>,
        })),
        async call(name, args) {
          if (name === "SubmitDelegationResult" && child) {
            const current = await service.binding(parent, requestId);
            if (!current) throw new Error("delegation.stale-attempt");
            const { commandId, ...result } = delegationResultSchema
              .extend({ commandId: z.string().uuid() })
              .parse(args);
            await service.submitResult(current.id, commandId, result);
            return { saved: true };
          }
          if (!allowTools) throw new Error("delegation.nesting-disabled");
          const values = schemas[name as keyof typeof schemas].parse(args) as {
            id?: string;
            task?: string;
            timeoutMs?: number;
            requestId?: string;
            execution?: WorkTaskExecution;
            squadId?: string;
            profileId?: string;
          };
          const target = { ...parent, id: values.id! };
          switch (name) {
            case "ListDelegationAgents": {
              if (child?.squad?.role === "leader")
                return child.squad.definition.members.map((member) => ({
                  squadMemberId: member.id,
                  name: member.name,
                  role: member.role,
                  execution: member.execution,
                }));
              const [targets, squads, profiles] = await Promise.all([
                service.targets(),
                service.listSquads(),
                service.listAgentProfiles(),
              ]);
              return [
                ...profiles.map((profile) => ({
                  kind: "profile",
                  profileId: profile.id,
                  name: profile.name,
                  description: profile.description,
                  reference: `agent.${profile.id}`,
                })),
                ...targets.map((target) => ({
                  ...target,
                  reference: getDelegationAgentReference(target),
                })),
                ...squads.map((squad) => ({
                  kind: "squad",
                  squadId: squad.id,
                  name: squad.name,
                  description: squad.description,
                  reference: `squad.${squad.id}`,
                  leader: squad.leader,
                  members: squad.members.map(({ id, name, role }) => ({ id, name, role })),
                })),
              ];
            }
            case "DelegateTask": {
              if (values.profileId)
                return service.delegateProfile(
                  delegationProfileCreateSchema.parse({
                    ...values,
                    ...parent,
                    requestId: values.requestId ?? uuidv7(),
                  }),
                );
              if (values.squadId)
                return service.delegateSquad(
                  delegationSquadCreateSchema.parse({
                    ...values,
                    ...parent,
                    requestId: values.requestId ?? uuidv7(),
                  }),
                );
              const input = delegationCreateSchema.parse({
                ...values,
                ...parent,
                requestId: values.requestId ?? uuidv7(),
              });
              const execution =
                // 小队执行配置已冻结；继承队长当前模型会改写成员配置并破坏精确角色校验。
                input.execution.kind === "acp" &&
                !input.squadMemberId &&
                options.resolveAcpExecution
                  ? await options.resolveAcpExecution(parent, input.execution, parentModel)
                  : input.execution;
              return service.delegate({ ...input, execution });
            }
            case "ListDelegationTasks":
              return service.list(parent);
            case "GetDelegationTask":
            case "WaitDelegationTask": {
              const get = async () => {
                const task = (await service.list(parent)).find((t) => t.id === values.id);
                if (!task) throw new Error("delegation.not-found");
                return task;
              };
              const end =
                Date.now() + (name === "WaitDelegationTask" ? (values.timeoutMs ?? 0) : 0);
              let task = await get();
              while (
                !["completed", "failed", "interrupted", "canceled"].includes(task.status) &&
                Date.now() < end
              ) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                task = await get();
              }
              return task;
            }
            case "FollowUpDelegation":
              return service.followUp(
                delegationFollowUpSchema.parse({
                  ...values,
                  ...target,
                  task: values.task!,
                  requestId: values.requestId ?? uuidv7(),
                }),
              );
            case "RetryDelegation":
              return service.retry(target);
            case "ResumeDelegation":
              return service.resume(target);
            case "CancelDelegation":
              await service.cancel(target);
              return { canceled: true };
            case "CancelAllDelegations":
              await service.cancelAll(parent);
              return { canceled: true };
            default:
              throw new Error("delegation.unknown-tool");
          }
        },
      });
      registrations.get(key)?.revoke();
      const entry = {
        workspaceKey: resolveWorkspaceKey(parent),
        revoke() {
          registration.revoke();
          if (registrations.get(key) === entry) registrations.delete(key);
        },
      };
      registrations.set(key, entry);
      return { record: registration.record, revoke: entry.revoke, canDelegate: allowTools };
    },
    revokeWorkspace(workspaceKey: string) {
      for (const entry of registrations.values())
        if (entry.workspaceKey === workspaceKey) entry.revoke();
    },
    dispose() {
      registrations.clear();
      bridge.dispose();
    },
  };
}
export function delegationProtocolServer(record: NativeMcpServerRecord): ZCodeProtocolMcpServer {
  if (!record.config.command) throw new Error("delegation.mcp-config-invalid");
  return {
    name: record.name,
    command: record.config.command,
    args: record.config.args ?? [],
    env: Object.entries(record.config.env ?? {}).map(([name, value]) => ({ name, value })),
    isolation: "session",
  };
}
