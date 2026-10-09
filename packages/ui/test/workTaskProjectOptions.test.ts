import assert from "node:assert/strict";
import test from "node:test";
import { workTaskProjectOptions } from "../src/lib/workTaskProjectOptions.js";
import type { WorkspaceTabState } from "../src/store/tabStore.js";

const tab = (path: string, identity?: string): WorkspaceTabState => ({
  id: identity || path,
  kind: "workspace",
  workspacePath: path,
  workspaceIdentity: identity,
  label: "iot-forway",
});
test("duplicate identity is removed, while same-name paths and remote identities stay distinguishable", () => {
  const local = tab("/projects/iot-forway");
  const other = tab("/other/iot-forway");
  const remote = tab(local.workspacePath, "remote-a");
  const options = workTaskProjectOptions([local, { ...local }, other, remote]);
  assert.equal(options.length, 3);
  assert.equal(options[0]!.description, local.workspacePath);
  assert.equal(options[1]!.description, other.workspacePath);
  assert.equal(options[2]!.description, `${remote.workspacePath} · remote-a`);
});
test("a single project retains its compact label", () => {
  assert.equal(workTaskProjectOptions([tab("/projects/iot-forway")])[0]!.description, undefined);
});
