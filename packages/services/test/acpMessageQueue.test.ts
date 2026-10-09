import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import { isAcpHistorySession, type AcpStopReason } from "@zcode/shared";
import { AcpAttachmentStore } from "../src/acp/acpAttachmentStore.js";
import { ChannelClient, ChannelServer, ProxyChannel, createQueuePair } from "@zcode/rpc";
import type { IAcpService } from "../src/acp/acpService.js";

const workspace = { workspacePath: "/tmp/queue-workspace", workspaceIdentity: "remote:queue" };
async function waitFor(check: () => unknown | Promise<unknown>) {
  for (let n = 0; n < 200; n++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("queue state did not settle");
}
async function fixture(options: NonNullable<Parameters<typeof createAcpService>[0]> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-queue-"));
  const calls: Array<{ text: string; blocks?: ContentBlock[] }> = [];
  const turns: Array<{ resolve(): void; reject(error: Error): void }> = [];
  let exit: ((reason: string) => void) | undefined;
  let update!: Parameters<AcpConnectionFactory>[0]["onUpdate"];
  let cancelRelease: (() => void) | undefined;
  let delayCancel = false;
  let closed = 0;
  let stopReason: AcpStopReason | undefined;
  const connect: AcpConnectionFactory = async (input) => {
    exit = input.onExit;
    update = input.onUpdate;
    return {
      sessionId: input.sessionId ?? "native-queue",
      promptCapabilities: { image: true, embeddedContext: true },
      get lastStopReason() {
        return stopReason;
      },
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt(text, blocks) {
        calls.push({ text, blocks });
        await new Promise<void>((resolve, reject) => turns.push({ resolve, reject }));
      },
      async cancel() {
        if (delayCancel)
          await new Promise<void>((resolve) => {
            cancelRelease = resolve;
          });
        turns.at(-1)?.resolve();
      },
      close() {
        closed++;
      },
    };
  };
  let service = createAcpService({ ...options, directory, connect });
  const session = await service.create({ ...workspace, agent: "codex" });
  const target = { ...workspace, id: session.id };
  const prompt = (commandId: string, text = commandId) =>
    service.prompt({ ...target, commandId, text });
  return {
    directory,
    calls,
    turns,
    target,
    prompt,
    emit: (value: Parameters<typeof update>[0]) => update(value),
    get service() {
      return service;
    },
    read: () => service.read(target),
    exit: () => exit?.("fixture exited"),
    delayCancel: () => {
      delayCancel = true;
    },
    releaseCancel: () => cancelRelease?.(),
    get cancelling() {
      return Boolean(cancelRelease);
    },
    get closed() {
      return closed;
    },
    setStopReason: (value: AcpStopReason) => {
      stopReason = value;
    },
    async restart() {
      await service.disposeAllAndWait();
      service = createAcpService({ ...options, directory, connect });
    },
    async dispose() {
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("RPC acceptance needs no session notifications and does not finish the Agent turn", async () => {
  const f = await fixture();
  const [clientProtocol, serverProtocol] = createQueuePair();
  const server = new ChannelServer(serverProtocol, "test");
  server.registerChannel("acp", ProxyChannel.fromService(f.service));
  const client = new ChannelClient(clientProtocol);
  const remote = ProxyChannel.toService<IAcpService>(client.getChannel("acp"));
  try {
    const accepted = await remote.submitPrompt({ ...f.target, commandId: "first", text: "first" });
    const disk = JSON.parse(await readFile(join(f.directory, `${f.target.id}.json`), "utf8"));
    assert.equal(disk.entries[0].id, "user:first");
    assert.equal(accepted.status, "running");
    await waitFor(() => f.calls.length === 1);
    f.turns[0]!.resolve();
    await waitFor(async () => (await f.read()).status === "idle");
    let completed = false;
    const next = remote.prompt({ ...f.target, commandId: "next", text: "next" }).then(() => {
      completed = true;
    });
    await waitFor(() => f.calls.length === 2);
    assert.equal(completed, false);
    f.turns[1]!.resolve();
    await next;
    assert.equal(completed, true);
  } finally {
    client.dispose();
    server.dispose();
    await f.dispose();
  }
});

test("preparing retries share acceptance and execute the same command once", async () => {
  let release!: () => void;
  let started = false;
  const f = await fixture({
    skillsService: {
      async buildPromptContext({ prompt }) {
        started = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { prompt };
      },
    },
  });
  try {
    let settled = false;
    const input = { ...f.target, commandId: "same", text: "hello" };
    const first = f.service.submitPrompt(input).then((value) => {
      settled = true;
      return value;
    });
    await waitFor(() => started);
    const duplicate = f.service.submitPrompt(input);
    assert.equal(settled, false);
    release();
    const receipts = await Promise.all([first, duplicate]);
    assert.equal(receipts[0].entries.filter((e) => e.id === "user:same").length, 1);
    assert.deepEqual(receipts[0], receipts[1]);
    await waitFor(() => f.calls.length === 1);
    f.turns[0]!.resolve();
  } finally {
    await f.dispose();
  }
});

test(
  "stop, removal, exit and Host close settle acceptance before blocked preparation returns",
  { timeout: 5000 },
  async () => {
    for (const action of ["stop", "remove", "exit", "close"] as const) {
      let release!: () => void;
      const f = await fixture({
        skillsService: {
          async buildPromptContext(input) {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            return { prompt: input.prompt };
          },
        },
      });
      try {
        const accepted = f.service.submitPrompt({
          ...f.target,
          commandId: action,
          text: "blocked",
        });
        const rejected = assert.rejects(accepted, /stopped|removed|exited|closed/);
        await waitFor(() => Boolean(release));
        if (action === "stop") await f.service.stop(f.target);
        if (action === "remove") await f.service.remove(f.target);
        if (action === "exit") f.exit();
        if (action === "close") f.service.disposeAll();
        await rejected;
        assert.equal(f.calls.length, 0);
        release();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(f.calls.length, 0, "stale preparation must not start an Agent turn");
      } finally {
        release?.();
        await f.dispose();
      }
    }
  },
);

test("immediate acceptance never succeeds on persistence failure and can safely retry", async () => {
  const f = await fixture();
  const file = join(f.directory, `${f.target.id}.json`);
  try {
    const input = { ...f.target, commandId: "disk-failure", text: "hello" };
    await rm(file, { force: true });
    await mkdir(file);
    await assert.rejects(f.service.submitPrompt(input));
    assert.equal((await f.read()).entries.length, 0);
    assert.equal(f.calls.length, 0);
    await rm(file, { recursive: true });
    const accepted = await f.service.submitPrompt(input);
    assert.equal(accepted.entries[0]?.id, "user:disk-failure");
    await waitFor(() => f.calls.length === 1);
    f.turns[0]!.resolve();
  } finally {
    await f.dispose();
  }
});

test("diagnostic failure after durable acceptance cannot roll back the accepted user row", async () => {
  const f = await fixture();
  try {
    const diagnostic = join(f.directory, "diagnostics", `${f.target.id}.jsonl`);
    await mkdir(diagnostic, { recursive: true });
    const accepted = await f.service.submitPrompt({
      ...f.target,
      commandId: "diagnostic-failure",
      text: "hello",
    });
    assert.equal(accepted.entries[0]?.id, "user:diagnostic-failure");
    await waitFor(() => f.calls.length === 1);
    f.turns[0]!.resolve();
    await waitFor(async () => (await f.read()).status === "idle");
    assert.equal((await f.read()).entries[0]?.id, "user:diagnostic-failure");
    const disk = JSON.parse(await readFile(join(f.directory, `${f.target.id}.json`), "utf8"));
    assert.equal(disk.entries[0].id, "user:diagnostic-failure");
    assert.equal(f.calls.length, 1);
  } finally {
    await f.dispose();
  }
});

test("an Agent failure after acceptance is a turn error and cannot reject the accepted input", async () => {
  const f = await fixture();
  try {
    const input = { ...f.target, commandId: "accepted-error", text: "hello" };
    const accepted = await f.service.submitPrompt(input);
    await waitFor(() => f.calls.length === 1);
    f.turns[0]!.reject(new Error("model disconnected"));
    await waitFor(async () => (await f.read()).status === "interrupted");
    assert.equal(accepted.entries[0]?.id, "user:accepted-error");
    const duplicate = await f.service.submitPrompt(input);
    assert.equal(duplicate.entries.filter((entry) => entry.id === "user:accepted-error").length, 1);
    assert.equal(f.calls.length, 1);
  } finally {
    await f.dispose();
  }
});

test(
  "Host close rejects queued acceptance before a blocked attachment copy completes",
  { timeout: 5000 },
  async () => {
    const f = await fixture();
    const original = AcpAttachmentStore.prototype.save;
    let release!: () => void;
    AcpAttachmentStore.prototype.save = async function (...args) {
      if (args[1].length)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return original.apply(this, args);
    };
    try {
      await f.service.submitPrompt({ ...f.target, commandId: "first", text: "first" });
      const queued = f.service.submitPrompt({
        ...f.target,
        commandId: "queued",
        text: "image",
        attachments: [
          {
            dataBase64: Buffer.from("image").toString("base64"),
            fileName: "image.png",
            mimeType: "image/png",
          },
        ],
      });
      const rejected = assert.rejects(queued, /closed/);
      await waitFor(() => Boolean(release));
      f.service.disposeAll();
      await rejected;
      release();
      await f.service.disposeAllAndWait();
      assert.equal((await f.read()).queue.items.length, 0);
    } finally {
      release?.();
      AcpAttachmentStore.prototype.save = original;
      await f.dispose();
    }
  },
);

test("queued ACP inputs read current memory only on actual execution through the scoped Host", async () => {
  let reads = 0;
  let index = "initial memory";
  const f = await fixture({
    memoryContext: {
      async buildPromptContext(target) {
        assert.equal(target.workspaceIdentity, workspace.workspaceIdentity);
        assert.equal(target.workspacePath, workspace.workspacePath);
        reads++;
        return index;
      },
    },
  });
  try {
    const first = f.prompt("memory-first");
    await waitFor(() => f.calls.length === 1);
    await f.prompt("memory-queued");
    assert.equal(reads, 1, "enqueue cannot preload stale memory");
    index = "memory updated by preceding turn";
    f.turns[0]!.resolve();
    await first;
    await waitFor(() => f.calls.length === 2);
    assert.equal(reads, 2);
    assert.ok(f.calls[1]!.blocks?.some((b) => b.type === "text" && b.text === index));
    f.turns[1]!.resolve();
    await waitFor(async () => (await f.read()).status === "idle");
  } finally {
    await f.dispose();
  }
});

test("ACP busy prompts are durable, idempotent and drain exactly once in FIFO order", async () => {
  const f = await fixture();
  try {
    const first = f.prompt("first");
    await waitFor(() => f.calls.length === 1);
    await Promise.all([f.prompt("second"), f.prompt("third"), f.prompt("second")]);
    assert.deepEqual(
      (await f.read()).queue.items.map((item) => item.commandId),
      ["second", "third"],
    );
    const disk = JSON.parse(await readFile(join(f.directory, `${f.target.id}.json`), "utf8"));
    assert.equal(disk.queue.items.length, 2);
    f.turns[0]!.resolve();
    await first;
    await waitFor(() => f.calls.length === 2);
    assert.equal(f.calls[1]!.text, "second");
    f.turns[1]!.resolve();
    await waitFor(() => f.calls.length === 3);
    f.turns[2]!.resolve();
    await waitFor(async () => (await f.read()).status === "idle");
    await f.prompt("second");
    assert.equal(f.calls.length, 3);
    assert.deepEqual(
      (await f.read()).entries.filter((e) => e.kind === "user").map((e) => e.id),
      ["user:first", "user:second", "user:third"],
    );
  } finally {
    await f.dispose();
  }
});

test("ACP failure before the first user row pauses inputs accepted during preparation", async () => {
  let rejectPreparation!: (error: Error) => void;
  const f = await fixture({
    skillsService: {
      async buildPromptContext(input) {
        if (input.prompt === "first")
          await new Promise<void>((_resolve, reject) => {
            rejectPreparation = reject;
          });
        return { prompt: input.prompt } as never;
      },
    },
  });
  try {
    const first = f.prompt("first");
    const failed = assert.rejects(first, /skill unavailable/);
    await waitFor(() => Boolean(rejectPreparation));
    await f.prompt("second");
    rejectPreparation(new Error("skill unavailable"));
    await failed;
    assert.equal((await f.read()).queue.autoDrain, false);
    assert.equal((await f.read()).queue.items[0]?.text, "second");
    assert.equal(f.calls.length, 0);
    await f.service.setQueueAutoDrain({ ...f.target, autoDrain: true });
    await waitFor(() => f.calls.length === 1);
    f.turns[0]!.resolve();
  } finally {
    await f.dispose();
  }
});

test("ACP cancellation/refusal/limits reported by the Agent never auto-send the next input", async () => {
  for (const reason of ["cancelled", "refusal", "max_tokens", "max_turn_requests"] as const) {
    const f = await fixture();
    try {
      const first = f.prompt("first");
      await waitFor(() => f.calls.length === 1);
      await f.prompt("second");
      f.setStopReason(reason);
      f.turns[0]!.resolve();
      await first;
      assert.equal((await f.read()).queue.autoDrain, false);
      assert.equal(
        (await f.read()).queue.pauseReason,
        reason === "cancelled" ? "stopped" : "error",
      );
      assert.equal(f.calls.length, 1);
    } finally {
      await f.dispose();
    }
  }
});

test("ACP Host disposal waits for a pending queue copy and never publishes its admission", async () => {
  const f = await fixture();
  const original = AcpAttachmentStore.prototype.save;
  let release!: () => void;
  AcpAttachmentStore.prototype.save = async function (...args) {
    if (args[1].length)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return original.apply(this, args);
  };
  try {
    const first = f.prompt("first");
    await waitFor(() => f.calls.length === 1);
    const queued = f.service.prompt({
      ...f.target,
      commandId: "second",
      text: "image",
      attachments: [
        {
          dataBase64: Buffer.from("image").toString("base64"),
          fileName: "image.png",
          mimeType: "image/png",
        },
      ],
    });
    const rejected = assert.rejects(queued, /closed/);
    await waitFor(() => Boolean(release));
    let disposed = false;
    const disposing = f.service.disposeAllAndWait().then(() => {
      disposed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(disposed, false);
    release();
    await rejected;
    await disposing;
    f.turns[0]!.resolve();
    await first;
    assert.equal((await f.read()).queue.items.length, 0);
    assert.deepEqual(await readdir(join(f.directory, "attachments", f.target.id)), []);
  } finally {
    release?.();
    AcpAttachmentStore.prototype.save = original;
    await f.dispose();
  }
});

test("ACP deletion receipts prevent a lost prompt ACK from resurrecting an input after restart", async () => {
  const f = await fixture();
  try {
    const first = f.prompt("first");
    await waitFor(() => f.calls.length === 1);
    await f.prompt("second");
    await f.service.deleteQueueItem({ ...f.target, queueItemId: "second" });
    await f.service.deleteQueueItem({ ...f.target, queueItemId: "second" });
    await f.prompt("second");
    assert.equal((await f.read()).queue.items.length, 0);
    await f.service.stop(f.target);
    await first;
    await f.restart();
    await f.prompt("second");
    assert.equal((await f.read()).queue.items.length, 0);
    assert.equal(f.calls.length, 1);
  } finally {
    await f.dispose();
  }
});

test("ACP queue persistence failure rolls back admission and deletes unaccepted attachment bytes", async () => {
  const f = await fixture();
  const file = join(f.directory, `${f.target.id}.json`);
  try {
    const first = f.prompt("first");
    await waitFor(() => f.calls.length === 1);
    const before = await readFile(file);
    await rm(file);
    await mkdir(file);
    await assert.rejects(
      f.service.prompt({
        ...f.target,
        commandId: "second",
        text: "image",
        attachments: [
          {
            dataBase64: Buffer.from("original").toString("base64"),
            fileName: "same.png",
            mimeType: "image/png",
          },
        ],
      }),
    );
    assert.equal((await f.read()).queue.items.length, 0);
    const attachmentDir = join(f.directory, "attachments", f.target.id);
    assert.deepEqual(await readdir(attachmentDir), []);
    await rm(file, { recursive: true });
    await writeFile(file, before);
    await f.prompt("second");
    assert.equal((await f.read()).queue.items.length, 1);
    f.turns[0]!.resolve();
    await first;
    await waitFor(() => f.calls.length === 2);
    f.turns[1]!.resolve();
  } finally {
    await f.dispose();
  }
});

test("ACP reserved input cannot be edited and an old preparation cannot consume its resumed replacement", async () => {
  let release!: () => void;
  let prepares = 0;
  const f = await fixture({
    skillsService: {
      async buildPromptContext(input) {
        if (input.prompt === "second" && ++prepares === 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return { prompt: input.prompt } as never;
      },
    },
  });
  try {
    const first = f.prompt("first");
    await waitFor(() => f.calls.length === 1);
    await f.prompt("second");
    f.turns[0]!.resolve();
    await first;
    await waitFor(() => Boolean(release));
    assert.equal((await f.read()).queue.items[0]?.state, "reserved");
    await assert.rejects(
      f.service.editQueueItem({ ...f.target, queueItemId: "second", text: "late" }),
      /not editable/,
    );
    await f.service.stop(f.target);
    await f.service.setQueueAutoDrain({ ...f.target, autoDrain: true });
    await waitFor(() => f.calls.length === 2);
    release();
    assert.equal(f.calls[1]?.text, "second");
    f.turns[1]!.resolve();
    await waitFor(async () => (await f.read()).status === "idle");
    assert.equal(f.calls.length, 2);
  } finally {
    release?.();
    await f.dispose();
  }
});

test("ACP queued-only conversation stays visible after first-turn preparation is stopped", async () => {
  let release!: () => void;
  const f = await fixture({
    skillsService: {
      async buildPromptContext(input) {
        if (input.prompt === "first")
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return { prompt: input.prompt } as never;
      },
    },
  });
  try {
    const first = f.prompt("first");
    await waitFor(() => Boolean(release));
    await f.prompt("second");
    assert.equal(isAcpHistorySession(await f.read()), true);
    await f.service.stop(f.target);
    release();
    await first;
    await f.restart();
    const restored = await f.read();
    assert.equal(restored.queue.autoDrain, false);
    assert.equal(isAcpHistorySession(restored), true);
    assert.equal(restored.entries.length, 0);
    assert.equal((await f.service.list(workspace)).length, 1);
    await f.service.setQueueAutoDrain({ ...f.target, autoDrain: true });
    await waitFor(() => f.calls.length === 1);
    assert.equal(f.calls[0]?.text, "second");
    f.turns[0]!.resolve();
  } finally {
    release?.();
    await f.dispose();
  }
});

test("ACP queue editing, reorder and delete are scoped and preserve input identity", async () => {
  const f = await fixture();
  try {
    const first = f.prompt("first");
    await waitFor(() => f.calls.length === 1);
    await f.prompt("second");
    await f.prompt("third");
    await f.prompt("fourth");
    await assert.rejects(
      f.service.editQueueItem({
        ...f.target,
        workspaceIdentity: "wrong",
        queueItemId: "second",
        text: "bad",
      }),
      /workspace/,
    );
    await f.service.editQueueItem({ ...f.target, queueItemId: "third", text: "edited" });
    await f.service.reorderQueueItem({
      ...f.target,
      queueItemId: "third",
      beforeQueueItemId: "second",
    });
    await f.service.deleteQueueItem({ ...f.target, queueItemId: "fourth" });
    assert.deepEqual(
      (await f.read()).queue.items.map((item) => item.text),
      ["edited", "second"],
    );
    f.turns[0]!.resolve();
    await first;
    await waitFor(() => f.calls.length === 2);
    assert.equal(f.calls[1]!.text, "edited");
    await assert.rejects(
      f.service.editQueueItem({ ...f.target, queueItemId: "third", text: "late" }),
      /not editable|missing/,
    );
    f.turns[1]!.resolve();
    await waitFor(() => f.calls.length === 3);
    f.turns[2]!.resolve();
  } finally {
    await f.dispose();
  }
});

test("ACP stop pauses pending input and resume waits for cancellation then drains", async () => {
  const f = await fixture();
  try {
    const first = f.prompt("first");
    await waitFor(() => f.calls.length === 1);
    await f.prompt("second");
    f.delayCancel();
    const stopped = f.service.stop(f.target);
    await waitFor(() => f.cancelling);
    assert.equal((await f.read()).queue.autoDrain, false);
    assert.equal((await f.read()).queue.pauseReason, "stopped");
    const resumed = f.service.setQueueAutoDrain({ ...f.target, autoDrain: true });
    assert.equal(f.calls.length, 1);
    f.releaseCancel();
    await stopped;
    await first;
    await resumed;
    await waitFor(() => f.calls.length === 2);
    assert.equal(f.closed, 1);
    f.turns[1]!.resolve();
  } finally {
    await f.dispose();
  }
});

test("ACP failures hold queued messages and new submissions cannot bypass them", async () => {
  const f = await fixture();
  try {
    const first = f.prompt("first");
    const failure = assert.rejects(first, /failed/);
    await waitFor(() => f.calls.length === 1);
    await f.prompt("second");
    f.turns[0]!.reject(new Error("failed"));
    await failure;
    await f.prompt("third");
    assert.equal((await f.read()).queue.pauseReason, "error");
    assert.equal(f.calls.length, 1);
    await f.service.setQueueAutoDrain({ ...f.target, autoDrain: true });
    await waitFor(() => f.calls.length === 2);
    f.turns[1]!.resolve();
    await waitFor(() => f.calls.length === 3);
    f.turns[2]!.resolve();
  } finally {
    await f.dispose();
  }
});

test("structured failure with end_turn pauses accepted queued input without automatic retry", async () => {
  const f = await fixture();
  try {
    const first = f.prompt("first");
    await waitFor(() => f.calls.length === 1);
    await f.prompt("second");
    await f.emit({
      kind: "failure",
      failure: {
        id: "timeout",
        revision: 1,
        severity: "error",
        category: "connection",
        title: "SSE timeout",
        actions: ["retry"],
      },
    });
    f.setStopReason("end_turn");
    f.turns[0]!.resolve();
    await first;
    const snapshot = await f.read();
    assert.equal(snapshot.status, "interrupted");
    assert.equal(snapshot.queue.pauseReason, "error");
    assert.equal(snapshot.queue.autoDrain, false);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(
      snapshot.queue.items.map((item) => item.commandId),
      ["second"],
    );
    await f.service.setQueueAutoDrain({ ...f.target, autoDrain: true });
    await waitFor(() => f.calls.length === 2);
    f.turns[1]!.resolve();
  } finally {
    await f.dispose();
  }
});

test("ACP Host restart holds queued input and never replays an admitted turn", async () => {
  const f = await fixture();
  try {
    const first = f.prompt("first");
    await waitFor(() => f.calls.length === 1);
    await f.prompt("second");
    await f.restart();
    f.turns[0]!.resolve();
    await first;
    const restored = await f.read();
    assert.equal(restored.status, "interrupted");
    assert.equal(restored.queue.autoDrain, false);
    assert.equal(restored.queue.items[0]!.commandId, "second");
    await f.service.refresh(f.target);
    assert.equal(f.calls.length, 1);
    await f.service.setQueueAutoDrain({ ...f.target, autoDrain: true });
    await waitFor(() => f.calls.length === 2);
    assert.equal(f.calls[1]!.text, "second");
    f.turns[1]!.resolve();
  } finally {
    await f.dispose();
  }
});

test("ACP send now selects one queued input after closing the old process", async () => {
  const f = await fixture();
  try {
    const first = f.prompt("first");
    await waitFor(() => f.calls.length === 1);
    await f.prompt("second");
    await f.prompt("third");
    await f.service.setQueueAutoDrain({ ...f.target, autoDrain: false });
    await f.service.sendQueuedNow({ ...f.target, queueItemId: "third" });
    await first;
    await waitFor(() => f.calls.length === 2);
    assert.equal(f.closed, 1);
    assert.equal(f.calls[1]!.text, "third");
    assert.equal((await f.read()).queue.autoDrain, false);
    f.turns[1]!.resolve();
    await waitFor(async () => (await f.read()).status === "idle");
    assert.deepEqual(
      (await f.read()).queue.items.map((i) => i.commandId),
      ["second"],
    );
  } finally {
    await f.dispose();
  }
});

test("ACP queue freezes attachments, persists only refs and transfers them to the user row", async () => {
  const f = await fixture();
  try {
    const path = join(f.directory, "source.png");
    await writeFile(path, "original-image");
    const first = f.prompt("first");
    await waitFor(() => f.calls.length === 1);
    await f.service.prompt({
      ...f.target,
      commandId: "image",
      text: "image",
      attachments: [{ path, fileName: "source.png", mimeType: "image/png" }],
    });
    await writeFile(path, "changed-image");
    const queued = (await f.read()).queue.items[0]!;
    assert.equal(queued.attachments.length, 1);
    assert.equal(
      (await readFile(join(f.directory, `${f.target.id}.json`), "utf8")).includes("dataBase64"),
      false,
    );
    f.turns[0]!.resolve();
    await first;
    await waitFor(() => f.calls.length === 2);
    const block = f.calls[1]!.blocks?.find((b) => b.type === "image");
    assert.equal(
      block?.type === "image" ? Buffer.from(block.data, "base64").toString() : null,
      "original-image",
    );
    assert.deepEqual((await f.read()).entries.find((e) => e.id === "user:image")?.kind, "user");
    f.turns[1]!.resolve();
  } finally {
    await f.dispose();
  }
});

test("ACP exit pauses queue and removal cannot resurrect it from late replies", async () => {
  const f = await fixture();
  try {
    const first = f.prompt("first");
    await waitFor(() => f.calls.length === 1);
    await f.prompt("second");
    f.exit();
    await waitFor(async () => (await f.read()).queue.autoDrain === false);
    await f.service.remove(f.target);
    f.turns[0]!.resolve();
    await first;
    assert.equal(f.calls.length, 1);
    await assert.rejects(f.read());
  } finally {
    await f.dispose();
  }
});
