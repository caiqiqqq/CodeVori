import assert from "node:assert/strict";
import test from "node:test";
import { updatePluginsSerially } from "../src/settings/pluginUpdateAll.ts";

test("batch updates once per plugin and continues after a failure", async () => {
  const calls: string[] = [];
  const result = await updatePluginsSerially(
    ["a", "b", "a", "c"],
    async (id) => {
      calls.push(id);
      if (id === "b") throw new Error("download failed");
      return true;
    },
    { isCurrent: () => true, needsUpdate: () => true },
  );
  assert.deepEqual(calls, ["a", "b", "c"]);
  assert.deepEqual(result, { succeeded: ["a", "c"], failed: ["b"], aborted: false });
});

test("switching authority during an update aborts the remaining batch", async () => {
  let current = true;
  const calls: string[] = [];
  const result = await updatePluginsSerially(
    ["a", "b"],
    async (id) => {
      calls.push(id);
      current = false;
      return true;
    },
    { isCurrent: () => current, needsUpdate: () => true },
  );
  assert.deepEqual(calls, ["a"]);
  assert.equal(result.aborted, true);
  assert.deepEqual(result.succeeded, []);
});

test("already updated or currently updating items are skipped", async () => {
  const calls: string[] = [];
  await updatePluginsSerially(
    ["a", "b"],
    async (id) => {
      calls.push(id);
      return true;
    },
    {
      isCurrent: () => true,
      needsUpdate: (id) => id === "b",
    },
  );
  assert.deepEqual(calls, ["b"]);
});
