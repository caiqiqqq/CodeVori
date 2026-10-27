import assert from "node:assert/strict";
import test from "node:test";
import { openFolderFromWorkspaceEntry } from "../src/root/openWorkspaceFolderEntry.ts";

test("multi-directory selection opens unique folders sequentially", async () => {
  const events: string[] = [];
  await openFolderFromWorkspaceEntry({
    selectDirectories: async () => ["/one", "/two", "/one", ""],
    onSelectProject: async (path) => {
      events.push(`start:${path}`);
      await Promise.resolve();
      events.push(`end:${path}`);
    },
  });
  assert.deepEqual(events, ["start:/one", "end:/one", "start:/two", "end:/two"]);
});

test("cancel and web browser leave local projects alone", async () => {
  const selected: string[] = [];
  await openFolderFromWorkspaceEntry({
    selectDirectories: async () => [],
    onSelectProject: (path) => selected.push(path),
  });
  let browserOpens = 0;
  await openFolderFromWorkspaceEntry({
    preferDirectoryBrowser: true,
    openDirectoryBrowser: () => browserOpens++,
    selectDirectories: async () => ["/ignored"],
    onSelectProject: (path) => selected.push(path),
  });
  assert.equal(browserOpens, 1);
  assert.deepEqual(selected, []);
});

test("single-directory platform fallback stays available", async () => {
  const selected: string[] = [];
  await openFolderFromWorkspaceEntry({
    selectDirectory: async () => "/fallback",
    onSelectProject: (path) => selected.push(path),
  });
  assert.deepEqual(selected, ["/fallback"]);
});

test("one failed folder does not prevent later folders from opening", async () => {
  const selected: string[] = [];
  await openFolderFromWorkspaceEntry({
    selectDirectories: async () => ["/failed", "/later"],
    onSelectProject: async (path) => {
      if (path === "/failed") throw new Error("unable to open");
      selected.push(path);
    },
  });
  assert.deepEqual(selected, ["/later"]);
});
