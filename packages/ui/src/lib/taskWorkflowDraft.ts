import { uuidv7, type WorkTaskWorkflow, type WorkTaskWorkflowStage } from "@zcode/shared";

// 默认项只是内置生命周期的展示身份；项目选择仍通过 null 交给 Host，不能保存为自定义定义。
export const BUILTIN_TASK_WORKFLOW_ID = "00000000-0000-4000-8000-000000000001";

export function builtinTaskWorkflow(label: (key: string) => string): WorkTaskWorkflow {
  return {
    ...newTaskWorkflow(label),
    id: BUILTIN_TASK_WORKFLOW_ID,
    name: label("default"),
    description: label("defaultDescription"),
  };
}

export function orderWorkflowSteps(stages: WorkTaskWorkflowStage[]): WorkTaskWorkflowStage[] {
  return stages.map((stage, index) => ({
    ...stage,
    nextStageId:
      stage.enabled === false || stage.status === "done" || stage.status === "canceled"
        ? undefined
        : stages
            .slice(index + 1)
            .find(
              (item) =>
                item.enabled !== false && item.status !== "blocked" && item.status !== "canceled",
            )?.id,
    returnStageId: stages
      .slice(0, index)
      .some((item) => item.id === stage.returnStageId && item.enabled !== false)
      ? stage.returnStageId
      : undefined,
  }));
}
export function newTaskWorkflow(label: (key: string) => string): WorkTaskWorkflow {
  const statuses = ["backlog", "todo", "active", "review", "blocked", "done", "canceled"] as const;
  return {
    id: uuidv7(),
    name: "",
    description: "",
    initialStageId: "todo",
    stages: orderWorkflowSteps(
      statuses.map((status) => ({
        id: status,
        status,
        name: label(`status.${status}`),
        instructions: "",
        handoff: "none",
        enabled: true,
      })),
    ),
  };
}
export function workflowStepHandoff(stage: WorkTaskWorkflowStage) {
  return stage.handoff ?? (stage.status ? "none" : "agent");
}
export function canReorderWorkflowStep(stage: WorkTaskWorkflowStage) {
  return !stage.status || stage.status === "active" || stage.status === "review";
}
