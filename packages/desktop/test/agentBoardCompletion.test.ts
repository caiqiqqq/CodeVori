import test from "node:test";
import assert from "node:assert/strict";
import { createWindowHostControllerProjection } from "../src/host/windowHostControllerProjection.js";
import type { ZCodeTaskMeta } from "@zcode/shared";

test("Controller checks actual activity and exact remote source before admitting board completion", async () => {
  let id = 0;
  const projection = createWindowHostControllerProjection({ createId: () => String(++id) });
  const a = {
    kind: "remote" as const,
    workspacePath: "/same",
    workspaceIdentity: "remote:a",
    remoteSessionId: "a",
  };
  const b = { ...a, workspaceIdentity: "remote:b", remoteSessionId: "b" };
  const calls: string[] = [];
  for (const scope of [a, b])
    projection.registerSource({
      scope,
      mutate: () => {
        calls.push(scope.workspaceIdentity);
      },
    });
  const meta: ZCodeTaskMeta = {
    taskId: "same",
    traceId: "fixture",
    title: "Test",
    workspacePath: "/same",
    createdAt: 1,
    updatedAt: 100,
    mode: "guarded",
    status: "completed",
  };
  const snapshot = (
    scope: typeof a,
    liveStatus: "running" | "waiting" | "completed",
    updatedAt = 100,
    background = false,
  ) =>
    projection.replaceSourceSnapshot({
      scope,
      taskIndex: [
        {
          meta: { ...meta, workspaceIdentity: scope.workspaceIdentity },
          membership: { pinned: false, archived: false, active: false },
        },
      ],
      sessionsIndex: [
        {
          taskId: "same",
          liveStatus,
          updatedAt,
          ...(background
            ? { activity: { phase: "completedSuccess", hasBackgroundWork: true } as any }
            : {}),
        },
      ],
    });
  snapshot(a, "completed");
  snapshot(b, "completed");
  const address = {
    workspacePath: a.workspacePath,
    workspaceIdentity: a.workspaceIdentity,
    remoteSessionId: a.remoteSessionId,
    taskId: "same",
  };
  const mutation = { kind: "board-completion" as const, completed: true, expectedUpdatedAt: 100 };
  await assert.rejects(projection.mutate({ ...address, remoteSessionId: "b" }, mutation));
  for (const status of ["running", "waiting"] as const) {
    snapshot(a, status);
    await assert.rejects(projection.mutate(address, mutation));
  }
  snapshot(a, "completed", 100, true);
  await assert.rejects(projection.mutate(address, mutation));
  snapshot(a, "completed", 200);
  await assert.rejects(projection.mutate(address, mutation));
  await assert.rejects(projection.mutate(address, { ...mutation, expectedUpdatedAt: 300 }));
  await projection.mutate(address, { ...mutation, expectedUpdatedAt: 200 });
  assert.deepEqual(calls, ["remote:a"]);
  assert.equal(
    projection.getTasks().find((row) => row.address.workspaceIdentity === "remote:b")?.meta
      .boardCompletedAt,
    undefined,
  );
});
