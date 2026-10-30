import assert from "node:assert/strict";
import test from "node:test";
import { sessionSummarySchema, type ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { SessionsIndexProjection } from "./sessions-index-projection.js";

test("run start is derived from the latest turn and stays fixed through progress and background work", () => {
  const projection = new SessionsIndexProjection("workspace", "epoch");
  const snapshot = {
    sessionId: "session", meta: { title: "Task" },
    control: { phase: "running", sessionEnded: false },
    rows: { window: [{ kind: "turnHeader", startedAt: 100 }] },
    backgroundWorks: [], workflowRuns: [], pendingInteractions: [],
  } as unknown as ConversationSnapshot;
  const update = (lastActivityAt: number) => {
    projection.upsertFromConversation(snapshot, { createdAt: 10, lastActivityAt });
    return sessionSummarySchema.parse(projection.getSnapshot().sessions[0]);
  };
  assert.equal(update(200).turnStartedAt, 100);
  assert.equal(update(300).turnStartedAt, 100);
  snapshot.control.phase = "completedSuccess";
  snapshot.backgroundWorks.push({ workId: "bg", kind: "bash", title: "Background", status: "running", startedAt: 150, anchorRowId: null });
  assert.equal(update(400).turnStartedAt, 100);
  snapshot.rows.window.push({ kind: "turnHeader", startedAt: 500 } as ConversationSnapshot["rows"]["window"][number]);
  assert.equal(update(600).turnStartedAt, 500);
});
