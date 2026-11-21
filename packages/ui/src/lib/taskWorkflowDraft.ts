import { uuidv7, type WorkTaskWorkflow, type WorkTaskWorkflowStage } from "@zcode/shared";

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
