import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, resolve } from "node:path";
import test from "node:test";
import { resolveProjectMemoryRoot } from "@zcode/shared/node";
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
    assert.match(empty!, /persistent file-based memory/);
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
    const persisted = JSON.parse(
      await readFile(join(root, "sessions", `${session.id}.json`), "utf8"),
    );
    assert.deepEqual(
      persisted.entries
        .filter((e: { kind: string }) => e.kind === "user")
        .map((e: { text: string }) => e.text),
      [input.text, "next"],
    );
    assert.doesNotMatch(
      JSON.stringify(persisted),
      /persistent file-based memory|updated by ACP file tool/,
    );
    await service.disposeAllAndWait();
    service = createAcpService(options);
    await service.prompt({ ...input, commandId: randomUUID(), text: "resumed" });
    assert.match(received[2]!, /updated by ACP file tool/);
    enabled = false;
    await service.prompt({ ...input, commandId: randomUUID(), text: "disabled" });
    assert.doesNotMatch(received[3]!, /persistent file-based memory|updated by ACP file tool/);
  } finally {
    await service.disposeAllAndWait();
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
    const saved = JSON.parse(await readFile(join(root, "sessions", `${session.id}.json`), "utf8"));
    assert.equal(saved.entries.filter((e: { kind: string }) => e.kind === "user").length, 1);
  } finally {
    await service.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});
