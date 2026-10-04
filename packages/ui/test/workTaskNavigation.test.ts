import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTaskNavigationHistory,
  pushNavEntry,
  pushWorkTasksNavEntry,
  goBack,
  goForward,
  removeTaskFromHistory,
} from "../src/lib/taskNavigationHistory.js";
import {
  columnForWorkTaskStatus,
  filterWorkTasks,
  groupWorkTasksByColumn,
  WORK_TASK_COLUMNS,
} from "../src/lib/workTaskBoard.js";
import { workTaskStatusSchema, type WorkTask } from "@zcode/shared";

test("work tasks participate in existing navigation without changing conversation history", () => {
  let history = pushNavEntry(createTaskNavigationHistory(), "/project", "session");
  history = pushWorkTasksNavEntry(history, "/project");
  assert.equal(pushWorkTasksNavEntry(history, "/project"), history);
  assert.equal(goBack(history)?.entry.kind, "task");
  assert.equal(goForward(goBack(history)!.history)?.entry.kind, "work-tasks");
  assert.equal(removeTaskFromHistory(history, "session").entries[0]?.kind, "work-tasks");
});

test("board grouping preserves the filtered list order and assigns each task exactly once", () => {
  const tasks = workTaskStatusSchema.options.map((status, index) => ({
    id: String(index),
    status,
    archived: false,
    updatedAt: index,
  })) as WorkTask[];
  const filtered = filterWorkTasks(tasks, { showCanceled: true });
  const grouped = groupWorkTasksByColumn(filtered);
  assert.deepEqual(Object.keys(grouped), WORK_TASK_COLUMNS);
  for (const column of WORK_TASK_COLUMNS)
    assert.deepEqual(
      grouped[column],
      filtered.filter((task) => columnForWorkTaskStatus(task.status) === column),
    );
  assert.equal(Object.values(grouped).flat().length, tasks.length);
  assert.deepEqual(groupWorkTasksByColumn([]), {
    todo: [],
    inProgress: [],
    attention: [],
    done: [],
  });
});

test("every status has exactly one board column with canceled/archive filters", () => {
  assert.deepEqual(workTaskStatusSchema.options.map(columnForWorkTaskStatus), [
    "todo",
    "todo",
    "inProgress",
    "inProgress",
    "attention",
    "attention",
    "attention",
    "done",
    "done",
  ]);
  const tasks = [
    { id: "1", status: "canceled", archived: false, updatedAt: 1 },
    { id: "2", status: "done", archived: true, updatedAt: 2 },
    { id: "3", status: "review", archived: false, updatedAt: 3 },
  ] as WorkTask[];
  assert.deepEqual(
    filterWorkTasks(tasks, {}).map((task) => task.id),
    ["3"],
  );
  assert.deepEqual(
    filterWorkTasks(tasks, { showCanceled: true, includeArchived: true, column: "done" }).map(
      (task) => task.id,
    ),
    ["2", "1"],
  );
});
