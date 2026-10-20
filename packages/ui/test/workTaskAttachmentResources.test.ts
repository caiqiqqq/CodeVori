import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkTaskAttachmentResources } from "../src/hooks/workTaskAttachmentResources.js";

const image = {
  id: "image",
  filename: "image.png",
  mimeType: "image/png",
  sizeBytes: 0,
  localPath: "/synthetic/snapshot.png",
};

function fixture(overrides = {}) {
  const bytes = new Uint8Array(384 * 1024 + 13).fill(17);
  const reads: { offset: number; length: number }[] = [];
  const created: Blob[] = [];
  const revoked: string[] = [];
  const decoded: string[] = [];
  const files = {
    async stat() {
      return { type: "file" as const, size: bytes.length };
    },
    async readFileRange(input: { offset: number; length: number }) {
      reads.push(input);
      return bytes.slice(input.offset, input.offset + input.length);
    },
    ...overrides,
  };
  const environment = {
    createObjectURL(blob: Blob) {
      created.push(blob);
      return `blob:synthetic-${created.length}`;
    },
    revokeObjectURL(url: string) {
      revoked.push(url);
    },
    async decodeImage(url: string) {
      decoded.push(url);
    },
  };
  const resources = new WorkTaskAttachmentResources(files, environment);
  return { resources, files, environment, bytes, reads, created, revoked, decoded };
}

test("thumbnail and opening share one bounded read and decoded resource", async () => {
  const f = fixture();
  f.resources.sync([image]);
  assert.equal(f.resources.get(image).loading, true);
  const [thumbnail, preview] = await Promise.all([
    f.resources.load(image),
    f.resources.load(image, true),
  ]);
  assert.equal(thumbnail.url, preview.url);
  assert.equal(thumbnail.url, "blob:synthetic-1");
  assert.deepEqual(
    f.reads.map(({ offset, length }) => [offset, length]),
    [
      [0, 384 * 1024],
      [384 * 1024, 13],
    ],
  );
  assert.deepEqual(new Uint8Array(await f.created[0].arrayBuffer()), f.bytes);
  assert.deepEqual(f.decoded, [thumbnail.url]);
  await f.resources.load(image, true);
  f.resources.sync([{ ...image }]);
  assert.equal(f.created.length, 1, "render/notifications/open never reread a ready resource");
  f.resources.clear();
  assert.deepEqual(f.revoked, [thumbnail.url]);
});

test("removed attachments invalidate delayed IO and never publish a URL", async () => {
  let finish!: (value: { type: "file"; size: number }) => void;
  const f = fixture({ stat: () => new Promise((resolve) => (finish = resolve)) });
  f.resources.sync([image]);
  const pending = f.resources.load(image);
  f.resources.sync([]);
  finish({ type: "file", size: 1 });
  await pending;
  assert.equal(f.reads.length, 0);
  assert.equal(f.created.length, 0);
  assert.equal(f.resources.get(image).url, undefined);
});

test("cleanup during a chunk stops subsequent reads; clearing remains reusable", async () => {
  let finish!: (bytes: Uint8Array) => void;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => (started = resolve));
  const f = fixture({
    readFileRange: () => {
      started();
      return new Promise<Uint8Array>((resolve) => (finish = resolve));
    },
  });
  f.resources.sync([image]);
  const pending = f.resources.load(image);
  await reading;
  f.resources.clear();
  finish(new Uint8Array(384 * 1024));
  await pending;
  assert.equal(f.created.length, 0);
  // React StrictMode 的 effect 重挂载仍可重新加载，旧请求不能恢复旧资源。
  const draft = { ...image, id: "draft", objectUrl: "blob:draft" };
  f.resources.sync([draft]);
  assert.equal((await f.resources.load(draft)).url, "blob:draft");
  f.resources.clear();
  assert.deepEqual(f.revoked, [], "borrowed composer URLs belong to the composer");
});

test("decode failure releases owned URL and only an explicit click retries", async () => {
  const f = fixture();
  let damaged = true;
  f.environment.decodeImage = async () => {
    if (damaged) throw new Error("damaged image");
  };
  f.resources.sync([image]);
  assert.equal((await f.resources.load(image)).error, true);
  assert.deepEqual(f.revoked, ["blob:synthetic-1"]);
  f.resources.sync([image]);
  await f.resources.load(image);
  assert.equal(f.created.length, 1);
  damaged = false;
  assert.equal((await f.resources.load(image, true)).url, "blob:synthetic-2");
  f.resources.clear();
  assert.deepEqual(f.revoked, ["blob:synthetic-1", "blob:synthetic-2"]);
});

test("invalid sizes and chunks fail before creating object URLs", async () => {
  for (const size of [-1, 0.5, NaN, Infinity, 20 * 1024 * 1024 + 1]) {
    const f = fixture({
      async stat() {
        return { type: "file", size };
      },
    });
    assert.equal((await f.resources.load(image)).error, true, `size ${size}`);
    assert.equal(f.reads.length, 0);
    assert.equal(f.created.length, 0);
  }
  for (const chunkSize of [0, 384 * 1024 + 1]) {
    const f = fixture({
      async readFileRange() {
        return new Uint8Array(chunkSize);
      },
    });
    assert.equal((await f.resources.load(image)).error, true);
    assert.equal(f.created.length, 0);
  }
});

test("multiple images release only removed resources; video and PDF load on demand", async () => {
  const f = fixture();
  const second = { ...image, id: "second", localPath: "/synthetic/second.png" };
  const video = { ...image, id: "video", mimeType: "video/mp4" };
  const pdf = { ...image, id: "pdf", mimeType: "application/pdf" };
  f.resources.sync([image, second, video, pdf]);
  await Promise.all([f.resources.load(image), f.resources.load(second)]);
  assert.equal(f.created.length, 2);
  f.resources.sync([second, video, pdf]);
  assert.deepEqual(f.revoked, ["blob:synthetic-1"]);
  await f.resources.load(video);
  await f.resources.load(pdf);
  assert.equal(f.created.length, 4);
  assert.equal(f.decoded.length, 2);
  f.resources.clear();
  assert.equal(f.revoked.length, 4);
});

test("disconnected/unsupported Host cannot read files or fall back to local services", async () => {
  const f = fixture();
  const resources = new WorkTaskAttachmentResources(null, f.environment);
  resources.sync([image]);
  assert.equal((await resources.load(image)).error, true);
  assert.equal(f.created.length, 0);
  assert.equal(f.reads.length, 0);
});
