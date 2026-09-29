import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeConfiguredWorktreeRoot,
  resolveDefaultWorktreeRoot,
  resolveWorktreeRootPath,
} from "../src/lib/worktree.js";

test("worktree defaults are derived from the host home directory", () => {
  assert.equal(resolveDefaultWorktreeRoot("/Users/example"), "/Users/example/.code/worktrees");
  assert.equal(
    resolveDefaultWorktreeRoot("C:\\Users\\example"),
    "C:\\Users\\example\\.code\\worktrees",
  );
  assert.equal(
    resolveWorktreeRootPath({
      homeDirectory: "/Users/example",
      workspacePath: "/Users/example/project",
    }),
    "/Users/example/.code/worktrees",
  );
});

test("new worktrees use the new default root without changing explicit old roots", () => {
  assert.equal(
    resolveWorktreeRootPath({
      configuredRoot: "/Users/example/.codex/worktrees",
      homeDirectory: "/Users/example",
      workspacePath: "/Users/example/project",
    }),
    "/Users/example/.codex/worktrees",
  );
});

test("configured roots expand home and resolve relative paths", () => {
  assert.equal(
    resolveWorktreeRootPath({
      configuredRoot: "~/trees",
      homeDirectory: "/Users/example",
      workspacePath: "/Users/example/project",
    }),
    "/Users/example/trees",
  );
  assert.equal(
    resolveWorktreeRootPath({
      configuredRoot: ".worktrees",
      homeDirectory: "/Users/example",
      workspacePath: "/Users/example/project",
    }),
    "/Users/example/project/.worktrees",
  );
});

test("a missing home directory blocks the implicit default instead of using a relative path", () => {
  assert.equal(
    resolveWorktreeRootPath({
      homeDirectory: "",
      workspacePath: "/Users/example/project",
    }),
    null,
  );
});

test("empty or default worktree roots clear the explicit setting", () => {
  const defaultRoot = "/Users/example/.code/worktrees";

  assert.equal(normalizeConfiguredWorktreeRoot("  ", defaultRoot), undefined);
  assert.equal(normalizeConfiguredWorktreeRoot(defaultRoot, defaultRoot), undefined);
  assert.equal(
    normalizeConfiguredWorktreeRoot("/Users/example/.codex/worktrees", defaultRoot),
    "/Users/example/.codex/worktrees",
  );
  assert.equal(
    normalizeConfiguredWorktreeRoot(" /Volumes/worktrees ", defaultRoot),
    "/Volumes/worktrees",
  );
});
