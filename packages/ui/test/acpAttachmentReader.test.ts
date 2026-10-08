import assert from "node:assert/strict";
import test from "node:test";
import { createAcpAttachmentReader } from "../src/hooks/useAcpAttachmentReader.js";

const scope = {
  workspacePath: "/remote/images",
  workspaceIdentity: "remote:images",
  remoteSessionId: "attachment:one",
};
const sessionId = "11111111-1111-4111-8111-111111111111";
const ref = "acp-attachment:22222222-2222-4222-8222-222222222222/0";

test("ACP preview reassembles bounded Host chunks using the exact workspace and session", async () => {
  const bytes = Buffer.from("image".repeat(80000));
  const calls: unknown[] = [];
  const reader = createAcpAttachmentReader(
    {
      async readAttachment(input) {
        calls.push(input);
        const offset = input.offset ?? 0,
          end = Math.min(bytes.length, offset + (input.limit ?? 128 * 1024));
        return {
          dataBase64: bytes.subarray(offset, end).toString("base64"),
          mediaType: "image/png",
          totalBytes: bytes.length,
          nextOffset: end < bytes.length ? end : null,
        };
      },
    },
    scope,
    sessionId,
  );
  const result = await reader.readAttachment({ sessionId, ref });
  assert.deepEqual(Buffer.from(result.bytes), bytes);
  assert.equal(result.mediaType, "image/png");
  assert.equal(calls.length, 4);
  const range = await reader.readAttachmentRange({ sessionId, ref, offset: 17, limit: 37 });
  assert.deepEqual(Buffer.from(range.bytes), bytes.subarray(17, 54));
  assert.equal(range.nextOffset, 54);
  for (const call of calls)
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(call as object).filter(([key]) => !["offset", "limit"].includes(key)),
      ),
      { ...scope, id: sessionId, ref },
    );
  await assert.rejects(reader.readAttachment({ sessionId: "other", ref }), /session/);
});

test("ACP preview cancellation stops subsequent RPC reads and invalid chunks are rejected", async () => {
  const controller = new AbortController();
  let calls = 0;
  const reader = createAcpAttachmentReader(
    {
      async readAttachment() {
        calls++;
        controller.abort();
        return { dataBase64: "YQ==", mediaType: "image/png", totalBytes: 2, nextOffset: 1 };
      },
    },
    scope,
    sessionId,
  );
  await assert.rejects(reader.readAttachment({ sessionId, ref, signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(calls, 1);
  const invalid = createAcpAttachmentReader(
    {
      async readAttachment() {
        return { dataBase64: "YQ==", mediaType: "image/png", totalBytes: 2, nextOffset: 0 };
      },
    },
    scope,
    sessionId,
  );
  await assert.rejects(invalid.readAttachment({ sessionId, ref }), /chunk/);
  const oversized = createAcpAttachmentReader(
    {
      async readAttachment() {
        return { dataBase64: "YWI=", mediaType: "image/png", totalBytes: 2, nextOffset: null };
      },
    },
    scope,
    sessionId,
  );
  await assert.rejects(
    oversized.readAttachmentRange({ sessionId, ref, offset: 0, limit: 1 }),
    /chunk/,
  );
});
