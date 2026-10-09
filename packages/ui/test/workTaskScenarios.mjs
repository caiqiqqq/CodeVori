import { exerciseWorkTaskWorkspaceMode } from "./workTaskWorkspaceModeAssertions.mjs";
import { exerciseWorkTaskPromptAttachments } from "./workTaskPromptAttachmentsAssertions.mjs";
import { exerciseWorkTaskImageResources } from "./workTaskImageResourcesAssertions.mjs";
import { exerciseWorkTaskPendingImages } from "./workTaskPendingImagesAssertions.mjs";
import { exerciseWorkTaskBranchesAndMerge } from "./workTaskMergeAssertions.mjs";
import { exerciseWorkTaskEditRestart } from "./workTaskEditRestartAssertions.mjs";
import { exerciseWorkTaskExecutionPreferences } from "./workTaskExecutionPreferenceAssertions.mjs";
import { exerciseWorkTaskConversationStatus } from "./workTaskConversationStatusAssertions.mjs";
import { exerciseWorkTaskConcurrentExecution } from "./workTaskConcurrentExecutionAssertions.mjs";
import { exerciseWorkTaskCompletion } from "./workTaskCompletionAssertions.mjs";
import { exerciseWorkTaskNavigation } from "./workTaskNavigationAssertions.mjs";
import { exerciseWorkTaskSaveRefresh } from "./workTaskSaveRefreshAssertions.mjs";
import { exerciseWorkTaskArchiveWorktree } from "./workTaskArchiveWorktreeAssertions.mjs";
import { exerciseWorkTaskComposer } from "./workTaskComposerAssertions.mjs";

export {
  exerciseWorkTaskPromptAttachments,
  exerciseWorkTaskImageResources,
  exerciseWorkTaskPendingImages,
  exerciseWorkTaskBranchesAndMerge,
  exerciseWorkTaskEditRestart,
  exerciseWorkTaskExecutionPreferences,
  exerciseWorkTaskConversationStatus,
  exerciseWorkTaskConcurrentExecution,
  exerciseWorkTaskCompletion,
};
export const workTaskScenarios = {
  composer: exerciseWorkTaskComposer,
  "archive-worktree": exerciseWorkTaskArchiveWorktree,
  navigation: exerciseWorkTaskNavigation,
  "save-refresh": exerciseWorkTaskSaveRefresh,
  "workspace-mode": exerciseWorkTaskWorkspaceMode,
  "prompt-attachments": exerciseWorkTaskPromptAttachments,
  "image-resources": exerciseWorkTaskImageResources,
  "pending-images": exerciseWorkTaskPendingImages,
  "branches-merge": exerciseWorkTaskBranchesAndMerge,
  "edit-restart": exerciseWorkTaskEditRestart,
  "execution-preferences": exerciseWorkTaskExecutionPreferences,
  "conversation-status": exerciseWorkTaskConversationStatus,
  "concurrent-execution": exerciseWorkTaskConcurrentExecution,
  completion: exerciseWorkTaskCompletion,
};
