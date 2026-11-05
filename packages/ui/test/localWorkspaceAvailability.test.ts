import assert from "node:assert/strict";
import test from "node:test";
import { appSettingsSchema } from "@zcode/shared";
import { resolveUnavailableLocalWorkspacePaths } from "../src/root/localWorkspaceAvailability.js";
import { restorePersistedRemoteWorkspaceSessions } from "../src/root/remoteWorkspaceSessionPersistence.js";
import { createTabStore, isWorkspaceTab } from "../src/store/tabStore.js";

const entries = appSettingsSchema.parse({
  lastWorkspaceSession: [
    { kind: "local", workspacePath: "/projects/zcode", workspacePurpose: "project" },
    { kind: "local", workspacePath: "/worktrees/519e/zcode", workspacePurpose: "project" },
    { kind: "local", workspacePath: "/worktrees/519e/zcode", workspacePurpose: "project" },
    { kind: "local", workspacePath: "/workspace/default", workspacePurpose: "conversation" },
  ],
}).lastWorkspaceSession;

test("restore checks every distinct local project and marks missing worktrees read-only", async () => {
  const checked: string[] = [];
  const missing = await resolveUnavailableLocalWorkspacePaths(entries, async (path) => {
    checked.push(path);
    if (path === "/worktrees/519e/zcode")
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return { type: "directory" };
  });
  assert.deepEqual(checked, ["/projects/zcode", "/worktrees/519e/zcode"]);
  assert.deepEqual([...missing], ["/worktrees/519e/zcode"]);
});

test("file paths are unavailable; transient stat errors do not discard history", async () => {
  const missing = await resolveUnavailableLocalWorkspacePaths(entries, async (path) => {
    if (path === "/projects/zcode") return { type: "file" };
    throw new Error("transport disconnected");
  });
  assert.deepEqual([...missing], ["/projects/zcode"]);
});

test("restored missing inactive project remains visible for history and is read-only", () => {
  const store = createTabStore(null);
  const settings = appSettingsSchema.parse({
    lastWorkspaceSession: entries,
    lastActiveTabIndex: 0,
  });
  restorePersistedRemoteWorkspaceSessions({
    settings,
    tabStoreApi: store,
    unavailableWorkspacePaths: new Set(["/worktrees/519e/zcode"]),
    conversationWorkspacePath: "/workspace/default",
  });
  const tabs = store.getState().tabs.filter(isWorkspaceTab);
  assert.equal(
    tabs.find((tab) => tab.workspacePath === "/projects/zcode")?.availability,
    undefined,
  );
  assert.equal(
    tabs.find((tab) => tab.workspacePath === "/worktrees/519e/zcode")?.availability,
    "unavailable-local-directory",
  );
  assert.equal(tabs.filter((tab) => tab.workspacePath === "/worktrees/519e/zcode").length, 1);
});
