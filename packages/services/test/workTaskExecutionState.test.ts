import assert from "node:assert/strict";
import { test } from "node:test";
import { commitWorkTaskExecution } from "../src/work-task/workTaskExecutionState.js";

test("cancellation during a declined state update wins over the ownership error", async () => {
  const abort = new AbortController();
  await assert.rejects(
    commitWorkTaskExecution(
      {
        signal: abort.signal,
        update: async () => {
          abort.abort();
          return false;
        },
      },
      { status: "running" },
    ),
    { name: "AbortError" },
  );
});

test("an already canceled execution does not write state", async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    commitWorkTaskExecution(
      { signal: abort.signal, update: async () => assert.fail("cannot update canceled run") },
      { status: "running" },
    ),
    { name: "AbortError" },
  );
});

test("an ownership loss without cancellation remains an explicit failure", async () => {
  await assert.rejects(
    commitWorkTaskExecution(
      { signal: new AbortController().signal, update: async () => false },
      { status: "running" },
    ),
    /work-task.ownership-lost/,
  );
});
