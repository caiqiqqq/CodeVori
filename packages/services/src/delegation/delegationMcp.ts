import { z } from "zod";
import {
  delegationCreateSchema,
  delegationFollowUpSchema,
  delegationResultSchema,
  getDelegationAgentReference,
  uuidv7,
  resolveWorkspaceKey,
  type DelegationParent,
  type NativeMcpServerRecord,
  type ZCodeProtocolMcpServer,
} from "@zcode/shared";
import { createAcpWorkflowMcp } from "../acp/acpWorkflowMcp.js";
import type { AgentDelegationService } from "./agentDelegationService.js";

const idSchema = z.object({ id: z.string().uuid() }).strict();
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
    })
    .extend({ requestId: z.string().uuid().optional() }),
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
    "List available API models and installed, enabled ACP agents without launching them. Match a user's @ reference to the exact returned reference. For API, copy execution including providerId, modelId and reasoningLevel; for ACP use execution.kind=acp, agent and config=[]. Do not switch the main agent.",
  DelegateTask:
    "Delegate an explicit task to an API model or ACP agent from ListDelegationAgents. Preserve the exact target identity and full modelSelection; never guess a provider from a model name. Pass only relevant background/files/constraints. edit creates an isolated worktree; analysis shares cwd and is NOT a security sandbox. Independent tasks run in parallel; dependsOn enforces successful prerequisites. Returns taskId immediately. Reuse requestId on retrying the same call.",
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

export function createDelegationMcp(directory: string, service: AgentDelegationService) {
  const bridge = createAcpWorkflowMcp(directory);
  const registrations = new Map<string, { workspaceKey: string; revoke(): void }>();
  return {
    async register(parent: DelegationParent, requestId?: string) {
      const child = await service.binding(parent, requestId);
      const settings = await service.getSettings(child?.rootParent ?? parent);
      const allowTools =
        settings.enabled && (!child || (settings.allowNested && child.depth < settings.maxDepth));
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
          };
          const target = { ...parent, id: values.id! };
          switch (name) {
            case "ListDelegationAgents":
              return (await service.targets()).map((target) => ({
                ...target,
                reference: getDelegationAgentReference(target),
              }));
            case "DelegateTask":
              return service.delegate(
                delegationCreateSchema.parse({
                  ...values,
                  ...parent,
                  requestId: values.requestId ?? uuidv7(),
                }),
              );
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
