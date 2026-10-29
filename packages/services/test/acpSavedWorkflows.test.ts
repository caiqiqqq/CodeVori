import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveWorkspaceKey, type NativeMcpServerRecord } from "@zcode/shared";
import { createAcpService } from "../src/acp/acpServiceImpl.js";
import {
  prepareWorkflowSaveOp,
  saveWorkflowOp,
} from "../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/workflow-authoring.js";
import { listSavedWorkflowsOp } from "../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/saved-workflows.js";

const context = {} as Parameters<typeof prepareWorkflowSaveOp>[0];

async function rpc(server: NativeMcpServerRecord, method: string, params?: unknown) {
  const env = server.config.env!;
  const response = await fetch(env.ZCODE_WORKFLOW_URL!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).result;
}

async function fixture(allow: boolean) {
  const directory = await mkdtemp(join(tmpdir(), "acp-saved-workflows-"));
  const target = {
    workspacePath: directory,
    workspaceIdentity: "remote:saved-workflow",
    remoteSessionId: "test-attachment",
  };
  const workspace = { ...target, workspaceKey: resolveWorkspaceKey(target) };
  const permissions: string[] = [];
  const routes: unknown[] = [];
  let server!: NativeMcpServerRecord;
  let request: { name: string; arguments: unknown };
  let result: Record<string, unknown>;
  let connections = 0;
  const service = createAcpService({
    directory: join(directory, "sessions"),
    savedWorkflows: {
      async prepareWorkflowSave(params) {
        routes.push(params);
        return prepareWorkflowSaveOp(context, { workspace, input: params.input });
      },
      async saveWorkflow(params) {
        routes.push(params);
        return saveWorkflowOp(context, { workspace, input: params.input });
      },
      async listSavedWorkflows(params) {
        routes.push(params);
        return listSavedWorkflowsOp(context, {
          workspace,
          scope: params.scope,
          includeGlobal: params.includeGlobal,
        });
      },
    },
    connect: async (input) => {
      connections++;
      server = input.workflowServers!.find((candidate) => candidate.name === "zcode-workflows")!;
      return {
        sessionId: "parent",
        configOptions: [],
        modeState: null,
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async cancel() {},
        close() {},
        async prompt() {
          result = await rpc(server, "tools/call", request);
        },
      };
    },
  });
  const answered = new Set<string>();
  const unsubscribe = service.onDynamicSessionChanged(target)((change) => {
    if (change.kind !== "updated" || !change.session.pendingPermission) return;
    const permission = change.session.pendingPermission;
    if (answered.has(permission.requestId)) return;
    answered.add(permission.requestId);
    permissions.push(permission.title);
    void service.decide({
      ...target,
      id: change.session.id,
      requestId: permission.requestId,
      optionId: allow ? "allow" : "reject",
    });
  });
  const session = await service.create({
    ...target,
    agent: "codex",
    requestId: crypto.randomUUID(),
  });
  return {
    directory,
    target,
    permissions,
    routes,
    server: () => server,
    async call(name: string, args: unknown = {}) {
      request = { name, arguments: args };
      await service.prompt({
        ...target,
        id: session.id,
        commandId: crypto.randomUUID(),
        text: "保存工作流",
        attachments: [],
        workspaceFiles: [],
      });
      return {
        error: result!.isError,
        value: JSON.parse((result!.content as Array<{ text: string }>)[0]!.text),
      };
    },
    async assertNoRun() {
      assert.equal(connections, 1);
      assert.equal(
        (await service.read({ ...target, id: session.id })).workflowRuns?.runs.length ?? 0,
        0,
      );
    },
    async close() {
      unsubscribe.dispose();
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

const input = {
  name: "release",
  description: "Release checks",
  scope: "project",
  script: "return 42;",
};

test("actual ACP MCP save approval writes a definition visible to management without starting a run", async () => {
  const f = await fixture(true);
  try {
    const catalog = await rpc(f.server(), "tools/list");
    const save = catalog.tools.find((tool: { name: string }) => tool.name === "SaveWorkflow");
    assert.ok(save.inputSchema.required.includes("scope"));
    assert.equal(save.inputSchema.additionalProperties, false);
    assert.match(save.description, /explicitly/);
    const instructions = await f.call("ReadWorkflowInstructions");
    assert.match(instructions.value.instructions, /does not save/);
    const result = await f.call("SaveWorkflow", input);
    assert.equal(result.value.ok, true);
    assert.equal(f.permissions.length, 1);
    assert.match(f.permissions[0]!, /release\.dwf\.ts/);
    assert.match(f.permissions[0]!, /"overwrite": false/);
    const listed = await f.call("ListSavedWorkflows");
    assert.equal(listed.value.workflows[0].name, "release");
    assert.equal(
      (await f.call("SaveWorkflow", { ...input, description: "Updated" })).value.overwritten,
      true,
    );
    assert.match(f.permissions[1]!, /"overwrite": true/);
    for (const route of f.routes as Array<Record<string, unknown>>) {
      assert.equal(route.workspaceIdentity, f.target.workspaceIdentity);
      assert.equal(route.remoteSessionId, f.target.remoteSessionId);
      assert.equal(route.workspacePath, f.target.workspacePath);
    }
    await f.assertNoRun();
  } finally {
    await f.close();
  }
});

test("ACP deny and malformed scripts never write or launch, and validation precedes permission", async () => {
  const f = await fixture(false);
  try {
    const rejected = await f.call("SaveWorkflow", input);
    assert.equal(rejected.value.status, "rejected");
    const broken = await f.call("SaveWorkflow", {
      ...input,
      script: "return unknownWorkflowValue;",
    });
    assert.equal(broken.value.ok, false);
    assert.ok(broken.value.diagnostics.length > 0);
    assert.equal(f.permissions.length, 1);
    for (const invalid of [
      { ...input, name: "../escape" },
      { ...input, script_path: "draft.ts" },
      { ...input, workspacePath: "/other" },
    ]) {
      assert.equal((await f.call("SaveWorkflow", invalid)).error, true);
    }
    await assert.rejects(readFile(join(f.directory, ".zcode/workflows/release.dwf.ts")), {
      code: "ENOENT",
    });
    await f.assertNoRun();
  } finally {
    await f.close();
  }
});
