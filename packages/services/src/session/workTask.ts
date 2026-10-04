import {
  ServiceChannels,
  type WorkTask,
  type WorkTaskBoard,
  type WorkTaskCreate,
  type WorkTaskEvent,
  type WorkTaskScope,
  type WorkTaskStart,
  type WorkTaskTarget,
  type WorkTaskUpdate,
} from "@zcode/shared";
import type { Event, IDisposable } from "@zcode/rpc";
import { createServiceDescriptor } from "../descriptors.js";

export interface IWorkTaskService {
  list(input: WorkTaskScope & { includeArchived?: boolean }): Promise<WorkTaskBoard>;
  create(input: WorkTaskCreate): Promise<WorkTask>;
  update(input: WorkTaskUpdate): Promise<WorkTask>;
  start(input: WorkTaskStart): Promise<WorkTask>;
  startAll(input: WorkTaskScope): Promise<void>;
  cancel(input: WorkTaskTarget): Promise<WorkTask>;
  complete(input: WorkTaskTarget): Promise<WorkTask>;
  archive(input: WorkTaskTarget & { archived: boolean }): Promise<WorkTask>;
  setConcurrency(input: WorkTaskScope & { concurrency: number }): Promise<void>;
  getEvents(input: WorkTaskTarget): Promise<WorkTaskEvent[]>;
  onDynamicChanged(input: WorkTaskScope): Event<void>;
}
export const IWorkTaskService = createServiceDescriptor<IWorkTaskService>(ServiceChannels.WorkTask);

export interface WorkTaskExecutionUpdate {
  status?: "running" | "awaiting_input";
  session?: NonNullable<WorkTask["session"]>;
  worktree?: NonNullable<WorkTask["worktree"]>;
}
export interface WorkTaskExecutionContext {
  readonly signal: AbortSignal;
  /** False means this run lost its lease or was canceled; no further commands may be sent. */
  update(patch: WorkTaskExecutionUpdate): Promise<boolean>;
}
export interface WorkTaskExecutionPort {
  execute(task: WorkTask, context: WorkTaskExecutionContext): Promise<void>;
}

export interface WorkTaskConversationEvent {
  commandId: string;
  startedAt: number;
  status: "running" | "awaiting_input" | "review" | "failed";
  error?: string;
  foregroundExecutionId?: string;
}

/** Passive facts from an already-bound conversation; never sends or replays an input. */
export interface WorkTaskConversationPort {
  watch(task: WorkTask, listener: (event: WorkTaskConversationEvent) => void): IDisposable;
  stop(task: WorkTask, event: WorkTaskConversationEvent): Promise<void>;
}
