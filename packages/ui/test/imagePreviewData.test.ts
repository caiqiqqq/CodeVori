import assert from "node:assert/strict";
import { test } from "node:test";
import { ImageDownloadError, readBoundedImageBlob } from "../src/lib/imagePreviewData.js";

test("bounded image reader rejects oversized advertised content before reading it", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("small fixture", { headers: { "content-length": String(51 * 1024 * 1024) } });
  try {
    await assert.rejects(
      readBoundedImageBlob("https://example.invalid/image"),
      (error) => error instanceof ImageDownloadError && error.code === "file_too_large",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("bounded image reader rejects a stream whose actual bytes exceed its header", async () => {
  const original = globalThis.fetch;
  let canceled = false;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(50 * 1024 * 1024 + 1));
        },
        cancel() {
          canceled = true;
        },
      }),
      { headers: { "content-type": "image/png", "content-length": "1" } },
    );
  try {
    await assert.rejects(
      readBoundedImageBlob("https://example.invalid/image"),
      (error) => error instanceof ImageDownloadError && error.code === "file_too_large",
    );
    assert.equal(canceled, true);
  } finally {
    globalThis.fetch = original;
  }
});

test("bounded image reader preserves exact accepted bytes and MIME type", async () => {
  const blob = await readBoundedImageBlob("data:image/png;base64,AQID");
  assert.equal(blob.type, "image/png");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([1, 2, 3]));
});
