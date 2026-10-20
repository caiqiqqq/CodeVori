import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceTabState } from "../src/store/tabStore.ts";
import {
  getPluginScopeWorkspaceOptions,
  resolvePluginScopeWorkspaceOptions,
} from "../src/settings/pluginScopeWorkspaces.ts";

function tab(path: string, extra: Partial<WorkspaceTabState> = {}): WorkspaceTabState {
  return { id: path, kind: "workspace", workspacePath: path, label: "zcode", ...extra };
}

test("same identity appears once, while same-name paths remain selectable in order", () => {
  const options = resolvePluginScopeWorkspaceOptions(
    getPluginScopeWorkspaceOptions([
      tab("/projects/zcode"),
      tab("/projects/zcode", { id: "duplicate" }),
      tab("/worktrees/zcode"),
      tab("C:\\projects\\topology", { label: "topology" }),
    ]),
  );
  assert.deepEqual(
    options.map(({ key }) => key),
    ["/projects/zcode", "/worktrees/zcode", "C:\\projects\\topology"],
  );
  assert.deepEqual(
    options.map(({ description }) => description),
    ["/projects/zcode", "/worktrees/zcode", undefined],
  );
});

test("filter unavailable tabs before deduplication and preserve remote identity isolation", () => {
  const options = resolvePluginScopeWorkspaceOptions(
    getPluginScopeWorkspaceOptions([
      tab("/invalid/zcode", { availability: "unavailable-local-directory" }),
      tab("/projects/zcode", { workspaceIdentity: "ssh:host-a:/projects/zcode" }),
      tab("/projects/zcode", {
        workspaceIdentity: " ssh:host-a:/projects/zcode ",
        remoteSessionId: "session-a",
        remoteTarget: { kind: "ssh", host: "host-a.example.invalid", username: "tester" },
      }),
      tab("/projects/zcode", {
        workspaceIdentity: "ssh:host-a:/projects/zcode",
        remoteSessionId: "reconnected-a",
      }),
      tab("/projects/zcode", {
        workspaceIdentity: "ssh:host-b:/projects/zcode",
        remoteSessionId: "session-b",
      }),
      tab("/projects/zcode", { workspaceIdentity: "  " }),
    ]),
  );
  assert.deepEqual(
    options.map(({ key }) => key),
    ["ssh:host-a:/projects/zcode", "ssh:host-b:/projects/zcode", "/projects/zcode"],
  );
  assert.match(options[0].description!, /host-a\.example\.invalid.*\/projects\/zcode/);
  assert.equal(options[1].description, "ssh:host-b:/projects/zcode");
  assert.equal(options[2].description, "/projects/zcode");
  assert.deepEqual(
    options.map(({ remote }) => remote),
    [true, true, false],
  );
});

test("explicit options deduplicate by key and disambiguate only after deduplication", () => {
  const options = resolvePluginScopeWorkspaceOptions([
    { key: "a", label: "default", description: "/projects/default" },
    { key: "a", label: "default", description: "/ignored" },
    { key: "b", label: "iot-forway", description: "/projects/iot-forway" },
    { key: "c", label: "iot-forway" },
  ]);
  assert.deepEqual(options, [
    { key: "a", label: "default", description: undefined },
    { key: "b", label: "iot-forway", description: "/projects/iot-forway" },
    { key: "c", label: "iot-forway", description: "c" },
  ]);
});
