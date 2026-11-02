import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveProjectMemoryRoot } from "@zcode/shared/node";
import type { AcpSession } from "@zcode/shared";
import { createProjectMemoryContext } from "../src/memory/projectMemoryContext.js";
import {
  captureAcpMemorySnapshot,
  createAcpMemoryExtraction,
} from "../src/acp/acpMemoryExtraction.js";

test("successful ACP turns extract into shared memory without passing a supplied password to the auxiliary model", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-extract-"));
  const cliStorageRoot = join(root, "cli");
  const workspace = { workspacePath: join(root, "workspace"), workspaceIdentity: "fixture:a" };
  const context = createProjectMemoryContext({ cliStorageRoot, isEnabled: async () => true });
  await context.buildPromptContext(workspace);
  const memoryRoot = resolveProjectMemoryRoot({ cliStorageRoot, ...workspace });
  await writeFile(join(memoryRoot, "MEMORY.md"), "- password: INDEX123!\n");
  let generated = 0;
  let prompt = "";
  const session = {
    id: "session-a",
    revision: 1,
    status: "idle",
    queue: { items: [] },
    ...workspace,
    entries: [
      { id: "user-cancelled", kind: "user", text: "DO_NOT_SAVE", stopReason: "cancelled" },
      {
        id: "user-a",
        kind: "user",
        text: "记住测试服务器 SSH 连接信息\n198.51.100.25:22\nexample 的登录值 EXAMPLE123!",
        stopReason: "end_turn",
      },
      { id: "assistant-a", kind: "assistant", text: "已收到。" },
    ],
  } as unknown as AcpSession;
  const extraction = createAcpMemoryExtraction({
    context,
    read: async () => session,
    persist: async (snapshot, candidates) => {
      await context.saveMemories(snapshot, candidates);
      return true;
    },
    generate: async (input) => {
      generated++;
      prompt = input.prompt;
      return {
        text: JSON.stringify({
          memories: [
            {
              name: "test-server-ssh",
              description: "测试服务器 SSH 连接入口",
              type: "reference",
              content: "测试服务器的 SSH 地址是 198.51.100.25:22，用户名是 example。",
            },
          ],
        }),
      };
    },
  });
  try {
    extraction.schedule(captureAcpMemorySnapshot(session));
    await extraction.settle();
    assert.equal(generated, 1);
    assert.doesNotMatch(prompt, /EXAMPLE123/);
    assert.doesNotMatch(prompt, /INDEX123/);
    assert.doesNotMatch(prompt, /DO_NOT_SAVE/);
    assert.match(await readFile(join(memoryRoot, "MEMORY.md"), "utf8"), /test-server-ssh\.md/);
    assert.match((await context.buildPromptContext(workspace))!, /test-server-ssh\.md/);
    extraction.schedule(captureAcpMemorySnapshot(session));
    await extraction.settle();
    assert.equal(generated, 1, "settled turn must not be extracted twice");
  } finally {
    extraction.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP extraction leaves the cursor open after a failed auxiliary run", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-extract-retry-"));
  const context = createProjectMemoryContext({
    cliStorageRoot: join(root, "cli"),
    isEnabled: async () => true,
  });
  const session = {
    id: "session-b",
    revision: 1,
    status: "idle",
    queue: { items: [] },
    workspacePath: join(root, "workspace"),
    entries: [{ id: "user-b", kind: "user", text: "请记住测试环境入口", stopReason: "end_turn" }],
  } as unknown as AcpSession;
  let calls = 0;
  const extraction = createAcpMemoryExtraction({
    context,
    read: async () => session,
    persist: async (snapshot, candidates) => {
      await context.saveMemories(snapshot, candidates);
      return true;
    },
    generate: async () => {
      calls++;
      if (calls === 1) throw new Error("unavailable");
      return { text: '{"memories":[]}' };
    },
  });
  try {
    extraction.schedule(captureAcpMemorySnapshot(session));
    await extraction.settle();
    extraction.schedule(captureAcpMemorySnapshot(session));
    await extraction.settle();
    assert.equal(calls, 2);
  } finally {
    extraction.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("removed ACP sessions cannot commit a late memory result", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-extract-removed-"));
  const context = createProjectMemoryContext({
    cliStorageRoot: join(root, "cli"),
    isEnabled: async () => true,
  });
  const session = {
    id: "session-removed",
    revision: 1,
    status: "idle",
    queue: { items: [] },
    workspacePath: join(root, "workspace"),
    entries: [{ id: "user-a", kind: "user", text: "记住示例环境", stopReason: "end_turn" }],
  } as unknown as AcpSession;
  let started!: () => void;
  let release!: (value: { text: string }) => void;
  const entered = new Promise<void>((resolve) => (started = resolve));
  const result = new Promise<{ text: string }>((resolve) => (release = resolve));
  let persisted = false;
  const extraction = createAcpMemoryExtraction({
    context,
    read: async () => session,
    persist: async () => {
      persisted = true;
      return true;
    },
    generate: async () => {
      started();
      return result;
    },
  });
  try {
    extraction.schedule(captureAcpMemorySnapshot(session));
    await entered;
    extraction.forget(session.id);
    release({
      text: JSON.stringify({
        memories: [
          {
            name: "example-environment",
            description: "示例环境入口",
            type: "reference",
            content: "示例环境地址为 198.51.100.25。",
          },
        ],
      }),
    });
    await extraction.settle();
    assert.equal(persisted, false);
  } finally {
    extraction.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
