import { exerciseWorkTaskResult } from "./workTaskResultAssertions.mjs";
import { exerciseWorkTaskSource } from "./workTaskSourceAssertions.mjs";
import { exerciseWorkTaskForge } from "./workTaskForgeAssertions.mjs";
import { exerciseWorkTaskAcceptance } from "./workTaskAcceptanceAssertions.mjs";
import { chromium } from "playwright-core";
import { exerciseWorkTaskAllProjects } from "./workTaskAllProjectsAssertions.mjs";
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
import { exerciseWorkTaskEqualWidths } from "./workTaskEqualWidthAssertions.mjs";
import { exerciseWorkTaskComposer } from "./workTaskComposerAssertions.mjs";
import { exerciseWorkTaskSelectionVisibility } from "./workTaskSelectionVisibilityAssertions.mjs";
import { exerciseWorkTaskSidebarWidth } from "./workTaskSidebarWidthAssertions.mjs";
import { exerciseWorkTaskExecutionConfig } from "./workTaskExecutionConfigAssertions.mjs";
import { exerciseWorkTaskDetail } from "./workTaskDetailAssertions.mjs";
import { exerciseWorkTaskCleanupSync } from "./workTaskCleanupSyncAssertions.mjs";
import { exerciseWorkTaskNewSession } from "./workTaskNewSessionAssertions.mjs";
import { exerciseWorkTaskHttpAttachments } from "./workTaskHttpAttachmentsAssertions.mjs";

export function launchWorkTaskBrowser() {
  return chromium.launch({
    headless: true,
    args:
      process.env.ZCODE_E2E_SCENARIO === "http-attachments"
        ? ["--host-resolver-rules=MAP zcode-http.test 127.0.0.1", "--no-proxy-server"]
        : [],
    // Playwright 默认隐藏滚动条，等宽回归必须保留真实占位才能复现分组宽度差异。
    ignoreDefaultArgs:
      process.env.ZCODE_E2E_SCENARIO === "equal-widths" ? ["--hide-scrollbars"] : [],
  });
}

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
  "http-attachments": exerciseWorkTaskHttpAttachments,
  "new-session": exerciseWorkTaskNewSession,
  "cleanup-sync": exerciseWorkTaskCleanupSync,
  detail: exerciseWorkTaskDetail,
  source: exerciseWorkTaskSource,
  "ai-result": exerciseWorkTaskResult,
  acceptance: exerciseWorkTaskAcceptance,
  "forge-completion": exerciseWorkTaskForge,
  "execution-config": exerciseWorkTaskExecutionConfig,
  "sidebar-width": exerciseWorkTaskSidebarWidth,
  "selection-visibility": exerciseWorkTaskSelectionVisibility,
  "equal-widths": exerciseWorkTaskEqualWidths,
  composer: exerciseWorkTaskComposer,
  "all-projects": exerciseWorkTaskAllProjects,
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
