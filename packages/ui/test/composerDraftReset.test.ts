import assert from "node:assert/strict";
import test from "node:test";
import {
  clearV4NewConversationDraftContent,
  persistV4ComposerDraft,
  readV4ComposerDraft,
  V4_DRAFT_SCOPE_ROOT,
} from "../src/v4/composer/composerDraftStore.js";

test("new conversation clears root and primary ACP bodies while preserving other scopes and config", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    },
  });

  const workspacePath = "/fixture/project";
  const workspaceIdentity = "remote:fixture";
  const mention = {
    id: "skill-1",
    category: "skills" as const,
    label: "Review",
    value: "review",
    markdown: "$review",
  };
  const selection = { providerId: "fixture-provider", modelId: "fixture-model" };
  const populatedDraft = {
    text: "unsent text",
    editorStateJson: '{"root":{}}',
    mention,
    mode: "build" as const,
    planEnabled: true,
    modelSelection: selection,
  };

  try {
    for (const scope of [
      V4_DRAFT_SCOPE_ROOT,
      "acp-draft:workspace-main:codex",
      "acp-draft:workspace-main:gemini",
      "acp-draft:pane-2:codex",
      "api-session-1",
      "acp:session-1",
    ]) {
      persistV4ComposerDraft(workspacePath, workspaceIdentity, scope, populatedDraft);
    }

    assert.equal(clearV4NewConversationDraftContent(workspacePath, workspaceIdentity), true);

    for (const scope of [
      V4_DRAFT_SCOPE_ROOT,
      "acp-draft:workspace-main:codex",
      "acp-draft:workspace-main:gemini",
    ]) {
      const cleared = readV4ComposerDraft(workspacePath, workspaceIdentity, scope);
      assert.ok(cleared);
      assert.equal(cleared.text, "");
      assert.equal(cleared.editorStateJson, undefined);
      assert.equal(cleared.mention, undefined);
      assert.equal(cleared.mode, "build");
      assert.equal(cleared.planEnabled, true);
      assert.deepEqual(cleared.modelSelection, selection);
    }

    for (const scope of ["acp-draft:pane-2:codex", "api-session-1", "acp:session-1"]) {
      const retained = readV4ComposerDraft(workspacePath, workspaceIdentity, scope);
      assert.ok(retained);
      assert.equal(retained.text, populatedDraft.text);
      assert.equal(retained.editorStateJson, populatedDraft.editorStateJson);
      assert.deepEqual(retained.mention, mention);
      assert.deepEqual(retained.modelSelection, selection);
    }
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
