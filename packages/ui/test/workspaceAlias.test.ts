import assert from "node:assert/strict";
import test from "node:test";
import {
  appSettingsPatchSchema,
  appSettingsSchema,
} from "../../shared/src/validationAppSettings.js";
import { createTabStore, isWorkspaceTab } from "../src/store/tabStore.js";

test("legacy settings have no aliases and invalid display aliases are rejected", () => {
  assert.deepEqual(appSettingsSchema.parse({}).workspaceAliases, {});
  assert.deepEqual(
    appSettingsPatchSchema.parse({ workspaceAliases: { "/repo": " 前端 " } }).workspaceAliases,
    { "/repo": "前端" },
  );
  for (const alias of ["a/b", "a\\b", "a\u0000b", "a\nb", "a".repeat(201)]) {
    assert.equal(
      appSettingsPatchSchema.safeParse({ workspaceAliases: { "/repo": alias } }).success,
      false,
    );
  }
  assert.equal(
    appSettingsPatchSchema.safeParse({ workspaceAliases: { "/repo": "" } }).success,
    true,
  );
});

test("aliases isolate identical remote paths, preserve routing and clear to folder name", () => {
  const store = createTabStore(null);
  store.getState().addTab("/repo");
  store.getState().addTab("/repo", { workspaceIdentity: "remote:a:/repo" });
  store.getState().addTab("/repo", { workspaceIdentity: "remote:b:/repo" });
  const before = store.getState();
  const scope = before.tabs
    .filter(isWorkspaceTab)
    .map(({ id, workspacePath, workspaceIdentity }) => ({ id, workspacePath, workspaceIdentity }));
  store.getState().applyWorkspaceAliases({
    "/repo": "本地",
    "remote:a:/repo": "远端 A",
    "remote:b:/repo": "远端 B",
  });
  assert.deepEqual(
    store
      .getState()
      .tabs.filter(isWorkspaceTab)
      .map((tab) => tab.label),
    ["远端 B", "远端 A", "本地"],
  );
  assert.deepEqual(
    store
      .getState()
      .tabs.filter(isWorkspaceTab)
      .map(({ id, workspacePath, workspaceIdentity }) => ({
        id,
        workspacePath,
        workspaceIdentity,
      })),
    scope,
  );
  assert.equal(store.getState().activeTabId, before.activeTabId);
  const projected = store.getState();
  store.getState().applyWorkspaceAliases({
    "/repo": "本地",
    "remote:a:/repo": "远端 A",
    "remote:b:/repo": "远端 B",
  });
  assert.equal(store.getState(), projected, "equivalent projection must not trigger a render loop");
  store.getState().applyWorkspaceAliases({ "/repo": "本地", "remote:b:/repo": "远端 B" });
  assert.deepEqual(
    store
      .getState()
      .tabs.filter(isWorkspaceTab)
      .map((tab) => tab.label),
    ["远端 B", "repo", "本地"],
  );
});

test("restored and newly opened tabs read the current alias projection", () => {
  const store = createTabStore(null);
  store.getState().restoreTabs(["C:\\projects\\frontend"], 0);
  store.getState().completeTabRestore(["C:\\projects\\frontend", "/other"]);
  store.getState().applyWorkspaceAliases({ "C:\\projects\\frontend": "主站", "/other": "服务端" });
  assert.deepEqual(
    store
      .getState()
      .tabs.filter(isWorkspaceTab)
      .map((tab) => tab.label),
    ["主站", "服务端"],
  );
  store.getState().closeTab(store.getState().tabs[0]!.id);
  store.getState().addTab("C:\\projects\\frontend");
  store.getState().applyWorkspaceAliases({ "C:\\projects\\frontend": "主站" });
  assert.equal(store.getState().tabs[0]!.label, "主站");
});
