import assert from "node:assert/strict";
import { readPersistedAcpSession } from "./acpTestStorage.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile, mkdir, access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, resolve } from "node:path";
import test from "node:test";
import { resolveProjectMemoryRoot } from "@zcode/shared/node";
import { parse as parseYaml } from "yaml";
import type { AcpWorkspace } from "@zcode/shared";
import { createProjectMemoryContext } from "../src/memory/projectMemoryContext.js";
import { createAcpService } from "../src/acp/acpServiceImpl.js";

test("memory path retains API storage keys and identity isolation", () => {
  const workspacePath = resolve("fixture-project");
  const key = process.platform === "win32" ? workspacePath.toLowerCase() : workspacePath;
  const slug = basename(workspacePath).toLowerCase();
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  assert.equal(
    resolveProjectMemoryRoot({ cliStorageRoot: "store", workspacePath }),
    join("store", "memories", "projects", `${slug}-${hash}`, "memory"),
  );
  const input = { cliStorageRoot: "store", workspacePath, workspaceIdentity: " remote:a " };
  assert.equal(
    resolveProjectMemoryRoot(input),
    resolveProjectMemoryRoot({
      ...input,
      workspacePath: resolve("other"),
      workspaceIdentity: "remote:a",
    }),
  );
  assert.notEqual(
    resolveProjectMemoryRoot(input),
    resolveProjectMemoryRoot({ ...input, workspaceIdentity: "remote:b" }),
  );
});

test("ACP Host reads the same project fact from a linked Git worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-repository-memory-"));
  const cliStorageRoot = join(root, "cli");
  const main = join(root, "main", "zcode");
  const linked = join(root, "linked", "zcode");
  try {
    await mkdir(join(main, ".git", "worktrees", "linked"), { recursive: true });
    await mkdir(linked, { recursive: true });
    const gitDir = join(main, ".git", "worktrees", "linked");
    await writeFile(join(linked, ".git"), `gitdir: ${gitDir}\n`);
    await writeFile(join(gitDir, "commondir"), "../..\n");
    const context = createProjectMemoryContext({ cliStorageRoot, isEnabled: async () => true });
    await context.saveMemories({ workspacePath: main }, [
      {
        name: "shared-fact",
        description: "Shared repository fact",
        type: "project",
        content: "Shared across worktrees.",
      },
    ]);
    const linkedPrompt = await context.buildPromptContext({ workspacePath: linked });
    assert.match(linkedPrompt ?? "", /shared-fact\.md/);
    assert.match(linkedPrompt ?? "", /Shared repository fact/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disabled memory performs no IO; enabled context reads existing API index and bounds it", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-memory-"));
  const cliStorageRoot = join(root, "cli");
  const workspace = { workspacePath: join(root, "workspace") };
  let enabled = false;
  const context = createProjectMemoryContext({ cliStorageRoot, isEnabled: async () => enabled });
  try {
    assert.equal(await context.buildPromptContext(workspace), undefined);
    await assert.rejects(access(cliStorageRoot));
    enabled = true;
    const empty = await context.buildPromptContext(workspace);
    assert.match(empty!, /persistent CodeVori project memory/);
    assert.match(empty!, /Respect.*permission/);
    const memoryRoot = resolveProjectMemoryRoot({ cliStorageRoot, ...workspace });
    await writeFile(join(memoryRoot, "MEMORY.md"), "API shared fact\n" + "entry\n".repeat(230));
    const filled = await context.buildPromptContext(workspace);
    assert.match(filled!, /API shared fact/);
    assert.match(filled!, /truncated/);
    assert.ok(filled!.split("entry").length <= 200);
    await writeFile(join(memoryRoot, "MEMORY.md"), "x".repeat(26_000));
    const long = await context.buildPromptContext(workspace);
    const prefix = "Workspace MEMORY.md index (JSON-encoded text): ";
    const encoded = long!.split("\n").find((line) => line.startsWith(prefix))!;
    assert.equal(JSON.parse(encoded.slice(prefix.length)).length, 25_000);
    assert.match(long!, /truncated/);
    enabled = false;
    assert.equal(await context.buildPromptContext(workspace), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP Host saves a durable fact into the API project memory format and reads it next turn", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-memory-write-"));
  const cliStorageRoot = join(root, "cli");
  const workspace = { workspacePath: join(root, "workspace"), workspaceIdentity: "fixture:a" };
  const context = createProjectMemoryContext({ cliStorageRoot, isEnabled: async () => true });
  try {
    await context.saveMemories(workspace, [
      {
        name: "test-server-ssh",
        description: "测试服务器 SSH 连接入口",
        type: "reference",
        content: "测试服务器的 SSH 地址是 198.51.100.25:22，用户名是 example。",
      },
    ]);
    const memoryRoot = resolveProjectMemoryRoot({ cliStorageRoot, ...workspace });
    const item = await readFile(join(memoryRoot, "test-server-ssh.md"), "utf8");
    assert.match(item, /name: test-server-ssh/);
    assert.match(item, /type: reference/);
    assert.match(item, /198\.51\.100\.25:22/);
    const metadata = parseYaml(item.split("---")[1]!) as {
      description: string;
      metadata: { type: string };
    };
    assert.equal(metadata.description, "测试服务器 SSH 连接入口");
    assert.equal(metadata.metadata.type, "reference");
    const index = await readFile(join(memoryRoot, "MEMORY.md"), "utf8");
    assert.match(index, /\[测试服务器 SSH 连接入口\]\(test-server-ssh\.md\)/);
    assert.match((await context.buildPromptContext(workspace))!, /test-server-ssh\.md/);
    await context.saveMemories(workspace, [
      {
        name: "test-server-ssh",
        description: "测试服务器 SSH 连接入口",
        type: "reference",
        content: "测试服务器的 SSH 地址是 198.51.100.25:22，用户名是 example。",
      },
    ]);
    assert.equal(
      (await readFile(join(memoryRoot, "MEMORY.md"), "utf8")).split("test-server-ssh.md").length,
      2,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP Host memory writes honor the switch, reject secrets and linked destinations", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-memory-write-guards-"));
  const cliStorageRoot = join(root, "cli");
  const workspace = { workspacePath: join(root, "workspace") };
  let enabled = false;
  const context = createProjectMemoryContext({ cliStorageRoot, isEnabled: async () => enabled });
  const item = {
    name: "test-server-ssh",
    description: "测试服务器 SSH 连接入口",
    type: "reference" as const,
    content: "测试服务器的 SSH 地址是 198.51.100.25:22，用户名是 example。",
  };
  try {
    await assert.rejects(context.saveMemories(workspace, [item]), /disabled/);
    await assert.rejects(access(cliStorageRoot));
    enabled = true;
    await context.buildPromptContext(workspace);
    await assert.rejects(
      context.saveMemories(workspace, [{ ...item, content: "password: example-secret-123!" }]),
      /secret/i,
    );
    await assert.rejects(
      context.saveMemories(workspace, [{ ...item, content: "测试服务器的登录值是 EXAMPLE123!" }]),
      /secret/i,
    );
    const memoryRoot = resolveProjectMemoryRoot({ cliStorageRoot, ...workspace });
    const outside = join(root, "outside.md");
    await writeFile(outside, "keep");
    await symlink(outside, join(memoryRoot, "test-server-ssh.md"));
    await assert.rejects(context.saveMemories(workspace, [item]), /regular file/);
    assert.equal(await readFile(outside, "utf8"), "keep");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent ACP memory writes in one workspace retain both index entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-memory-concurrent-"));
  const cliStorageRoot = join(root, "cli");
  const workspace = { workspacePath: join(root, "workspace") };
  const context = createProjectMemoryContext({ cliStorageRoot, isEnabled: async () => true });
  try {
    await Promise.all([
      context.saveMemories(workspace, [
        {
          name: "alpha-host",
          description: "甲环境入口",
          type: "reference",
          content: "甲环境地址为 198.51.100.25。",
        },
      ]),
      context.saveMemories(workspace, [
        {
          name: "beta-host",
          description: "乙环境入口",
          type: "reference",
          content: "乙环境地址为 203.0.113.25。",
        },
      ]),
    ]);
    const memoryRoot = resolveProjectMemoryRoot({ cliStorageRoot, ...workspace });
    const index = await readFile(join(memoryRoot, "MEMORY.md"), "utf8");
    assert.match(index, /alpha-host\.md/);
    assert.match(index, /beta-host\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory context rejects linked indexes and linked workspace directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-memory-link-"));
  const workspace = { workspacePath: join(root, "workspace") };
  const cliStorageRoot = join(root, "cli");
  const context = createProjectMemoryContext({ cliStorageRoot, isEnabled: async () => true });
  const memoryRoot = resolveProjectMemoryRoot({ cliStorageRoot, ...workspace });
  try {
    await context.buildPromptContext(workspace);
    const outside = join(root, "outside.md");
    await writeFile(outside, "must not inject");
    await symlink(outside, join(memoryRoot, "MEMORY.md"));
    await assert.rejects(context.buildPromptContext(workspace), /regular file/);
    await rm(memoryRoot, { recursive: true });
    const outsideDir = join(root, "outside-dir");
    await mkdir(outsideDir);
    await symlink(outsideDir, memoryRoot, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(context.buildPromptContext(workspace), /regular directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP shares memory updates across turns and resume without changing history or retry admission", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-memory-host-"));
  const workspace = { workspacePath: join(root, "workspace"), workspaceIdentity: "fixture:a" };
  const cliStorageRoot = join(root, "cli");
  const memoryRoot = resolveProjectMemoryRoot({ cliStorageRoot, ...workspace });
  let enabled = true;
  const context = createProjectMemoryContext({ cliStorageRoot, isEnabled: async () => enabled });
  let reads = 0;
  const received: string[] = [];
  const options = {
    directory: join(root, "sessions"),
    memoryContext: {
      async buildPromptContext(target: AcpWorkspace) {
        reads++;
        return context.buildPromptContext(target);
      },
    },
    skillsService: {
      async buildPromptContext({ prompt }: { prompt: string }) {
        return { prompt: `${prompt}\nfixture skill`, activatedSkillNames: [] };
      },
    },
    connect: async () => ({
      sessionId: "native-fixture",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async cancel() {},
      close() {},
      async prompt(_text: string, blocks?: Array<{ type: string; text?: string }>) {
        const text =
          blocks
            ?.filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n") ?? "";
        received.push(text);
        if (received.length === 1)
          await writeFile(join(memoryRoot, "MEMORY.md"), "updated by ACP file tool");
      },
    }),
  };
  let service = createAcpService(options);
  try {
    const session = await service.create({ ...workspace, agent: "codex" });
    const input = {
      ...workspace,
      id: session.id,
      commandId: randomUUID(),
      text: "remember fixture",
      attachments: [],
      workspaceFiles: [],
    };
    await service.prompt(input);
    await service.prompt(input);
    assert.equal(received.length, 1);
    assert.equal(reads, 1, "accepted retry must not touch memory or send again");
    await service.prompt({ ...input, commandId: randomUUID(), text: "next" });
    assert.match(received[1]!, /updated by ACP file tool/);
    assert.match(received[1]!, /fixture skill/);
    const persisted = await readPersistedAcpSession(join(root, "sessions", `${session.id}.json`));
    assert.deepEqual(
      persisted.entries
        .filter((e: { kind: string }) => e.kind === "user")
        .map((e: { text: string }) => e.text),
      [input.text, "next"],
    );
    assert.doesNotMatch(
      JSON.stringify(persisted),
      /persistent CodeVori project memory|updated by ACP file tool/,
    );
    await service.disposeAllAndWait();
    service = createAcpService(options);
    await service.prompt({ ...input, commandId: randomUUID(), text: "resumed" });
    assert.match(received[2]!, /updated by ACP file tool/);
    enabled = false;
    await service.prompt({ ...input, commandId: randomUUID(), text: "disabled" });
    assert.doesNotMatch(
      received[3]!,
      /persistent CodeVori project memory|updated by ACP file tool/,
    );
  } finally {
    await service.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP turn completion schedules Host extraction and the next turn receives the saved index", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-memory-automatic-"));
  const cliStorageRoot = join(root, "cli");
  const workspace = { workspacePath: join(root, "workspace") };
  const context = createProjectMemoryContext({ cliStorageRoot, isEnabled: async () => true });
  const received: string[] = [];
  let generated = 0;
  const service = createAcpService({
    directory: join(root, "sessions"),
    memoryContext: context,
    memoryGenerateText: async () => {
      generated++;
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
    connect: async () => ({
      sessionId: "native-fixture",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async cancel() {},
      close() {},
      async prompt(_text: string, blocks?: Array<{ type: string; text?: string }>) {
        received.push(
          blocks
            ?.filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n") ?? "",
        );
      },
    }),
  });
  try {
    const session = await service.create({ ...workspace, agent: "codex" });
    const input = { ...workspace, id: session.id, attachments: [], workspaceFiles: [] };
    await service.prompt({ ...input, commandId: randomUUID(), text: "请记住测试服务器地址" });
    const indexPath = join(resolveProjectMemoryRoot({ cliStorageRoot, ...workspace }), "MEMORY.md");
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await readFile(indexPath, "utf8")).includes("test-server-ssh.md")) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.match(await readFile(indexPath, "utf8"), /test-server-ssh\.md/);
    assert.equal(generated, 1);
    await service.prompt({ ...input, commandId: randomUUID(), text: "测试服务器是什么？" });
    assert.match(received[1]!, /test-server-ssh\.md/);
  } finally {
    await service.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP Host shutdown drains a completed turn's pending memory write", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-memory-shutdown-"));
  const cliStorageRoot = join(root, "cli");
  const workspace = { workspacePath: join(root, "workspace") };
  const context = createProjectMemoryContext({ cliStorageRoot, isEnabled: async () => true });
  let entered!: () => void;
  let release!: (value: { text: string }) => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const result = new Promise<{ text: string }>((resolve) => (release = resolve));
  const service = createAcpService({
    directory: join(root, "sessions"),
    memoryContext: context,
    memoryGenerateText: async () => {
      entered();
      return result;
    },
    connect: async () => ({
      sessionId: "native-fixture",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async cancel() {},
      close() {},
      async prompt() {},
    }),
  });
  try {
    const session = await service.create({ ...workspace, agent: "codex" });
    await service.prompt({
      ...workspace,
      id: session.id,
      commandId: randomUUID(),
      text: "请记住示例环境地址",
      attachments: [],
      workspaceFiles: [],
    });
    await started;
    let closed = false;
    const closing = service.disposeAllAndWait().then(() => (closed = true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(closed, false);
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
    await closing;
    const indexPath = join(resolveProjectMemoryRoot({ cliStorageRoot, ...workspace }), "MEMORY.md");
    assert.match(await readFile(indexPath, "utf8"), /example-environment\.md/);
  } finally {
    service.disposeAll();
    await rm(root, { recursive: true, force: true });
  }
});

test("index failures stay before admission and allow a retry without duplicate history", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-memory-failure-"));
  let fail = true;
  let sends = 0;
  const workspace = { workspacePath: root };
  const service = createAcpService({
    directory: join(root, "sessions"),
    memoryContext: {
      async buildPromptContext() {
        if (fail) throw new Error("index unavailable");
        return "safe memory context";
      },
    },
    connect: async () => ({
      sessionId: "native-fixture",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async cancel() {},
      close() {},
      async prompt() {
        sends++;
      },
    }),
  });
  try {
    const session = await service.create({ ...workspace, agent: "claude" });
    const input = {
      ...workspace,
      id: session.id,
      commandId: randomUUID(),
      text: "fixture",
      attachments: [],
      workspaceFiles: [],
    };
    await assert.rejects(service.prompt(input), /index unavailable/);
    assert.equal(sends, 0);
    fail = false;
    await service.prompt(input);
    assert.equal(sends, 1);
    const saved = await readPersistedAcpSession(join(root, "sessions", `${session.id}.json`));
    assert.equal(saved.entries.filter((e: { kind: string }) => e.kind === "user").length, 1);
  } finally {
    await service.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});
