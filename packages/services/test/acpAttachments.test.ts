import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import { AcpAttachmentStore } from "../src/acp/acpAttachmentStore.js";

const workspace = { workspacePath: "/fixture/images", workspaceIdentity: "remote:images" };
const image = Buffer.from("sent-image".repeat(18000));

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const inline = [{ fileName: "x.png", mimeType: "image/png", dataBase64: "cG5n" }];

function connection(
  onPrompt: (blocks: unknown) => void = () => {},
  imageSupported = true,
): AcpConnectionFactory {
  return async () => ({
    sessionId: "fixture-native",
    configOptions: [],
    modeState: null,
    promptCapabilities: { image: imageSupported, embeddedContext: true },
    async setConfigOption() {
      return [];
    },
    async setMode() {},
    async prompt(_text, blocks) {
      onPrompt(blocks);
    },
    async cancel() {},
    close() {},
  });
}

test("ACP persists immutable scoped attachment refs; restart, chunked read and deletion need no Agent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-sent-attachments-"));
  const source = join(directory, "source.png");
  let prompts = 0;
  let connects = 0;
  const factory = connection(() => prompts++);
  const connect: AcpConnectionFactory = async (input) => {
    connects++;
    return factory(input);
  };
  let service = createAcpService({ directory, connect });
  try {
    await writeFile(source, image);
    const session = await service.create({ ...workspace, agent: "codex", deferPersistence: true });
    const input = {
      ...workspace,
      id: session.id,
      commandId: "first",
      text: "See images",
      attachments: [
        { fileName: "same.png", mimeType: "image/png", path: source },
        {
          fileName: "same.png",
          mimeType: "image/png",
          dataBase64: Buffer.from("second").toString("base64"),
        },
        {
          fileName: "notes.txt",
          mimeType: "text/plain",
          dataBase64: Buffer.from("notes").toString("base64"),
        },
      ],
    };
    await service.prompt(input);
    await service.prompt(input);
    assert.equal(prompts, 1);
    const snapshot = await service.read({ ...workspace, id: session.id });
    const entry = snapshot.entries[0];
    assert.equal(entry?.kind, "user");
    if (entry?.kind !== "user") throw new Error("missing input");
    assert.equal(entry.attachments?.length, 3);
    const first = entry.attachments![0]!;
    const second = entry.attachments![1]!;
    assert.notEqual(first.ref, second.ref);
    assert.equal(first.bytes, image.length);
    const json = await readFile(join(directory, session.id + ".json"), "utf8");
    assert.doesNotMatch(json, /sent-image|dataBase64|source\.png/);
    await rm(source);
    service.disposeAll();
    service = createAcpService({ directory, connect });
    const after = (await service.read({ ...workspace, id: session.id })).entries[0];
    assert.deepEqual(after, entry);
    const chunks: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const chunk = await service.readAttachment({
        ...workspace,
        id: session.id,
        ref: first.ref,
        offset,
      });
      chunks.push(Buffer.from(chunk.dataBase64, "base64"));
      assert.equal(chunk.mediaType, "image/png");
      assert.ok(chunks.at(-1)!.length <= 128 * 1024);
      if (chunk.nextOffset === null) break;
      offset = chunk.nextOffset;
    }
    assert.deepEqual(Buffer.concat(chunks), image);
    assert.equal(connects, 1, "history and attachments never connect/authenticate an Agent");
    assert.equal(
      Buffer.from(
        (await service.readAttachment({ ...workspace, id: session.id, ref: second.ref }))
          .dataBase64,
        "base64",
      ).toString(),
      "second",
    );
    for (const patch of [
      { workspaceIdentity: "remote:other" },
      { workspacePath: "/fixture/other" },
      { ref: source },
      { offset: -1 },
      { offset: image.length + 1 },
      { limit: 128 * 1024 + 1 },
    ])
      await assert.rejects(
        service.readAttachment({ ...workspace, id: session.id, ref: first.ref, ...patch }),
      );
    const other = await service.create({ ...workspace, agent: "claude" });
    await assert.rejects(
      service.readAttachment({ ...workspace, id: other.id, ref: first.ref }),
      /attachment/,
    );
    // 同名文件替换为 symlink 也不能读取任意 Host 文件。
    const path = join(
      directory,
      "attachments",
      session.id,
      first.ref.slice("acp-attachment:".length),
    );
    await rm(path);
    await writeFile(source, "outside");
    await symlink(source, path);
    await assert.rejects(
      service.readAttachment({ ...workspace, id: session.id, ref: first.ref }),
      /attachment/,
    );
    await service.remove({ ...workspace, id: session.id });
    await assert.rejects(readdir(join(directory, "attachments", session.id)), { code: "ENOENT" });
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP validation/storage failure never admits input or calls the Agent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-attachment-failure-"));
  let prompts = 0;
  let service = createAcpService({ directory, connect: connection(() => prompts++, false) });
  try {
    let session = await service.create({ ...workspace, agent: "codex", deferPersistence: true });
    const prompt = {
      ...workspace,
      id: session.id,
      commandId: "bad",
      text: "image",
      attachments: [{ fileName: "x.png", mimeType: "image/png", dataBase64: "cG5n" }],
    };
    await assert.rejects(service.prompt(prompt), /does not accept images/);
    assert.deepEqual((await service.read({ ...workspace, id: session.id })).entries, []);
    service.disposeAll();
    service = createAcpService({ directory, connect: connection(() => prompts++) });
    session = await service.create({ ...workspace, agent: "codex", deferPersistence: true });
    await writeFile(join(directory, "attachments"), "cannot create directory");
    await assert.rejects(service.prompt({ ...prompt, id: session.id }));
    const failed = await service.read({ ...workspace, id: session.id });
    assert.deepEqual(failed.entries, []);
    assert.equal(failed.provisional, true);
    assert.equal(prompts, 0);
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP stop/remove/dispose wait for unaccepted attachment cleanup without publishing a late row", async () => {
  const original = AcpAttachmentStore.prototype.save;
  for (const action of ["stop", "remove", "dispose"] as const) {
    const directory = await mkdtemp(join(tmpdir(), "acp-attachment-lifecycle-"));
    const started = gate(),
      release = gate(),
      closed = gate();
    let prompts = 0;
    const factory = connection(() => prompts++);
    const connect: AcpConnectionFactory = async (input) => ({
      ...(await factory(input)),
      close: closed.resolve,
    });
    const service = createAcpService({ directory, connect });
    AcpAttachmentStore.prototype.save = async function (...args) {
      const saved = await original.apply(this, args);
      started.resolve();
      await release.promise;
      return saved;
    };
    try {
      const session = await service.create({
        ...workspace,
        agent: "codex",
        deferPersistence: true,
      });
      const published: unknown[] = [];
      service.onDynamicSessionChanged(workspace)((event) => {
        if (event.kind === "updated" && event.session.entries.length) published.push(event);
      });
      const sending = service.prompt({
        ...workspace,
        id: session.id,
        commandId: action,
        text: "image",
        attachments: inline,
      });
      await started.promise;
      let settled = false;
      const operation = (
        action === "dispose"
          ? service.disposeAllAndWait()
          : service[action]({ ...workspace, id: session.id })
      ).then(() => {
        settled = true;
      });
      await closed.promise;
      if (action !== "stop") assert.equal(settled, false, "remove/close must wait for cleanup");
      release.resolve();
      await Promise.all([sending, operation]);
      assert.equal(prompts, 0);
      assert.deepEqual(published, []);
      const folder = join(directory, "attachments", session.id);
      if (action === "remove") await assert.rejects(readdir(folder), { code: "ENOENT" });
      else assert.deepEqual(await readdir(folder), []);
      if (action === "stop")
        assert.deepEqual((await service.read({ ...workspace, id: session.id })).entries, []);
    } finally {
      release.resolve();
      AcpAttachmentStore.prototype.save = original;
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("ACP deletion waits for a stopped attachment write even after a new turn finishes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-attachment-overlap-"));
  const started = gate(),
    release = gate(),
    removedConnection = gate();
  let saves = 0,
    closes = 0;
  const original = AcpAttachmentStore.prototype.save;
  AcpAttachmentStore.prototype.save = async function (...args) {
    const saved = await original.apply(this, args);
    if (++saves === 1) {
      started.resolve();
      await release.promise;
    }
    return saved;
  };
  const factory = connection();
  const service = createAcpService({
    directory,
    connect: async (input) => ({
      ...(await factory(input)),
      close() {
        if (++closes === 2) removedConnection.resolve();
      },
    }),
  });
  try {
    const session = await service.create({ ...workspace, agent: "codex", deferPersistence: true });
    const target = { ...workspace, id: session.id };
    const first = service.prompt({
      ...target,
      commandId: "first",
      text: "first",
      attachments: inline,
    });
    await started.promise;
    await service.stop(target);
    await service.prompt({ ...target, commandId: "second", text: "second", attachments: inline });
    let settled = false;
    const removing = service.remove(target).then(() => {
      settled = true;
    });
    await removedConnection.promise;
    assert.equal(settled, false);
    release.resolve();
    await Promise.all([first, removing]);
    await assert.rejects(readdir(join(directory, "attachments", session.id)), { code: "ENOENT" });
    assert.deepEqual(await service.list(workspace), []);
  } finally {
    release.resolve();
    AcpAttachmentStore.prototype.save = original;
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP admission persistence failure restores the draft and cleans the new attachment group", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-attachment-admission-"));
  let prompts = 0;
  const service = createAcpService({ directory, connect: connection(() => prompts++) });
  try {
    const draft = await service.create({ ...workspace, agent: "codex", deferPersistence: true });
    const target = { ...workspace, id: draft.id };
    await service.refresh(target);
    const before = await service.read(target);
    const path = join(directory, draft.id + ".json");
    await mkdir(path);
    const input = { ...target, commandId: "retry", text: "image", attachments: inline };
    await assert.rejects(service.prompt(input));
    assert.deepEqual(await service.read(target), before);
    assert.equal(prompts, 0);
    assert.deepEqual(await readdir(join(directory, "attachments", draft.id)), []);
    await rm(path, { recursive: true });
    const accepted = await service.prompt(input);
    assert.equal(accepted.entries[0]?.kind, "user");
    assert.equal(prompts, 1);
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
