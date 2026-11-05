import assert from "node:assert/strict";
import test from "node:test";
import { appSettingsSchema } from "@zcode/shared";
import { resolveLocalWorkspaceAvailability } from "../src/root/localWorkspaceAvailability.js";
import {
  buildRemoteWorkspacePersistPatch,
  restorePersistedRemoteWorkspaceSessions,
} from "../src/root/remoteWorkspaceSessionPersistence.js";
import { createTabStore, isWorkspaceTab } from "../src/store/tabStore.js";

const entries = appSettingsSchema.parse({
  lastWorkspaceSession: [
    { kind: "local", workspacePath: "/projects/zcode", workspacePurpose: "project" },
    { kind: "local", workspacePath: "/worktrees/519e/zcode", workspacePurpose: "project" },
    { kind: "local", workspacePath: "/worktrees/519e/zcode", workspacePurpose: "project" },
    { kind: "local", workspacePath: "/workspace/default", workspacePurpose: "conversation" },
  ],
}).lastWorkspaceSession;

test("restore checks every distinct local project and identifies missing worktrees", async () => {
  const checked: string[] = [];
  const availability = await resolveLocalWorkspaceAvailability(entries, async (path) => {
    checked.push(path);
    if (path === "/worktrees/519e/zcode")
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return { type: "directory" };
  });
  assert.deepEqual(checked, ["/projects/zcode", "/worktrees/519e/zcode"]);
  assert.deepEqual([...availability.missingPaths], ["/worktrees/519e/zcode"]);
  assert.deepEqual([...availability.unavailablePaths], []);
});

test("file paths are removed; permission errors remain read-only; transient errors retain history", async () => {
  const availability = await resolveLocalWorkspaceAvailability(entries, async (path) => {
    if (path === "/projects/zcode") return { type: "file" };
    throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
  });
  assert.deepEqual([...availability.missingPaths], ["/projects/zcode"]);
  assert.deepEqual([...availability.unavailablePaths], ["/worktrees/519e/zcode"]);

  const transient = await resolveLocalWorkspaceAvailability(entries, async () => {
    throw new Error("transport disconnected");
  });
  assert.deepEqual([...transient.missingPaths], []);
  assert.deepEqual([...transient.unavailablePaths], []);
});

test("restored missing inactive project is absent from the persisted window projection", () => {
  const store = createTabStore(null);
  const settings = appSettingsSchema.parse({
    lastWorkspaceSession: entries,
    lastActiveTabIndex: 0,
  });
  restorePersistedRemoteWorkspaceSessions({
    settings,
    tabStoreApi: store,
    missingWorkspacePaths: new Set(["/worktrees/519e/zcode"]),
    conversationWorkspacePath: "/workspace/default",
  });
  const tabs = store.getState().tabs.filter(isWorkspaceTab);
  assert.equal(
    tabs.find((tab) => tab.workspacePath === "/projects/zcode")?.availability,
    undefined,
  );
  assert.equal(
    tabs.some((tab) => tab.workspacePath === "/worktrees/519e/zcode"),
    false,
  );
  assert.deepEqual(
    buildRemoteWorkspacePersistPatch(store.getState(), []).lastWorkspaceSession?.map(
      (entry) => entry.workspacePath,
    ),
    ["/projects/zcode", "/workspace/default"],
  );
});

test("missing active project falls back to an existing workspace", () => {
  const store = createTabStore(null);
  const settings = appSettingsSchema.parse({
    lastWorkspaceSession: entries,
    lastActiveTabIndex: 1,
  });
  restorePersistedRemoteWorkspaceSessions({
    settings,
    tabStoreApi: store,
    missingWorkspacePaths: new Set(["/worktrees/519e/zcode"]),
    conversationWorkspacePath: "/workspace/default",
  });
  assert.equal(store.getState().activeWorkspacePath, "/projects/zcode");
});

test("inaccessible local project remains a read-only history entry", () => {
  const store = createTabStore(null);
  restorePersistedRemoteWorkspaceSessions({
    settings: appSettingsSchema.parse({ lastWorkspaceSession: entries }),
    tabStoreApi: store,
    unavailableWorkspacePaths: new Set(["/worktrees/519e/zcode"]),
    conversationWorkspacePath: "/workspace/default",
  });
  const tabs = store.getState().tabs.filter(isWorkspaceTab);
  assert.equal(
    tabs.find((tab) => tab.workspacePath === "/worktrees/519e/zcode")?.availability,
    "unavailable-local-directory",
  );
});

test("active-first completion restores all valid projects without resurrecting the missing one", () => {
  const store = createTabStore(null);
  const settings = appSettingsSchema.parse({
    lastWorkspaceSession: [
      ...entries,
      { kind: "local", workspacePath: "/projects/other", workspacePurpose: "project" },
    ],
    lastActiveTabIndex: 0,
  });
  const result = restorePersistedRemoteWorkspaceSessions({
    settings,
    tabStoreApi: store,
    missingWorkspacePaths: new Set(["/worktrees/519e/zcode"]),
    conversationWorkspacePath: "/workspace/default",
    restoreMode: "active-first",
  });
  assert.deepEqual(
    store
      .getState()
      .tabs.filter(isWorkspaceTab)
      .map((tab) => tab.workspacePath),
    ["/projects/zcode"],
  );
  result?.deferredRestore?.();
  assert.deepEqual(
    buildRemoteWorkspacePersistPatch(store.getState(), []).lastWorkspaceSession?.map(
      (entry) => entry.workspacePath,
    ),
    ["/projects/zcode", "/workspace/default", "/projects/other"],
  );
});
