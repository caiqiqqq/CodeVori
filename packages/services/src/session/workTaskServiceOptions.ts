import type { WorkTask } from "@zcode/shared";
import type {
  WorkTaskExecutionContext,
  WorkTaskForgePort,
  WorkTaskResultPort,
  WorkTaskConversationPort,
  WorkTaskMergePort,
} from "./workTask.js";
import type { WorkTaskRepo } from "./workTaskRepo.js";
import type { WorkTaskAttachmentStore } from "./workTaskAttachmentStore.js";

export interface WorkTaskServiceOptions {
  repo: WorkTaskRepo;
  attachments?: WorkTaskAttachmentStore;
  forge?: WorkTaskForgePort;
  result?: WorkTaskResultPort;
  execute(task: WorkTask, context: WorkTaskExecutionContext): Promise<void>;
  merge?: WorkTaskMergePort;
  conversation?: WorkTaskConversationPort;
  pollIntervalMs?: number;
  allowExecution?: boolean;
  /** Local Host adapter; receives the persisted task allocation, never a UI path. */
  removeWorktree?(task: WorkTask): Promise<void>;
}
