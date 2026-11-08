import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { transformWorkspaceFileSearchIgnore } from "../src/file/workspaceFileIgnore.js";

test("renamed ignore marker preserves existing custom rules", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "codevori-ignore-marker-"));
  try {
    await writeFile(join(workspace, ".gitignore"), "build/\n");
    await writeFile(
      join(workspace, ".codevoriignore"),
      [
        "old-sync/",
        "# ===== ↑ 以上同步自 .gitignore（「从 .gitignore 同步」只重写以上部分）=====",
        "node_modules/",
        "# ----- ↑ 以上为 ZCode 默认排除规则（自定义规则请写在本行下方，不会被同步/恢复改动）-----",
        "private-notes/",
        "",
      ].join("\n"),
    );

    const synced = await transformWorkspaceFileSearchIgnore(workspace, "sync-gitignore");
    assert.match(synced.content, /build\//);
    assert.doesNotMatch(synced.content, /old-sync\//);
    assert.match(synced.content, /private-notes\//);
    assert.match(synced.content, /CodeVori 默认排除规则/);

    const reset = await transformWorkspaceFileSearchIgnore(workspace, "reset-defaults");
    assert.match(reset.content, /private-notes\//);
    assert.match(reset.content, /CodeVori 默认排除规则/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
