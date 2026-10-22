import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationNoticePresentationKey,
  useConversationWarningPresentationStore,
} from "../src/store/conversationWarningPresentationStore.ts";

test("warning admission is idempotent and dismissal survives re-entry", () => {
  const store = useConversationWarningPresentationStore;
  store.getState().begin("re-entry", "initial", true);
  const original = store.getState().presentations["re-entry"];
  assert.equal(original?.dismissed, false);
  store.getState().begin("re-entry", "progress", true);
  assert.equal(store.getState().presentations["re-entry"], original);
  store.getState().dismiss("re-entry");
  const dismissed = store.getState().presentations["re-entry"];
  store.getState().begin("re-entry", "progress", true);
  assert.equal(store.getState().presentations["re-entry"], dismissed);
  assert.equal(dismissed?.dismissed, true);
  store.getState().begin("new-incident", "progress", true);
  assert.equal(store.getState().presentations["new-incident"]?.dismissed, false);
  store.getState().begin("historical", "", false);
  assert.equal(store.getState().presentations["historical"]?.dismissed, true);
});

test("presentation scope isolates remote identity, session, turn and incident content", () => {
  const notice = { id: "incident", severity: "warning" as const, message: "same text" };
  const scope = {
    workspacePath: "/project",
    workspaceIdentity: " remote-a ",
    sessionKey: "session-a",
    turnId: "turn-a",
    notice,
  };
  const key = conversationNoticePresentationKey(scope);
  assert.equal(key, conversationNoticePresentationKey({ ...scope, workspaceIdentity: "remote-a" }));
  for (const changed of [
    { workspaceIdentity: "remote-b" },
    { sessionKey: "session-b" },
    { turnId: "turn-b" },
    { notice: { ...notice, id: "next-incident" } },
    { notice: { ...notice, message: "next warning" } },
    { notice: { ...notice, detail: "changed detail" } },
    { notice: { ...notice, severity: "error" as const } },
  ]) {
    assert.notEqual(key, conversationNoticePresentationKey({ ...scope, ...changed }));
  }
  assert.equal(
    conversationNoticePresentationKey({ ...scope, workspaceIdentity: " " }),
    conversationNoticePresentationKey({ ...scope, workspaceIdentity: undefined }),
  );
});
