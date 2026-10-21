import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AcpAttachmentRef, NativeMcpServerRecord } from "@zcode/shared";
import { AcpAttachmentStore } from "../src/acp/acpAttachmentStore.js";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";

type ToolResult = { content: ContentBlock[]; isError?: boolean };
type AttachmentPage = {
  attachments: Array<AcpAttachmentRef & { messageId: string }>;
  total: number;
  nextOffset: number | null;
};

async function rpc(server: NativeMcpServerRecord, method: string, params?: unknown) {
  const env = server.config.env!;
  return fetch(env.ZCODE_WORKFLOW_URL!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function call(server: NativeMcpServerRecord, name: string, args: unknown = {}) {
  const response = await rpc(server, "tools/call", { name, arguments: args });
  assert.equal(response.status, 200);
  return ((await response.json()) as { result: ToolResult }).result;
}

function data(result: ToolResult): AttachmentPage {
  const text = result.content.find((block) => block.type === "text");
  assert.ok(text?.type === "text");
  return JSON.parse(text.text);
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(onPrompt?: (blocks: ContentBlock[]) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "acp-attachment-recovery-"));
  const target = {
    workspacePath: directory,
    workspaceIdentity: "remote:attachment-recovery",
    remoteSessionId: "host-attachment",
  };
  const inputs: Parameters<AcpConnectionFactory>[0][] = [];
  const prompts: ContentBlock[][] = [];
  const makeService = () =>
    createAcpService({
      directory: join(directory, "sessions"),
      resolveDynamicWorkflowClientConfig: async () => ({
        enabled: false,
        mode: "disabled",
        source: "override",
      }),
      connect: async (input) => {
        inputs.push(input);
        return {
          sessionId: input.sessionId ?? "native-attachment-recovery",
          configOptions: [],
          modeState: null,
          promptCapabilities: { image: true, embeddedContext: true },
          provisionedMcpNames: new Set(input.workflowServers?.map((server) => server.name)),
          setConfigOption: async () => [],
          setMode: async () => {},
          cancel: async () => {},
          close() {},
          async prompt(_text, blocks = []) {
            prompts.push(blocks);
            await onPrompt?.(blocks);
          },
        };
      },
    });
  const service = makeService();
  const session = await service.create({ ...target, agent: "codex" });
  const server = () => {
    const value = inputs
      .at(-1)
      ?.workflowServers?.find((record) => record.name === "zcode-attachments");
    assert.ok(
      value,
      "normal ACP connections must expose attachment recovery independently of workflows",
    );
    return value;
  };
  let command = 0;
  return {
    directory,
    target,
    inputs,
    prompts,
    service,
    session,
    server,
    makeService,
    prompt: (
      text: string,
      attachments: Array<{
        fileName: string;
        mimeType: string;
        path?: string;
        dataBase64?: string;
      }> = [],
    ) =>
      service.prompt({
        ...target,
        id: session.id,
        commandId: `input-${++command}`,
        text,
        attachments,
        workspaceFiles: [],
      }),
    async close() {
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

const imageInput = (fileName = "issue-26-image-1.png") => ({
  fileName,
  mimeType: "image/png",
  dataBase64: "cG5n",
});

test("context loss and a text-only continuation recover the immutable original through MCP", async () => {
  let firstList: AttachmentPage | undefined;
  const f = await fixture(async () => {
    firstList ??= data(await call(f.server(), "ListAttachments"));
  });
  let restarted: ReturnType<typeof createAcpService> | undefined;
  try {
    const original = Buffer.from("original-image".repeat(18000));
    const source = join(f.directory, "original.png");
    await writeFile(source, original);
    await f.prompt("The screenshot was already supplied", [
      { fileName: "issue-26-image-1.png", mimeType: "image/png", path: source },
      { fileName: "notes.txt", mimeType: "text/plain", dataBase64: "bm90ZXM=" },
    ]);
    assert.equal(
      firstList?.attachments.length,
      2,
      "current accepted attachments are readable during the first turn",
    );
    const ref = firstList!.attachments[0].ref;
    await writeFile(source, "changed after sending");
    // Adapter 故意不保留图片上下文；后续提示没有附件，恢复必须使用 Host 已保存的副本。
    await f.prompt("Continue after compaction");
    const context = f.prompts
      .at(-1)!
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    assert.match(context, /issue-26-image-1\.png/);
    assert.ok(context.includes(ref));
    assert.match(context, /ListAttachments/);
    assert.match(context, /ReadAttachment/);
    assert.doesNotMatch(context, /The screenshot was already supplied/);
    assert.equal(
      f.prompts.at(-1)!.some((block) => block.type === "image"),
      false,
      "historical bytes are loaded on demand",
    );
    const restored = await call(f.server(), "ReadAttachment", { ref });
    const image = restored.content.find((block) => block.type === "image");
    assert.ok(image?.type === "image");
    assert.deepEqual(Buffer.from(image.data, "base64"), original);
    const notes = await call(f.server(), "ReadAttachment", { ref: firstList!.attachments[1].ref });
    const resource = notes.content.find((block) => block.type === "resource");
    assert.ok(resource?.type === "resource" && "text" in resource.resource);
    assert.equal(resource.resource.text, "notes");
    const history = await f.service.read({ ...f.target, id: f.session.id });
    assert.equal(
      history.entries.find((entry) => entry.kind === "user")?.text,
      "The screenshot was already supplied",
    );
    assert.doesNotMatch(
      await readFile(join(f.directory, "sessions", `${f.session.id}.json`), "utf8"),
      /ZCODE_WORKFLOW_TOKEN|changed after sending|original-image/,
    );

    const old = f.server();
    await f.service.disposeAllAndWait();
    restarted = f.makeService();
    await restarted.prompt({
      ...f.target,
      id: f.session.id,
      commandId: "restart",
      text: "Continue after Host restart",
      attachments: [],
      workspaceFiles: [],
    });
    const afterRestart = await call(f.server(), "ReadAttachment", { ref });
    const imageAfterRestart = afterRestart.content.find((block) => block.type === "image");
    assert.ok(imageAfterRestart?.type === "image");
    assert.deepEqual(Buffer.from(imageAfterRestart.data, "base64"), original);
    assert.notEqual(
      f.server().config.env!.ZCODE_WORKFLOW_TOKEN,
      old.config.env!.ZCODE_WORKFLOW_TOKEN,
    );
  } finally {
    await restarted?.disposeAllAndWait();
    await f.close();
  }
});

test("attachment discovery is paginated and session-bound; manifests stay bounded", async () => {
  const f = await fixture();
  try {
    for (let batch = 0; batch < 2; batch++)
      await f.prompt(
        "Upload",
        Array.from({ length: 8 }, () => imageInput()),
      );
    const listed = data(await call(f.server(), "ListAttachments", { offset: 0, limit: 2 }));
    assert.equal(listed.total, 16);
    assert.equal(listed.attachments.length, 2);
    assert.equal(listed.nextOffset, 2);
    assert.notEqual(
      listed.attachments[0].ref,
      listed.attachments[1].ref,
      "same-name files retain distinct stable refs",
    );
    const next = data(await call(f.server(), "ListAttachments", { offset: 2, limit: 2 }));
    assert.notEqual(next.attachments[0].ref, listed.attachments[0].ref);
    await f.prompt("Continue");
    const manifest = f.prompts
      .at(-1)!
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    assert.equal((manifest.match(/issue-26-image-1\.png/g) ?? []).length, 12);
    assert.match(manifest, /16/);

    const other = await f.service.create({ ...f.target, agent: "claude" });
    const otherServer = f.server();
    assert.equal(data(await call(otherServer, "ListAttachments")).total, 0);
    for (const args of [
      { ref: listed.attachments[0].ref },
      { ref: "/etc/passwd" },
      { ref: listed.attachments[0].ref, sessionId: f.session.id },
    ])
      assert.equal((await call(otherServer, "ReadAttachment", args)).isError, true);
    assert.equal(
      (await call(otherServer, "ListAttachments", { workspacePath: f.directory })).isError,
      true,
    );
    await f.service.remove({ ...f.target, id: other.id });
    assert.equal((await rpc(otherServer, "tools/list")).status, 403);
  } finally {
    await f.close();
  }
});

test("unsent queue attachments never appear in Agent attachment tools", async () => {
  const started = gate(),
    release = gate();
  const f = await fixture(async () => {
    started.resolve();
    await release.promise;
  });
  const running = f.prompt("Running", [imageInput("sent.png")]);
  try {
    await started.promise;
    await f.prompt("Queued private input", [imageInput("not-sent.png")]);
    const snapshot = await f.service.read({ ...f.target, id: f.session.id });
    const queued = snapshot.queue.items[0]!.attachments[0]!;
    const listed = data(await call(f.server(), "ListAttachments"));
    assert.equal(listed.total, 1);
    assert.equal(listed.attachments[0].fileName, "sent.png");
    assert.equal((await call(f.server(), "ReadAttachment", { ref: queued.ref })).isError, true);
  } finally {
    release.resolve();
    await running;
    await f.close();
  }
});

test("connection exit revokes old capabilities and discards in-flight image results", async () => {
  const f = await fixture();
  const originalRead = AcpAttachmentStore.prototype.read;
  const started = gate(),
    release = gate();
  try {
    await f.prompt("Upload", [imageInput()]);
    const old = f.server();
    const ref = data(await call(old, "ListAttachments")).attachments[0].ref;
    AcpAttachmentStore.prototype.read = async function (...args) {
      const result = await originalRead.apply(this, args);
      started.resolve();
      await release.promise;
      return result;
    };
    const reading = call(old, "ReadAttachment", { ref });
    await started.promise;
    f.inputs.at(-1)!.onExit("fixture exit");
    release.resolve();
    const stale = await reading;
    assert.equal(stale.isError, true);
    assert.equal(
      stale.content.some((block) => block.type === "image"),
      false,
    );
    assert.equal((await rpc(old, "tools/list")).status, 403);
    AcpAttachmentStore.prototype.read = originalRead;
    await f.prompt("Reconnect");
    assert.equal((await call(f.server(), "ReadAttachment", { ref })).isError, undefined);
    await f.service.remove({ ...f.target, id: f.session.id });
    assert.equal((await rpc(f.server(), "tools/list")).status, 403);
  } finally {
    release.resolve();
    AcpAttachmentStore.prototype.read = originalRead;
    await f.close();
  }
});

test("attachment tool image results survive the actual stdio proxy", async () => {
  const f = await fixture();
  try {
    await f.prompt("Upload", [imageInput()]);
    const server = f.server();
    const ref = data(await call(server, "ListAttachments")).attachments[0].ref;
    const child = spawn(server.config.command!, server.config.args!, {
      env: { ...process.env, ...server.config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "",
      errors = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      errors += chunk;
    });
    child.stdin.end(
      [
        { jsonrpc: "2.0", id: 0, method: "initialize" },
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "ReadAttachment", arguments: { ref } },
        },
      ]
        .map((request) => JSON.stringify(request))
        .join("\n") + "\n",
    );
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(code, 0, errors);
    const messages = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(
      messages.find((message) => message.id === 0).result.serverInfo.name,
      "zcode-attachments",
    );
    assert.deepEqual(
      messages
        .find((message) => message.id === 1)
        .result.tools.map((tool: { name: string }) => tool.name),
      ["ListAttachments", "ReadAttachment"],
    );
    assert.deepEqual(
      messages
        .find((message) => message.id === 2)
        .result.content.find((block: ContentBlock) => block.type === "image"),
      { type: "image", data: "cG5n", mimeType: "image/png" },
    );
  } finally {
    await f.close();
  }
});
