import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { saveWorkflowToolEntry } from "../../core/src/tool/handlers/save-workflow.js";
import { prepareWorkflowSaveOp, saveWorkflowOp } from "../src/zcode-protocol/workflow-authoring.js";
import { getSavedWorkflowOp, listSavedWorkflowsOp } from "../src/zcode-protocol/saved-workflows.js";

const context = {} as Parameters<typeof prepareWorkflowSaveOp>[0];

test("ACP authoring freezes the approved draft and is visible through management list/get", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-authoring-"));
  const workspace = { workspacePath: directory, workspaceKey: directory };
  const draft = join(directory, "draft.ts");
  try {
    await writeFile(draft, "return 42;");
    const prepared = await prepareWorkflowSaveOp(context, {
      workspace,
      input: {
        name: "release",
        description: "Release checks",
        scope: "project",
        script_path: draft,
      },
    });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.input.overwrite, false);
    await writeFile(draft, "throw new Error('changed after approval');");
    const saved = await saveWorkflowOp(context, { workspace, input: prepared.input });
    assert.equal(saved.ok, true);
    assert.equal(saved.overwritten, false);
    const listed = await listSavedWorkflowsOp(context, { workspace });
    assert.equal(listed.workflows[0]?.name, "release");
    assert.equal(listed.invalid.length, 0);
    const read = await getSavedWorkflowOp(context, { workspace, name: "release" });
    assert.equal(read.ok && read.script.trim(), "return 42;");
    const again = await prepareWorkflowSaveOp(context, {
      workspace,
      input: { name: "release", description: "Updated", scope: "project", script: "return 43;" },
    });
    assert.equal(again.input.overwrite, true);
    assert.equal(
      (await saveWorkflowOp(context, { workspace, input: again.input })).overwritten,
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("authoring rejects invalid sources/names and returns diagnostics without writing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-authoring-invalid-"));
  const workspace = { workspacePath: directory, workspaceKey: directory };
  const input = { name: "release", description: "Checks", scope: "project", script: "return 42;" };
  try {
    for (const invalid of [
      { ...input, name: "../escape" },
      { ...input, script_path: "draft.ts" },
      { ...input, scope: undefined },
      { ...input, path: join(directory, "escape.ts") },
    ]) {
      await assert.rejects(prepareWorkflowSaveOp(context, { workspace, input: invalid }));
    }
    const prepared = await prepareWorkflowSaveOp(context, {
      workspace,
      input: { ...input, script: "return missingWorkflowVariable;" },
    });
    assert.equal(prepared.ok, false);
    assert.ok(prepared.diagnostics.length > 0);
    assert.equal((await saveWorkflowOp(context, { workspace, input: prepared.input })).ok, false);
    await assert.rejects(readFile(prepared.input.path!), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("global authoring uses the Agent home and remains visible from another project", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-authoring-global-"));
  t.mock.method(os, "homedir", () => directory);
  syncBuiltinESMExports();
  const workspace = { workspacePath: join(directory, "project-a"), workspaceKey: "project-a" };
  try {
    const prepared = await prepareWorkflowSaveOp(context, {
      workspace,
      input: {
        name: "release",
        description: "Release checks",
        scope: "global",
        script: "return args.version;",
        args: { version: { type: "string", required: true } },
        whenToUse: "Before release",
      },
    });
    assert.equal(prepared.input.path, join(directory, ".zcode/workflows/release.dwf.ts"));
    assert.equal((await saveWorkflowOp(context, { workspace, input: prepared.input })).ok, true);
    const elsewhere = { workspacePath: join(directory, "project-b"), workspaceKey: "project-b" };
    const listed = await listSavedWorkflowsOp(context, { workspace: elsewhere, scope: "global" });
    assert.equal(listed.workflows[0]?.scope, "global");
    assert.equal(listed.workflows[0]?.args?.version?.required, true);
    assert.equal(
      (await listSavedWorkflowsOp(context, { workspace: elsewhere })).workflows.length,
      0,
    );
    const project = await prepareWorkflowSaveOp(context, {
      workspace,
      input: {
        name: "release",
        description: "Project checks",
        scope: "project",
        script: "return 42;",
      },
    });
    await saveWorkflowOp(context, { workspace, input: project.input });
    await writeFile(prepared.input.path, "broken global definition");
    const combined = await listSavedWorkflowsOp(context, { workspace, includeGlobal: true });
    assert.equal(combined.workflows.length, 1);
    assert.equal(combined.workflows[0]?.scope, "project");
    assert.equal(
      combined.invalid.length,
      0,
      "a valid project definition hides its broken global namesake",
    );
    assert.equal(
      (await listSavedWorkflowsOp(context, { workspace: elsewhere, includeGlobal: true })).invalid
        .length,
      1,
    );
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the original API SaveWorkflow tool still accepts script_path through its normal lifecycle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-api-save-"));
  try {
    await writeFile(join(directory, "draft.ts"), "return 42;");
    const input = {
      name: "release",
      description: "API checks",
      scope: "project",
      script_path: "draft.ts",
    };
    assert.equal(saveWorkflowToolEntry.validateInput!(input, {}).result, true);
    const resolved = await saveWorkflowToolEntry.resolveInput!(input, {
      workingDirectory: directory,
    });
    assert.equal(resolved.result, true);
    if (!resolved.result) return;
    const output = await saveWorkflowToolEntry.handler(resolved.input, {
      workingDirectory: directory,
    } as Parameters<typeof saveWorkflowToolEntry.handler>[1]);
    assert.equal((output as { ok: boolean }).ok, true);
    const listed = await listSavedWorkflowsOp(context, {
      workspace: { workspacePath: directory, workspaceKey: directory },
    });
    assert.equal(listed.workflows[0]?.description, "API checks");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("approval to create cannot overwrite a definition created while permission was pending", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-save-conflict-"));
  const workspace = { workspacePath: directory, workspaceKey: directory };
  const input = { name: "release", description: "Checks", scope: "project", script: "return 42;" };
  try {
    const first = await prepareWorkflowSaveOp(context, { workspace, input });
    const second = await prepareWorkflowSaveOp(context, {
      workspace,
      input: { ...input, script: "return 43;" },
    });
    await saveWorkflowOp(context, { workspace, input: first.input });
    await assert.rejects(saveWorkflowOp(context, { workspace, input: second.input }), {
      code: "EEXIST",
    });
    const saved = await getSavedWorkflowOp(context, { workspace, name: "release" });
    assert.equal(saved.ok && saved.script.trim(), "return 42;");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
