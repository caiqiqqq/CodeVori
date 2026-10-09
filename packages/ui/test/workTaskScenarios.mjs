import { exerciseWorkTaskWorkspaceMode } from "./workTaskWorkspaceModeAssertions.mjs";
import { exerciseWorkTaskPromptAttachments } from "./workTaskPromptAttachmentsAssertions.mjs";
import { exerciseWorkTaskImageResources } from "./workTaskImageResourcesAssertions.mjs";
import { exerciseWorkTaskBranchesAndMerge } from "./workTaskMergeAssertions.mjs";
import { exerciseWorkTaskEditRestart } from "./workTaskEditRestartAssertions.mjs";
import { exerciseWorkTaskExecutionPreferences } from "./workTaskExecutionPreferenceAssertions.mjs";
import { exerciseWorkTaskConversationStatus } from "./workTaskConversationStatusAssertions.mjs";
import { exerciseWorkTaskConcurrentExecution } from "./workTaskConcurrentExecutionAssertions.mjs";
import { exerciseWorkTaskCompletion } from "./workTaskCompletionAssertions.mjs";
import { exerciseWorkTaskSaveRefresh } from "./workTaskSaveRefreshAssertions.mjs";

export {
  exerciseWorkTaskPromptAttachments,
  exerciseWorkTaskImageResources,
  exerciseWorkTaskBranchesAndMerge,
  exerciseWorkTaskEditRestart,
  exerciseWorkTaskExecutionPreferences,
  exerciseWorkTaskConversationStatus,
  exerciseWorkTaskConcurrentExecution,
  exerciseWorkTaskCompletion,
};
export const workTaskScenarios = {
  "save-refresh": exerciseWorkTaskSaveRefresh,
  "workspace-mode": exerciseWorkTaskWorkspaceMode,
  "prompt-attachments": exerciseWorkTaskPromptAttachments,
  "image-resources": exerciseWorkTaskImageResources,
  "branches-merge": exerciseWorkTaskBranchesAndMerge,
  "edit-restart": exerciseWorkTaskEditRestart,
  "execution-preferences": exerciseWorkTaskExecutionPreferences,
  "conversation-status": exerciseWorkTaskConversationStatus,
  "concurrent-execution": exerciseWorkTaskConcurrentExecution,
  completion: exerciseWorkTaskCompletion,
};
