import {
  openWorkTaskDatabase,
  listWorkTaskConversations,
  recordWorkTaskChange,
  writeWorkTask,
  claimNextWorkTask,
  appendWorkTaskQueue,
  type WorkTaskDatabase as Database,
} from "./workTaskDatabase.js";
import {
  continueWorkTaskConversation,
  workTaskRunPrompt,
  assertWorkTaskWorkspaceEditable,
} from "./workTaskConversationState.js";
import { finishWorkTaskRun, interruptWorkTaskRun } from "./workTaskRunState.js";
import { isDeepStrictEqual } from "node:util";
import {
  WORK_TASK_ACTIVE_STATUSES,
  isWorkTaskMerging,
  resolveWorkspaceKey,
  uuidv7,
  workTaskSchema,
  type WorkTask,
  type WorkTaskCreate,
  type WorkTaskEvent,
  type WorkTaskScope,
  type WorkTaskUpdate,
  type WorkTaskMerge,
  type WorkTaskMergeRequest,
} from "@zcode/shared";
import type { WorkTaskConversationEvent, WorkTaskExecutionUpdate } from "./workTask.js";

interface Row {
  data: string;
  owner: string | null;
  lease_until: number | null;
}
const decode = (row: Row): WorkTask => workTaskSchema.parse(JSON.parse(row.data));

export class WorkTaskRepo {
  private db: Database | null = null;
  private initialization: Promise<void> | null = null;
  constructor(private readonly path: string) {}

  ready(): Promise<void> {
    this.initialization ??= this.initialize();
    return this.initialization;
  }
  private async initialize() {
    this.db = await openWorkTaskDatabase(this.path);
  }
  close() {
    this.db?.close();
    this.db = null;
  }
  private database(): Database {
    if (!this.db) throw new Error("work-task.storage-not-ready");
    return this.db;
  }
  private transaction<T>(callback: () => T): T {
    const db = this.database();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  private row(scope: WorkTaskScope, id: string): Row {
    const row = this.database()
      .prepare("SELECT data, owner, lease_until FROM work_tasks WHERE id=? AND workspace_key=?")
      .get(id, resolveWorkspaceKey(scope)) as Row | undefined;
    if (!row || decode(row).workspacePath !== scope.workspacePath)
      throw new Error("work-task.not-found");
    return row;
  }
  get(scope: WorkTaskScope, id: string): WorkTask {
    return decode(this.row(scope, id));
  }
  list(scope: WorkTaskScope, includeArchived = false): WorkTask[] {
    const rows = this.database()
      .prepare("SELECT data, owner, lease_until FROM work_tasks WHERE workspace_key=?")
      .all(resolveWorkspaceKey(scope)) as unknown as Row[];
    return rows
      .map(decode)
      .filter(
        (task) => task.workspacePath === scope.workspacePath && (includeArchived || !task.archived),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }
  conversationTasks(): WorkTask[] {
    return listWorkTaskConversations(this.database());
  }
  claimConversation(
    task: WorkTask,
    owner: string,
    event: WorkTaskConversationEvent,
    leaseMs: number,
  ): WorkTask | null {
    return this.transaction(() => {
      const row = this.row(task, task.id);
      const now = Date.now();
      const next = continueWorkTaskConversation(decode(row), task, event, row.owner, now);
      return next ? this.write(next, "conversation-continued", owner, now + leaseMs) : null;
    });
  }
  /** Legacy project setting; preserved for clients, not used by task admission. */
  concurrency(scope: WorkTaskScope): number {
    const row = this.database()
      .prepare("SELECT concurrency FROM work_task_projects WHERE workspace_key=?")
      .get(resolveWorkspaceKey(scope)) as { concurrency: number } | undefined;
    return row?.concurrency ?? 1;
  }
  revisions(): Map<string, number> {
    const rows = this.database()
      .prepare("SELECT workspace_key, revision FROM work_task_projects")
      .all() as { workspace_key: string; revision: number }[];
    return new Map(rows.map((row) => [row.workspace_key, row.revision]));
  }
  private write(task: WorkTask, type: string, owner?: string | null, leaseUntil?: number | null) {
    return writeWorkTask(this.database(), task, type, owner, leaseUntil);
  }
  create(input: WorkTaskCreate): WorkTask {
    return this.transaction(() => {
      assertWorkTaskWorkspaceEditable(null, input);
      const now = Date.now();
      const task: WorkTask = {
        ...input,
        id: uuidv7(),
        sessionRequestId: uuidv7(),
        commandId: uuidv7(),
        status: "todo",
        archived: false,
        runSeq: 0,
        runText: input.prompt,
        runUsesPromptAssets: true,
        stopPending: false,
        createdAt: now,
        updatedAt: now,
      };
      this.database()
        .prepare("INSERT INTO work_tasks(id,workspace_key,status,data) VALUES(?,?,?,?)")
        .run(
          task.id,
          resolveWorkspaceKey(task),
          task.status,
          JSON.stringify(workTaskSchema.parse(task)),
        );
      recordWorkTaskChange(this.database(), task, "created");
      return task;
    });
  }
  update(input: WorkTaskUpdate): WorkTask {
    return this.transaction(() => {
      const task = this.get(input, input.id);
      if (task.stopPending || !["todo", "failed"].includes(task.status))
        throw new Error("work-task.not-editable");
      assertWorkTaskWorkspaceEditable(task, input);
      return this.write(
        {
          ...task,
          ...input,
          sourceBranch: input.sourceBranch,
          useWorktree: input.useWorktree,
          promptEditorState: input.promptEditorState,
          runText: input.prompt,
          runUsesPromptAssets: true,
          updatedAt: Date.now(),
        },
        "edited",
      );
    });
  }
  private enqueueInside(scope: WorkTaskScope, id: string, feedback?: string): WorkTask {
    const row = this.row(scope, id);
    const task = decode(row);
    if (isWorkTaskMerging(task)) throw new Error("work-task.merge-in-progress");
    if (task.status === "queued" || WORK_TASK_ACTIVE_STATUSES.includes(task.status)) return task;
    if (
      row.owner ||
      task.archived ||
      !["todo", "failed", "canceled", "review"].includes(task.status)
    )
      throw new Error("work-task.not-startable");
    if (task.status === "review" && !feedback) throw new Error("work-task.feedback-required");
    appendWorkTaskQueue(this.database(), id);
    return this.write(
      {
        ...task,
        status: "queued",
        ...workTaskRunPrompt(task, feedback),
        failureReason: undefined,
        merge: undefined,
        updatedAt: Date.now(),
      },
      "queued",
    );
  }
  enqueue(scope: WorkTaskScope, id: string, feedback?: string): WorkTask {
    return this.transaction(() => this.enqueueInside(scope, id, feedback));
  }
  enqueueMerge(input: WorkTaskMergeRequest, projectPath: string): WorkTask {
    return this.transaction(() => {
      const { id, targetBranch } = input;
      const row = this.row(input, id);
      const task = decode(row);
      if (row.owner && task.merge && ["applying", "merged"].includes(task.merge.phase))
        throw new Error("work-task.merge-applying");
      if (isWorkTaskMerging(task)) {
        if (task.merge?.targetBranch !== targetBranch)
          throw new Error("work-task.merge-in-progress");
        return task;
      }
      if (task.completion === "merged" && task.merge?.targetBranch === targetBranch) return task;
      if (
        task.status !== "review" ||
        task.archived ||
        task.stopPending ||
        row.owner ||
        !task.worktree
      )
        throw new Error("work-task.not-reviewable");
      if (task.worktree.branchName === targetBranch)
        throw new Error("work-task.merge-invalid-target");
      appendWorkTaskQueue(this.database(), id);
      const merge: WorkTaskMerge = { id: uuidv7(), projectPath, targetBranch, phase: "queued" };
      return this.write(
        { ...task, merge, status: "queued", failureReason: undefined, updatedAt: Date.now() },
        "merge-queued",
      );
    });
  }
  enqueueAll(scope: WorkTaskScope) {
    this.transaction(() => {
      for (const task of this.list(scope)
        .filter((task) => task.status === "todo")
        .sort((a, b) => a.createdAt - b.createdAt))
        this.enqueueInside(scope, task.id);
    });
  }
  claimNext(owner: string, now: number, leaseMs: number): WorkTask | null {
    // 同一事务内认领任务并检查合并目标锁，避免跨窗口重复执行或并发发布同一目标。
    return this.transaction(() => claimNextWorkTask(this.database(), owner, now, leaseMs));
  }
  updateRun(task: WorkTask, owner: string, patch: WorkTaskExecutionUpdate): boolean {
    return this.transaction(() => {
      const row = this.row(task, task.id);
      const current = decode(row);
      if (
        row.owner !== owner ||
        current.runSeq !== task.runSeq ||
        !WORK_TASK_ACTIVE_STATUSES.includes(current.status) ||
        (row.lease_until ?? 0) <= Date.now()
      )
        return false;
      if (patch.session && patch.session.kind !== current.execution.kind)
        throw new Error("work-task.binding-invalid");
      if (
        patch.merge &&
        (patch.merge.id !== current.merge?.id ||
          (patch.merge.session && patch.merge.session.kind !== current.execution.kind))
      )
        throw new Error("work-task.binding-invalid");
      // 流式帧会重复投影 running；无变化时仍确认所有权，但不刷排序时间和事件。
      if (
        Object.entries(patch).every(([key, value]) =>
          isDeepStrictEqual(current[key as keyof WorkTask], value),
        )
      )
        return true;
      this.write({ ...current, ...patch, updatedAt: Date.now() }, "execution-updated");
      return true;
    });
  }
  finish(task: WorkTask, owner: string, error?: string) {
    this.transaction(() => {
      const row = this.row(task, task.id);
      const current = decode(row);
      if (row.owner !== owner || current.runSeq !== task.runSeq) return;
      const now = Date.now();
      const next = finishWorkTaskRun(current, task, {
        error,
        leaseExpired: (row.lease_until ?? 0) <= now,
        now,
      });
      this.write(next.task, next.type, null);
    });
  }
  cancel(scope: WorkTaskScope, id: string): WorkTask {
    return this.transaction(() => {
      const row = this.row(scope, id);
      const task = decode(row);
      if (row.owner && task.merge && ["applying", "merged"].includes(task.merge.phase))
        throw new Error("work-task.merge-applying");
      if (isWorkTaskMerging(task)) {
        if (task.merge?.phase === "applying") throw new Error("work-task.merge-applying");
        return this.write(
          {
            ...task,
            status: "review",
            merge: { ...task.merge!, phase: "canceled" },
            stopPending: !!row.owner,
            updatedAt: Date.now(),
          },
          "merge-canceled",
        );
      }
      if (task.status === "canceled") return task;
      if (!WORK_TASK_ACTIVE_STATUSES.includes(task.status) && task.status !== "queued")
        throw new Error("work-task.not-cancelable");
      return this.write(
        { ...task, status: "canceled", stopPending: !!row.owner, updatedAt: Date.now() },
        "canceled",
      );
    });
  }
  complete(scope: WorkTaskScope, id: string): WorkTask {
    return this.transaction(() => {
      const task = this.get(scope, id);
      if (task.status !== "review" || task.stopPending || isWorkTaskMerging(task))
        throw new Error("work-task.not-reviewable");
      return this.write(
        { ...task, status: "done", completion: "accepted_without_merge", updatedAt: Date.now() },
        "accepted",
      );
    });
  }
  archive(scope: WorkTaskScope, id: string, archived: boolean): WorkTask {
    return this.transaction(() => {
      const task = this.get(scope, id);
      if (
        task.stopPending ||
        task.status === "queued" ||
        WORK_TASK_ACTIVE_STATUSES.includes(task.status)
      )
        throw new Error("work-task.active-cannot-archive");
      return this.write(
        { ...task, archived, updatedAt: Date.now() },
        archived ? "archived" : "unarchived",
      );
    });
  }
  /** Preserve legacy settings without imposing a project execution limit. */
  setConcurrency(scope: WorkTaskScope, concurrency: number) {
    this.database()
      .prepare(
        "INSERT INTO work_task_projects(workspace_key,concurrency,revision) VALUES(?,?,1) ON CONFLICT(workspace_key) DO UPDATE SET concurrency=excluded.concurrency,revision=revision+1",
      )
      .run(resolveWorkspaceKey(scope), concurrency);
  }
  renew(task: WorkTask, owner: string, now: number, leaseMs: number): boolean {
    const row = this.row(task, task.id);
    const current = decode(row);
    if (
      row.owner !== owner ||
      current.runSeq !== task.runSeq ||
      !WORK_TASK_ACTIVE_STATUSES.includes(current.status) ||
      (row.lease_until ?? 0) <= now
    )
      return false;
    this.database()
      .prepare("UPDATE work_tasks SET lease_until=? WHERE id=? AND owner=? AND lease_until>?")
      .run(now + leaseMs, task.id, owner, now);
    return true;
  }
  recoverExpired(now: number) {
    this.transaction(() => {
      const rows = this.database()
        .prepare(
          "SELECT data,owner,lease_until FROM work_tasks WHERE owner IS NOT NULL AND lease_until<=?",
        )
        .all(now) as unknown as Row[];
      for (const row of rows) {
        const task = decode(row);
        this.write(interruptWorkTaskRun(task, now, false), "host-interrupted", null);
      }
    });
  }
  interruptOwned(owner: string) {
    this.transaction(() => {
      const rows = this.database()
        .prepare("SELECT data,owner,lease_until FROM work_tasks WHERE owner=?")
        .all(owner) as unknown as Row[];
      for (const row of rows) {
        const task = decode(row);
        this.write(interruptWorkTaskRun(task, Date.now(), true), "host-stopping");
      }
    });
  }
  events(scope: WorkTaskScope, id: string): WorkTaskEvent[] {
    this.row(scope, id);
    const rows = this.database()
      .prepare(
        "SELECT sequence, task_id AS taskId, run_seq AS runSeq, at, type, message FROM work_task_events WHERE task_id=? ORDER BY sequence DESC LIMIT 100",
      )
      .all(id) as unknown as WorkTaskEvent[];
    return rows.reverse();
  }
}
