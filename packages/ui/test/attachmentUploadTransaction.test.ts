import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { BufferWriter, serialize } from "@zcode/rpc";
import { ServiceChannels } from "@zcode/shared";
import { PROTOCOL_V4_LIMITS } from "@zcode/shared/zcode-protocol-v4";
import {
  uploadAttachmentBytes,
  uploadAttachmentTransaction,
  type AttachmentUploadTransactionPort,
} from "../src/v4/attachmentUploadTransaction.js";

function fixture(overrides: Partial<AttachmentUploadTransactionPort> = {}) {
  const begins: Parameters<AttachmentUploadTransactionPort["begin"]>[0][] = [];
  const chunks: Parameters<AttachmentUploadTransactionPort["chunk"]>[0][] = [];
  const commits: string[] = [];
  const aborts: string[] = [];
  const port: AttachmentUploadTransactionPort = {
    async begin(params) {
      begins.push(params);
      return { uploadId: params.uploadId, state: "staging", nextChunkIndex: 0 };
    },
    async chunk(params) {
      chunks.push(params);
      return { uploadId: params.uploadId, nextChunkIndex: params.chunkIndex + 1 };
    },
    async commit({ uploadId }) {
      commits.push(uploadId);
      return { ref: "/saved/snapshot" };
    },
    async abort({ uploadId }) {
      aborts.push(uploadId);
    },
    ...overrides,
  };
  return { port, begins, chunks, commits, aborts };
}
const input = (bytes = new Uint8Array([0, 255, 128, 1])) => ({
  fileName: "reference.bin",
  mime: "application/octet-stream",
  bytes,
});

test("shared attachment transaction preserves full binary bytes, SHA256 and bounded physical frames", async () => {
  const f = fixture();
  const bytes = Uint8Array.from({ length: 2 * 384 * 1024 + 37 }, (_, i) => i % 256);
  const result = await uploadAttachmentBytes(f.port, input(bytes));
  assert.equal(result.ref, "/saved/snapshot");
  assert.equal(f.begins.length, 1);
  assert.equal(f.begins[0]!.totalBytes, bytes.length);
  assert.equal(f.begins[0]!.totalChunks, 3);
  assert.equal(f.begins[0]!.checksum, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  assert.deepEqual(
    Buffer.concat(f.chunks.map((chunk) => Buffer.from(chunk.dataBase64, "base64"))),
    Buffer.from(bytes),
  );
  for (const chunk of f.chunks) {
    const writer = new BufferWriter();
    serialize(writer, [100, 2_147_483_647, ServiceChannels.WorkTask, "attachmentChunk"]);
    serialize(writer, [{ workspacePath: `/workspace/${"a".repeat(4096)}`, ...chunk }]);
    assert.ok(writer.buffer.byteLength < PROTOCOL_V4_LIMITS.maxFrameBytes);
  }
  assert.deepEqual(f.commits, [f.begins[0]!.uploadId]);
  assert.deepEqual(f.aborts, []);
});

test("empty files commit without chunks and the 20MiB limit is checked before uploading", async () => {
  const f = fixture();
  await uploadAttachmentBytes(f.port, input(new Uint8Array()));
  assert.equal(f.begins[0]!.totalChunks, 0);
  assert.deepEqual(f.chunks, []);
  const oversized = fixture();
  await assert.rejects(
    uploadAttachmentBytes(
      oversized.port,
      input(new Uint8Array(PROTOCOL_V4_LIMITS.attachmentMaxBytes + 1)),
    ),
    /payloadTooLarge/,
  );
  assert.deepEqual(oversized.begins, []);
});

test("cancellation cleans the started upload without committing", async () => {
  const controller = new AbortController();
  const f = fixture({
    async chunk(params) {
      controller.abort();
      return { uploadId: params.uploadId, nextChunkIndex: params.chunkIndex + 1 };
    },
  });
  await assert.rejects(uploadAttachmentBytes(f.port, input(), { signal: controller.signal }), {
    name: "AbortError",
  });
  assert.deepEqual(f.aborts, [f.begins[0]!.uploadId]);
  assert.deepEqual(f.commits, []);
  const never = fixture();
  await assert.rejects(uploadAttachmentBytes(never.port, input(), { signal: controller.signal }), {
    name: "AbortError",
  });
  assert.deepEqual(never.begins, []);
});

test("lost begin reply also aborts staging and invalid progress preserves the original failure", async () => {
  const unknown = fixture({
    async begin() {
      throw new Error("begin reply lost");
    },
  });
  await assert.rejects(uploadAttachmentBytes(unknown.port, input()), /begin reply lost/);
  assert.equal(unknown.aborts.length, 1);
  const invalid = fixture({
    async chunk(params) {
      return { uploadId: params.uploadId, nextChunkIndex: 0 };
    },
  });
  await assert.rejects(uploadAttachmentBytes(invalid.port, input()), /invalidServerProgress/);
  assert.deepEqual(invalid.aborts, [invalid.begins[0]!.uploadId]);
  assert.deepEqual(invalid.commits, []);
});

test("ordinary chat wrapper retains session and workspace identity and validates base64 before IO", async () => {
  const f = fixture();
  const workspace = { workspacePath: "/project", workspaceIdentity: "isolated-workspace" };
  const agent = {
    attachmentBeginV4: f.port.begin,
    attachmentChunkV4: f.port.chunk,
    attachmentCommitV4: f.port.commit,
    attachmentAbortV4: f.port.abort,
  };
  const attachment = {
    sessionId: "session",
    fileName: "file.bin",
    mime: "application/octet-stream",
    dataBase64: "AP+AAQ==",
  };
  await uploadAttachmentTransaction(agent, workspace, attachment);
  for (const data of [...f.begins, ...f.chunks]) {
    assert.equal(Reflect.get(data, "workspacePath"), workspace.workspacePath);
    assert.equal(Reflect.get(data, "workspaceIdentity"), workspace.workspaceIdentity);
    assert.equal(Reflect.get(data, "sessionId"), attachment.sessionId);
  }
  assert.deepEqual(Buffer.from(f.chunks[0]!.dataBase64, "base64"), Buffer.from([0, 255, 128, 1]));
  const calls = f.begins.length;
  await assert.rejects(
    uploadAttachmentTransaction(agent, workspace, { ...attachment, dataBase64: "!invalid!" }),
    /invalidBase64/,
  );
  assert.equal(f.begins.length, calls);
});

test("HTTP attachment checksum matches Node SHA-256 for empty, padding-boundary, offset and maximum files", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
  try {
    for (const size of [0, 1, 55, 56, 63, 64, 65, PROTOCOL_V4_LIMITS.attachmentMaxBytes]) {
      const backing = Uint8Array.from({ length: size + 9 }, (_, i) => i % 256);
      const bytes = backing.subarray(5, 5 + size);
      const f = fixture();
      await uploadAttachmentBytes(f.port, input(bytes));
      assert.equal(
        f.begins[0]!.checksum,
        `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      );
      assert.deepEqual(
        Buffer.concat(f.chunks.map((chunk) => Buffer.from(chunk.dataBase64, "base64"))),
        Buffer.from(bytes),
      );
      assert.equal(f.commits.length, 1);
    }
    const f = fixture();
    await uploadAttachmentTransaction(
      {
        attachmentBeginV4: f.port.begin,
        attachmentChunkV4: f.port.chunk,
        attachmentCommitV4: f.port.commit,
        attachmentAbortV4: f.port.abort,
      },
      { workspacePath: "/http" },
      { sessionId: "chat", fileName: "image.png", mime: "image/png", dataBase64: "AP+AAQ==" },
    );
    assert.equal(
      f.begins[0]!.checksum,
      `sha256:${createHash("sha256")
        .update(Buffer.from([0, 255, 128, 1]))
        .digest("hex")}`,
    );
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
});

test("HTTP checksum yields to cancellation before starting any upload", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 0);
  const f = fixture();
  try {
    await assert.rejects(
      uploadAttachmentBytes(f.port, input(new Uint8Array(PROTOCOL_V4_LIMITS.attachmentMaxBytes)), {
        signal: controller.signal,
      }),
      { name: "AbortError" },
    );
    assert.deepEqual(f.begins, []);
    assert.deepEqual(f.aborts, []);
  } finally {
    clearTimeout(timer);
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
});

test("native checksum failure is reported before upload begins", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      subtle: {
        async digest() {
          throw new Error("Synthetic digest failure");
        },
      },
    },
  });
  const f = fixture();
  try {
    await assert.rejects(
      uploadAttachmentBytes(f.port, input()),
      /fault\.attachment\.checksumFailed/,
    );
    assert.deepEqual(f.begins, []);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
});
