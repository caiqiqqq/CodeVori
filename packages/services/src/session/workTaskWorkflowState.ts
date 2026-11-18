import {
  currentWorkTaskWorkflowStage,
  type WorkTask,
  type WorkTaskWorkflowStage,
} from "@zcode/shared";

export function buildWorkTaskStagePrompt(
  prompt: string,
  stage: WorkTaskWorkflowStage,
  handoffNote?: string,
) {
  return [
    prompt,
    `当前工作流阶段：${stage.name}`,
    stage.owner ? `阶段负责人：${stage.owner}` : undefined,
    stage.instructions ? `阶段要求：\n${stage.instructions}` : undefined,
    handoffNote ? `交接说明：\n${handoffNote}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function assertWorkTaskWorkflowFinalStage(task: WorkTask) {
  if (!task.workflow) return;
  const stage = currentWorkTaskWorkflowStage(task);
  if (!stage) throw new Error("work-task.workflow-stage-invalid");
  if (stage.status ? stage.status !== "done" : !!stage.nextStageId)
    throw new Error("work-task.workflow-final-stage-required");
}
