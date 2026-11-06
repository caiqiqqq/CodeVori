import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openProjectMemoryStore } from "@zcode/shared/node";
import { createProjectMemoryContext } from "../src/memory/projectMemoryContext.js";
import { createMemoryService } from "../src/memory/memoryService.js";
import { getZCodeDataRootDir, setDataBaseDir } from "../src/paths.js";
import { createAcpService } from "../src/acp/acpServiceImpl.js";
import type { NativeMcpServerRecord } from "@zcode/shared";

const fact = {
  name: "delegation-agent-routing",
  description: "委派规则",
  type: "feedback" as const,
  content: "用户要求委派时使用指定工具，保留当前主智能体。",
  expectedRevision: null,
};

test("project receipt, catalog, revision conflict, idempotent retry and future context share files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memory-contract-"));
  setDataBaseDir(directory);
  try {
    const cliStorageRoot = join(getZCodeDataRootDir(), "cli");
    const workspace = { workspacePath: join(directory, "workspace") };
    const store = await openProjectMemoryStore({ cliStorageRoot, ...workspace });
    const catalog = createMemoryService();
    let onChange: () => void = () => {};
    const subscription = catalog.onDynamicProjectMemoriesChanged()(() => onChange());
    await new Promise<void>((resolve) => {
      onChange = resolve;
    });
    const change = new Promise<void>((resolve) => {
      onChange = resolve;
    });
    const saved = await store.save(fact);
    assert.equal(saved.status, "saved");
    assert.equal(saved.workspaceId, await catalog.resolveProjectMemoryWorkspaceId(workspace));
    await Promise.race([
      change,
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("No catalog invalidation")), 3000);
        timer.unref();
      }),
    ]);
    subscription.dispose();
    const list = await catalog.listProjectMemories();
    assert.deepEqual(
      list[0]!.files.map((file) => file.name),
      ["MEMORY.md", "delegation-agent-routing.md"],
    );
    const read = await store.read({ name: fact.name });
    assert.equal(read.revision, saved.revision);
    assert.equal(
      (await store.save(fact)).revision,
      saved.revision,
      "same-content retry is idempotent",
    );
    const attempts = await Promise.allSettled([
      store.save({ ...fact, content: "规则更新一", expectedRevision: saved.revision }),
      store.save({ ...fact, content: "规则更新二", expectedRevision: saved.revision }),
    ]);
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assert.match(
      String(attempts.find((attempt) => attempt.status === "rejected")?.reason),
      /revision conflict/,
    );
    const index = (await store.read({})).content!;
    assert.equal(index.split("](" + fact.name + ".md)").length, 2);
    const context = createProjectMemoryContext({ cliStorageRoot, isEnabled: async () => true });
    assert.match((await context.buildPromptContext(workspace))!, /delegation-agent-routing.md/);
    assert.match(
      (
        await catalog.readProjectMemoryFile({
          workspaceId: saved.workspaceId,
          fileName: saved.fileName,
        })
      ).content,
      /规则更新/,
    );
    // 部分写入后的同内容重试修复索引，失败本身没有成功回执。
    await rm(join(store.root, "MEMORY.md"));
    await mkdir(join(store.root, "MEMORY.md"));
    await assert.rejects(store.save({ ...fact, name: "second-fact" }), /regular file/);
    await rm(join(store.root, "MEMORY.md"), { recursive: true });
    await store.save({ ...fact, name: "second-fact" });
    assert.match((await store.read({})).content!, /second-fact.md/);
  } finally {
    setDataBaseDir(null);
    await rm(directory, { recursive: true, force: true });
  }
});

test("project tools reject disabled, malformed, secret, linked and revoked writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memory-tool-guards-"));
  let enabled = false;
  const workspace = { workspacePath: directory };
  const context = createProjectMemoryContext({
    cliStorageRoot: join(directory, "cli"),
    isEnabled: async () => enabled,
  });
  const call = (name: string, args: unknown) =>
    context.tools!.call(workspace, name, args, () => {});
  try {
    await assert.rejects(call("SaveProjectMemory", fact), /disabled/);
    enabled = true;
    await assert.rejects(call("SaveProjectMemory", { ...fact, name: "../outside" }));
    await assert.rejects(call("SaveProjectMemory", { ...fact, expectedRevision: undefined }));
    await assert.rejects(call("SaveProjectMemory", { ...fact, type: "invalid" }));
    await assert.rejects(
      call("SaveProjectMemory", { ...fact, content: "password: example-value" }),
      /secret rejected/,
    );
    const store = await openProjectMemoryStore({
      cliStorageRoot: join(directory, "cli"),
      ...workspace,
    });
    const outside = join(directory, "outside.md");
    await writeFile(outside, "original");
    await symlink(outside, join(store.root, fact.name + ".md"));
    await assert.rejects(call("SaveProjectMemory", fact), /regular file/);
    assert.equal(await readFile(outside, "utf8"), "original");
    await assert.rejects(
      context.tools!.call(workspace, "SaveProjectMemory", fact, () => {
        throw new Error("revoked");
      }),
      /revoked/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function rpc(record: NativeMcpServerRecord, method: string, params?: unknown) {
  const env = record.config.env!;
  return fetch(env.ZCODE_WORKFLOW_URL!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

test("ACP provisions the real memory MCP, acknowledges disk writes, skips duplicate extraction and revokes access", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-memory-mcp-"));
  const workspace = { workspacePath: directory };
  const context = createProjectMemoryContext({
    cliStorageRoot: join(directory, "cli"),
    isEnabled: async () => true,
  });
  let record: NativeMcpServerRecord;
  let turn = 0;
  let extractions = 0;
  const service = createAcpService({
    directory: join(directory, "sessions"),
    memoryContext: context,
    memoryGenerateText: async () => {
      extractions++;
      return { text: '{"memories":[]}' };
    },
    connect: async (input) => {
      record = input.workflowServers!.find((server) => server.name === "zcode-memory")!;
      assert.ok(record);
      return {
        sessionId: "fixture-native",
        configOptions: [],
        modeState: null,
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async cancel() {},
        close() {},
        async prompt(_text, blocks) {
          if (++turn === 1) {
            const list = await (await rpc(record, "tools/list")).json();
            assert.ok(
              list.result.tools
                .find((tool: { name: string }) => tool.name === "SaveProjectMemory")
                .inputSchema.required.includes("expectedRevision"),
            );
            const invalid = await (
              await rpc(record, "tools/call", {
                name: "SaveProjectMemory",
                arguments: { ...fact, type: "invalid" },
              })
            ).json();
            assert.equal(invalid.result.isError, true);
            assert.doesNotMatch(invalid.result.content[0].text, /"status":"saved"/);
            const response = await (
              await rpc(record, "tools/call", { name: "SaveProjectMemory", arguments: fact })
            ).json();
            assert.equal(response.result.isError, undefined);
            const receipt = JSON.parse(response.result.content[0].text);
            assert.equal(receipt.status, "saved");
            const content = (await context.tools!.call(
              workspace,
              "ReadProjectMemory",
              { name: fact.name },
              () => {},
            )) as { revision: string };
            assert.equal(content.revision, receipt.revision);
          } else {
            assert.match(JSON.stringify(blocks), /delegation-agent-routing.md/);
          }
        },
      };
    },
  });
  try {
    const session = await service.create({ ...workspace, agent: "codex" });
    const input = { ...workspace, id: session.id, attachments: [], workspaceFiles: [] };
    await service.prompt({ ...input, commandId: randomUUID(), text: "记住委派规则" });
    assert.equal(extractions, 0);
    const resumed = await service.create({ ...workspace, agent: "codex", requestId: randomUUID() });
    await service.prompt({
      ...input,
      id: resumed.id,
      commandId: randomUUID(),
      text: "读取项目规则",
    });
    const stale = record!;
    await service.disposeAllAndWait();
    await assert.rejects(rpc(stale, "tools/list"), /fetch failed/);
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
