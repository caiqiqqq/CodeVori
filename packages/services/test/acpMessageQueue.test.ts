import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import { isAcpHistorySession, type AcpStopReason } from "@zcode/shared";
import { AcpAttachmentStore } from "../src/acp/acpAttachmentStore.js";

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
  let cancelRelease: (() => void) | undefined;
  let delayCancel = false;
  let closed = 0;
  let stopReason: AcpStopReason | undefined;
  const connect: AcpConnectionFactory = async (input) => {
    exit = input.onExit;
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
