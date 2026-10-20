import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_PANE_LAYOUT,
  paneBindingMatchesSession,
  splitPaneAtSide,
  V4_PRIMARY_PANE_ID,
} from "../src/v4/paneLayoutTree.js";
import { persistPaneLayout, readPersistedPaneLayout } from "../src/v4/paneLayoutPersistence.js";

test("ACP and native IDs cannot share a pane binding, and ACP split survives reload", () => {
  const workspaceScope = { workspacePath: "/tmp/example", workspaceIdentity: "remote:ssh:example" };
  const binding = {
    workspaceScope,
    sessionId: "same-id",
    kind: "acp" as const,
    agent: "codex" as const,
  };
  assert.equal(paneBindingMatchesSession(binding, workspaceScope, "same-id"), false);
  assert.equal(paneBindingMatchesSession(binding, workspaceScope, "same-id", "acp"), true);
  const layout = splitPaneAtSide(INITIAL_PANE_LAYOUT, V4_PRIMARY_PANE_ID, "right", binding);
  const values = new Map<string, string>();
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  try {
    persistPaneLayout(layout);
    const restored = readPersistedPaneLayout();
    const acp = Object.values(restored?.panes ?? {})[0];
    assert.equal(acp?.kind, "acp");
    assert.equal(acp?.agent, "codex");
    assert.equal(acp?.restoredUnvalidated, true);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previous });
  }
});
