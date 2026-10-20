import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkbenchConversationTabPresentation } from "../src/v4/workbenchConversationTabPresentation.js";

const labels = { newTask: "New task", untitled: "Untitled conversation" };
const snapshot = {
  sessionId: "native-a",
  meta: { title: "API conversation" },
  config: { provider: "bigmodel-api", model: "GLM-5.3" },
};

test("native tab uses the matching session title and provider model", () => {
  assert.deepEqual(
    resolveWorkbenchConversationTabPresentation({ sessionId: "native-a", snapshot, labels }),
    { title: "API conversation", model: "bigmodel-api/GLM-5.3" },
  );
});

test("a replaced session does not reuse the previous title or provider icon", () => {
  assert.deepEqual(
    resolveWorkbenchConversationTabPresentation({ sessionId: "native-b", snapshot, labels }),
    { title: labels.untitled },
  );
});

test("a native draft reads its own draft configuration, not an old snapshot", () => {
  assert.deepEqual(
    resolveWorkbenchConversationTabPresentation({
      sessionId: null,
      snapshot,
      draftConfig: { provider: "openai-api", model: "gpt-5" },
      labels,
    }),
    { title: labels.newTask, model: "openai-api/gpt-5" },
  );
});

test("ACP tabs use the selected agent and matching Host conversation title", () => {
  assert.deepEqual(
    resolveWorkbenchConversationTabPresentation({
      sessionId: null,
      acpAgent: "codex",
      acpSessionId: "host-a",
      acpSession: { id: "host-a", agent: "codex", title: "Codex conversation" },
      snapshot,
      labels,
    }),
    { title: "Codex conversation", agent: "codex" },
  );
});

test("switching ACP bindings cannot borrow the previous agent or conversation title", () => {
  assert.deepEqual(
    resolveWorkbenchConversationTabPresentation({
      sessionId: null,
      acpAgent: "claude",
      acpSessionId: "host-b",
      acpSession: { id: "host-a", agent: "codex", title: "Old Codex conversation" },
      labels,
    }),
    { title: "Claude ACP", agent: "claude" },
  );
  assert.deepEqual(
    resolveWorkbenchConversationTabPresentation({
      sessionId: null,
      acpAgent: "codex",
      acpSessionId: "host-b",
      acpSession: { id: "host-a", agent: "codex", title: "Old Codex conversation" },
      labels,
    }),
    { title: "Codex ACP", agent: "codex" },
  );
});

test("an ACP draft shows its agent before the Host creates a conversation", () => {
  assert.deepEqual(
    resolveWorkbenchConversationTabPresentation({ sessionId: null, acpAgent: "gemini", labels }),
    { title: "Gemini CLI", agent: "gemini" },
  );
});

test("a native draft with incomplete model configuration still has a usable tab", () => {
  assert.deepEqual(
    resolveWorkbenchConversationTabPresentation({
      sessionId: null,
      draftConfig: { provider: "openai-api" },
      labels,
    }),
    { title: labels.newTask },
  );
});

test("after consuming an ACP open request the tab follows the current agent and conversation", () => {
  assert.deepEqual(
    resolveWorkbenchConversationTabPresentation({
      sessionId: null,
      acpAgent: "claude",
      acpSession: { id: "new-host-session", agent: "claude", title: "Current Claude conversation" },
      labels,
    }),
    { title: "Current Claude conversation", agent: "claude" },
  );
});

test("switching back to API ignores retained ACP history and shows the current provider", () => {
  assert.deepEqual(
    resolveWorkbenchConversationTabPresentation({
      sessionId: null,
      acpAgent: null,
      acpSession: { id: "previous-acp-session", agent: "codex", title: "Previous Codex title" },
      draftConfig: { provider: "bigmodel-api", model: "GLM-5.3" },
      labels,
    }),
    { title: labels.newTask, model: "bigmodel-api/GLM-5.3" },
  );
});
