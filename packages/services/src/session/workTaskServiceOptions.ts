import type { WorkTask } from "@zcode/shared";
import type {
  WorkTaskExecutionContext,
  WorkTaskForgePort,
  WorkTaskRepositoryIssuesPort,
  WorkTaskResultPort,
  WorkTaskConversationPort,
  WorkTaskConversationEvent,
  WorkTaskMergePort,
} from "./workTask.js";
import type { WorkTaskRepo } from "./workTaskRepo.js";
import type { WorkTaskAttachmentStore } from "./workTaskAttachmentStore.js";

export interface WorkTaskRun {
  task: WorkTask;
  abort: AbortController;
  promise: Promise<void>;
  conversation?: (event: WorkTaskConversationEvent) => void;
}

export interface WorkTaskServiceOptions {
  repo: WorkTaskRepo;
  attachments?: WorkTaskAttachmentStore;
  forge?: WorkTaskForgePort;
  repositoryIssues?: WorkTaskRepositoryIssuesPort;
  result?: WorkTaskResultPort;
  execute(task: WorkTask, context: WorkTaskExecutionContext): Promise<void>;
  merge?: WorkTaskMergePort;
  conversation?: WorkTaskConversationPort;
  pollIntervalMs?: number;
  allowExecution?: boolean;
  /** 从当前 Host 设置读取统一上限；队列及名额仍由 Repo 原子认领。 */
  getConcurrency?(): Promise<number>;
  /** Local Host adapter; receives the persisted task allocation, never a UI path. */
  removeWorktree?(task: WorkTask): Promise<void>;
}
