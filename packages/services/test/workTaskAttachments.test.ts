import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProxyChannel } from "@zcode/rpc";
import { workTaskCreateSchema, type WorkTask } from "@zcode/shared";
import type { IWorkTaskService } from "../src/session/contract.js";
import { WorkTaskAttachmentStore } from "../src/session/workTaskAttachmentStore.js";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { WorkTaskService } from "../src/session/workTaskService.js";

const scope = { workspacePath: "/project" };
const draft = {
  ...scope,
  title: "Attachments",
  prompt: "Read these files",
  execution: {
    kind: "api" as const,
    modelSelection: { providerId: "test", modelId: "test" },
    mode: "build" as const,
  },
};
const checksum = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "zcode-task-attachments-"));
  const root = join(dir, "attachments");
  const stores: WorkTaskAttachmentStore[] = [];
  const services: WorkTaskService[] = [];
  const runs: WorkTask[] = [];
  const service = () => {
    const store = new WorkTaskAttachmentStore(root);
    stores.push(store);
    const owner = new WorkTaskService({
      repo: new WorkTaskRepo(join(dir, "tasks.sqlite")),
      attachments: store,
      pollIntervalMs: 10,
      execute: async (task) => {
        runs.push(task);
        if (runs.length === 3) throw new Error("feedback failed");
      },
    });
    services.push(owner);
    return owner;
  };
  return {
    dir,
    root,
    runs,
    service,
    async cleanup() {
      for (const owner of services) await owner.disposeAllAndWait();
      for (const store of stores) await store.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function settled(owner: WorkTaskService, id: string) {
  for (let i = 0; i < 100; i++) {
    const task = (await owner.list(scope)).tasks.find((row) => row.id === id)!;
    if (["review", "failed"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("task did not finish");
}

test("task schemas keep old text drafts valid and bound attachments, mentions and editor state", () => {
  assert.equal(workTaskCreateSchema.safeParse(draft).success, true);
  for (const path of [
    "/outside",
    "../outside",
    "a/../../outside",
    "C:\\outside",
    "a\\..\\outside",
  ]) {
    assert.equal(
      workTaskCreateSchema.safeParse({ ...draft, workspaceFiles: [path] }).success,
      false,
    );
  }
  assert.equal(
    workTaskCreateSchema.safeParse({ ...draft, workspaceFiles: ["src/main.ts"] }).success,
    true,
  );
  assert.equal(
    workTaskCreateSchema.safeParse({ ...draft, promptEditorState: "invalid" }).success,
    false,
  );
  const ref = { ref: "/saved", fileName: "file.txt", mime: "text/plain", bytes: 1 };
  assert.equal(
    workTaskCreateSchema.safeParse({ ...draft, attachments: Array(9).fill(ref) }).success,
    false,
  );
  assert.equal(
    workTaskCreateSchema.safeParse({ ...draft, attachments: [{ ...ref, bytes: 21 * 1024 * 1024 }] })
      .success,
    false,
  );
});

test("local attachments are immutable snapshots, persist after restart and reject foreign refs", async () => {
  const f = await fixture();
  try {
    const source = join(f.dir, "reference.bin");
    const bytes = Buffer.from([0, 1, 255, 4]);
    await writeFile(source, bytes);
    const owner = f.service();
    const attachment = await owner.attachmentImport({
      ...scope,
      localPath: source,
      fileName: "reference.bin",
      mime: "application/octet-stream",
    });
    const task = await owner.create({
      ...draft,
      attachments: [attachment],
      workspaceFiles: ["src/main.ts"],
      promptEditorState: '{"root":{"children":[]}}',
    });
    assert.equal(f.runs.length, 0);
    await writeFile(source, "changed");
    assert.deepEqual(await readFile(attachment.ref), bytes);
    await assert.rejects(
      owner.create({ ...draft, workspacePath: "/other", attachments: [attachment] }),
      /attachment-scope/,
    );
    await assert.rejects(
      owner.create({ ...draft, attachments: [{ ...attachment, ref: source }] }),
      /attachment-scope/,
    );
    await owner.disposeAllAndWait();
    const restored = (await f.service().list(scope)).tasks[0]!;
    assert.deepEqual(restored.attachments, task.attachments);
    assert.deepEqual(restored.workspaceFiles, ["src/main.ts"]);
    assert.equal(restored.promptEditorState, task.promptEditorState);
  } finally {
    await f.cleanup();
  }
});

test("binary chunks validate order, checksum, scope and preserve complete bytes without an Agent", async () => {
  const f = await fixture();
  try {
    const owner = f.service();
    const bytes = Buffer.from([0, 255, 1, 2, 3, 4]);
    const target = { ...scope, uploadId: "upload-binary" };
    const begin = {
      ...target,
      fileName: "binary.bin",
      mime: "application/octet-stream",
      totalBytes: bytes.length,
      totalChunks: 2,
      checksum: checksum(bytes),
    };
    await owner.attachmentBegin(begin);
    await assert.rejects(
      owner.attachmentChunk({ ...target, chunkIndex: 1, dataBase64: "AgME" }),
      /chunk-order/,
    );
    await assert.rejects(
      owner.attachmentChunk({
        ...target,
        workspacePath: "/other",
        chunkIndex: 0,
        dataBase64: "AP8B",
      }),
      /upload-not-found/,
    );
    const first = { ...target, chunkIndex: 0, dataBase64: bytes.subarray(0, 3).toString("base64") };
    assert.equal((await owner.attachmentChunk(first)).nextChunkIndex, 1);
    assert.equal((await owner.attachmentChunk(first)).nextChunkIndex, 1);
    await owner.attachmentChunk({
      ...target,
      chunkIndex: 1,
      dataBase64: bytes.subarray(3).toString("base64"),
    });
    const saved = await owner.attachmentCommit(target);
    assert.deepEqual(await readFile(saved.ref), bytes);
    assert.deepEqual(await owner.attachmentCommit(target), saved);
    assert.equal((await owner.attachmentBegin(begin)).state, "committed");
    const another = { ...target, uploadId: "upload-another" };
    await owner.attachmentBegin({ ...begin, ...another });
    assert.deepEqual(
      await owner.attachmentCommit(target),
      saved,
      "starting another file must not forget a committed upload awaiting its ACK",
    );
    await owner.attachmentAbort(another);
    assert.equal(f.runs.length, 0);
    await owner.attachmentAbort(target);
    assert.deepEqual(await readFile(saved.ref), bytes, "abort must not delete committed content");

    const bad = { ...target, uploadId: "upload-bad" };
    await owner.attachmentBegin({
      ...begin,
      ...bad,
      totalChunks: 1,
      checksum: checksum(Buffer.from("wrong!")),
    });
    await owner.attachmentChunk({ ...bad, chunkIndex: 0, dataBase64: bytes.toString("base64") });
    await assert.rejects(owner.attachmentCommit(bad), /checksum/);
    await owner.attachmentAbort(bad);
    assert.equal(
      (await readdir(f.root)).some((name) => name.startsWith(".upload-")),
      false,
    );
    await assert.rejects(
      owner.attachmentImport({
        ...scope,
        localPath: f.dir,
        fileName: "folder",
        mime: "application/octet-stream",
      }),
      /attachment-not-file/,
    );
    await assert.rejects(
      owner.attachmentBegin({ ...begin, remoteSessionId: "remote" }),
      /remote-unsupported/,
    );
  } finally {
    await f.cleanup();
  }
});

test("local snapshots preserve long filename extensions and disposal joins in-flight imports", async () => {
  const f = await fixture();
  try {
    const source = join(f.dir, "source.txt");
    await writeFile(source, "content");
    const store = new WorkTaskAttachmentStore(f.root);
    const input = {
      ...scope,
      localPath: source,
      fileName: `${"long".repeat(60)}.txt`,
      mime: "text/plain",
    };
    const attachment = await store.importFile(input);
    assert.ok(attachment.ref.endsWith(".txt"));
    const pending = store.importFile(input);
    const rejected = assert.rejects(pending, /host-closed/);
    await store.dispose();
    await rejected;
    assert.equal(
      (await readdir(f.root)).some((name) => name.startsWith(".upload-")),
      false,
    );
    assert.equal(await readFile(attachment.ref, "utf8"), "content");
  } finally {
    await f.cleanup();
  }
});

test("public Host RPC saves binary attachment references with task records without starting an Agent", async () => {
  const f = await fixture();
  try {
    const channel = ProxyChannel.fromService(f.service());
    const client = ProxyChannel.toService<IWorkTaskService>({
      call: (name, args) => channel.call(undefined, name, args),
      listen: (name, args) => channel.listen(undefined, name, args),
    });
    const bytes = Buffer.from([0, 255, 10]);
    const target = { ...scope, uploadId: "upload-public-rpc" };
    const metadata = { fileName: "public.bin", mime: "application/octet-stream" };
    await client.attachmentBegin({
      ...target,
      ...metadata,
      totalBytes: bytes.length,
      totalChunks: 1,
      checksum: checksum(bytes),
    });
    await client.attachmentChunk({
      ...target,
      chunkIndex: 0,
      dataBase64: bytes.toString("base64"),
    });
    const attachment = {
      ...(await client.attachmentCommit(target)),
      ...metadata,
      bytes: bytes.length,
    };
    const task = await client.create({
      ...draft,
      attachments: [attachment],
      workspaceFiles: ["src/main.ts"],
    });
    assert.deepEqual((await client.list(scope)).tasks[0]!.attachments, task.attachments);
    assert.deepEqual(await readFile(attachment.ref), bytes);
    assert.equal(f.runs.length, 0);
    await assert.rejects(
      client.attachmentChunk({ ...target, chunkIndex: 0, dataBase64: "!invalid!" }),
    );
    await assert.rejects(
      client.attachmentBegin({
        ...target,
        workspaceIdentity: "remote-target",
        ...metadata,
        totalBytes: 0,
        totalChunks: 0,
        checksum: checksum(Buffer.alloc(0)),
      }),
      /remote-unsupported/,
    );
  } finally {
    await f.cleanup();
  }
});

test("editing removes assets, retries keep run assets, feedback and its retry never resend originals", async () => {
  const f = await fixture();
  try {
    const source = join(f.dir, "reference.txt");
    await writeFile(source, "reference");
    const owner = f.service();
    const attachment = await owner.attachmentImport({
      ...scope,
      localPath: source,
      fileName: "reference.txt",
      mime: "text/plain",
    });
    const task = await owner.create({
      ...draft,
      attachments: [attachment],
      workspaceFiles: ["src/main.ts"],
    });
    await owner.start({ ...scope, id: task.id });
    await settled(owner, task.id);
    assert.equal(f.runs[0]!.runUsesPromptAssets, true);
    await owner.start({ ...scope, id: task.id, feedback: "continue" });
    await settled(owner, task.id);
    assert.equal(f.runs[1]!.runUsesPromptAssets, false);
    await owner.start({ ...scope, id: task.id, feedback: "try again" });
    await settled(owner, task.id);
    await owner.start({ ...scope, id: task.id });
    await settled(owner, task.id);
    assert.equal(f.runs[3]!.runUsesPromptAssets, false);
    assert.equal(f.runs[3]!.runText, "try again");
    const unused = await owner.create({
      ...draft,
      attachments: [attachment],
      workspaceFiles: ["src/main.ts"],
    });
    const edited = await owner.update({
      ...draft,
      id: unused.id,
      prompt: "new description",
      attachments: [],
      workspaceFiles: [],
    });
    assert.deepEqual(edited.attachments, []);
    assert.deepEqual(edited.workspaceFiles, []);
    assert.equal(edited.runUsesPromptAssets, true);
    assert.equal(await readFile(attachment.ref, "utf8"), "reference");
  } finally {
    await f.cleanup();
  }
});
