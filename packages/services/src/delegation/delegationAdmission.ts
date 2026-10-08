import {
  delegationCreateSchema,
  delegationParentSchema,
  uuidv7,
  type DelegationCreate,
  type DelegationParent,
  type DelegationTask,
} from "@zcode/shared";
import type { DelegationDependencies } from "./contract.js";
import { parentKey, type DelegationRepository } from "./delegationRepository.js";
import { listDelegationTargets } from "./delegationTargets.js";

const terminal = new Set(["completed", "failed", "interrupted", "canceled"]);

export function findDelegationBinding(
  repo: DelegationRepository,
  parent: DelegationParent,
  requestId?: string,
) {
  return repo.list().findLast(
    (task) =>
      ((task.session?.kind === parent.kind && task.session.id === parent.sessionId) ||
        // 创建 ID 只能关联相同执行类型，避免 API/ACP 子任务在初始化时串绑。
        (requestId &&
          task.execution.kind === parent.kind &&
          task.sessionRequestId === requestId)) &&
      (task.worktree?.path ?? task.parent.workspacePath) === parent.workspacePath,
  );
}

export async function admitDelegation(
  repo: DelegationRepository,
  deps: DelegationDependencies,
  raw: DelegationCreate,
  previousId?: string,
) {
  const input = delegationCreateSchema.parse(raw);
  if (deps.allowExecution === false || input.workspaceIdentity || input.remoteSessionId)
    throw new Error("delegation.remote-unsupported");
  await repo.open();
  const parent = delegationParentSchema.strip().parse(input);
  // 已接受的幂等请求不再依赖当前安装状态或原附件是否仍存在。
  const existing = repo.list(parent).find((task) => task.requestId === input.requestId);
  if (existing) return existing;
  if (!repo.settings(findDelegationBinding(repo, parent)?.rootParent ?? parent).enabled)
    throw new Error("delegation.disabled");
  const targets = await listDelegationTargets(deps);
  const execution = input.execution;
  // 原校验只允许 ACP，导致 API 目标即使可选也不能入队；统一使用 Host 的可执行目录。
  if (execution.kind === "acp") {
    if (!targets.some((target) => target.kind === "acp" && target.agent === execution.agent))
      throw new Error("delegation.agent-unavailable");
  } else {
    const selection = execution.modelSelection;
    if (
      !targets.some(
        (target) =>
          target.kind === "api" &&
          target.execution.modelSelection.providerId === selection.providerId &&
          target.execution.modelSelection.modelId === selection.modelId &&
          !!selection.options?.reasoningLevel &&
          target.reasoningLevels.includes(selection.options.reasoningLevel),
      )
    )
      throw new Error("delegation.model-unavailable");
  }
  await deps.validateAssets?.(input);
  return repo.transaction(() => {
    const duplicate = repo.list(parent).find((task) => task.requestId === input.requestId);
    if (duplicate) return duplicate;
    const child = findDelegationBinding(repo, parent);
    const rootParent = child?.rootParent ?? parent;
    const depth = child ? child.depth + 1 : 1;
    const settings = repo.settings(rootParent);
    // 异步目标/附件检查期间设置可能改变；最终事务仍校验主开关，旧连接不能绕过关闭状态。
    if (!settings.enabled) throw new Error("delegation.disabled");
    if (depth > 1 && (!settings.allowNested || depth > settings.maxDepth))
      throw new Error("delegation.nesting-disabled");
    const state = repo.parent(rootParent);
    if (
      state.suspended ||
      repo.parent(parent).suspended ||
      (child && child.generation !== state.generation)
    )
      throw new Error("delegation.parent-stopped");
    for (const id of input.dependsOn) {
      const dependency = repo.get(id);
      if (!dependency || parentKey(dependency.parent) !== parentKey(parent))
        throw new Error("delegation.not-found");
    }
    const previous = previousId ? repo.get(previousId) : undefined;
    if (previousId && (!previous || parentKey(previous.parent) !== parentKey(parent)))
      throw new Error("delegation.not-found");
    if (previous && (!terminal.has(previous.status) || !previous.session))
      throw new Error("delegation.session-busy");
    const now = Date.now();
    const task: DelegationTask = {
      id: uuidv7(),
      requestId: input.requestId,
      parent,
      rootParent,
      generation: state.generation,
      depth,
      title: input.title,
      task: input.task,
      background: input.background,
      constraints: input.constraints,
      expectedResult: input.expectedResult,
      execution: input.execution,
      intent: input.intent,
      workspaceFiles: input.workspaceFiles,
      attachments: input.attachments,
      dependsOn: input.dependsOn,
      status: "queued",
      attempts: [],
      sessionRequestId: uuidv7(),
      createdAt: now,
      updatedAt: now,
      // 追问绑定与入队同一事务，调度器不能抢先创建另一个子会话。
      ...(previous
        ? { session: previous.session, worktree: previous.worktree, previousTaskId: previous.id }
        : {}),
    };
    repo.put(task);
    return task;
  });
}
