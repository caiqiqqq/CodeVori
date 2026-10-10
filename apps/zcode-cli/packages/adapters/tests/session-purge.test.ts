import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { SessionId, ProjectId } from "@zcode/contracts";
import { SqliteSessionStore } from "../src/storage/session-store/sqlite-session-store.js";
import { NodeToolArtifactStore } from "../src/storage/index.js";
import { createRootTraceContext } from "@zcode/contracts";
import { readdir, mkdir, writeFile, readFile } from "node:fs/promises";

test("permanent cleanup deletes owned contents, preserves children and rejects foreign workspace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-session-purge-"));
  const dbPath = join(directory, "sessions.sqlite");
  const store = new SqliteSessionStore({ dbPath });
  const db = new DatabaseSync(dbPath);
  const parent = "session-parent" as SessionId;
  const child = "session-child" as SessionId;
  const input = { sessionID: parent, workspaceID: "remote:fixture", directory: "/fixture/project" };
  try {
    for (const id of [parent, child])
      await store.createSession({
        id,
        projectID: "fixture" as ProjectId,
        workspaceID: input.workspaceID,
        directory: input.directory,
        slug: id,
        title: "private",
        version: "1",
        ...(id === child ? { parentID: parent } : {}),
      });
    db.prepare(
      "INSERT INTO message(id,session_id,time_created,time_updated,data,sequence) VALUES(?,?,1,1,?,0)",
    ).run("message-one", parent, "private");
    db.prepare(
      "INSERT INTO part(id,message_id,session_id,time_created,time_updated,data,sequence) VALUES(?,?,?,1,1,?,0)",
    ).run("part-one", "message-one", parent, "private");
    db.prepare(
      "INSERT INTO input_history(id,project_id,session_id,text,kind,time_created) VALUES('history-one','fixture',?,'private','user',1)",
    ).run(parent);
    db.prepare(
      "INSERT INTO local_setting(scope,scope_id,namespace,key,value,schema_version,time_created,time_updated) VALUES('session',?,'fixture','test','private',1,1,1)",
    ).run(parent);
    await assert.rejects(
      store.purgeSession({ ...input, workspaceID: "remote:other" }),
      /workspace/,
    );
    assert.ok(await store.getSession(parent));
    assert.equal(await store.purgeSession({ ...input, checkOnly: true }), "deleted");
    assert.ok(await store.getSession(parent), "preflight must not delete");
    const sharedUri = `zcode-artifact://${parent}/shared-artifact`;
    db.prepare(
      "INSERT INTO session_entry(id,session_id,type,time_created,time_updated,data) VALUES('child-ref',?,'fixture',1,1,?)",
    ).run(child, JSON.stringify({ ref: sharedUri }));
    assert.deepEqual(await store.retainedSessionArtifactUris(parent), [sharedUri]);
    assert.equal(await store.purgeSession(input), "deleted");
    assert.equal(await store.getSession(parent), null);
    assert.ok(await store.getSession(child));
    for (const table of ["message", "part", "input_history", "local_setting"])
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
    assert.equal(await store.purgeSession(input), "deleted");
  } finally {
    db.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("artifact cleanup removes exclusive files and media while keeping a fork's referenced artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-artifact-purge-"));
  const roots = {
    rootDir: join(directory, "artifacts"),
    imageCacheRootDir: join(directory, "images"),
    pdfCacheRootDir: join(directory, "pdf"),
    videoCacheRootDir: join(directory, "video"),
  };
  const artifacts = new NodeToolArtifactStore(roots);
  const trace = createRootTraceContext();
  try {
    const write = (toolCallId: string) =>
      artifacts.writeToolResultArtifact({
        content: "private bytes",
        contentType: "text/plain",
        retention: "session",
        sessionId: "parent",
        toolCallId,
        toolName: "fixture",
        trace,
      });
    const shared = await write("shared");
    await write("exclusive");
    for (const root of [roots.imageCacheRootDir, roots.pdfCacheRootDir, roots.videoCacheRootDir]) {
      await mkdir(join(root, "parent"), { recursive: true });
      await writeFile(join(root, "parent", "exclusive-media.bin"), "private media");
    }
    await artifacts.purgeSessionArtifacts("parent", [shared.uri]);
    assert.equal((await readdir(join(roots.rootDir, "parent"))).length, 1);
    assert.equal(await readFile(shared.path, "utf8"), "private bytes");
    for (const root of [roots.imageCacheRootDir, roots.pdfCacheRootDir, roots.videoCacheRootDir])
      assert.deepEqual(await readdir(join(root, "parent")), []);
    await assert.rejects(artifacts.purgeSessionArtifacts("..", []), /owner/);
    await artifacts.purgeSessionArtifacts("parent", []);
    await artifacts.purgeSessionArtifacts("parent", []);
    await assert.rejects(readFile(shared.path), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a cold accepted queue prevents cleanup until explicitly settled", async () => {
  const store = new SqliteSessionStore({ dbPath: ":memory:" });
  const sessionID = "session-queue" as SessionId;
  const input = { sessionID, workspaceID: "/fixture/project", directory: "/fixture/project" };
  try {
    await store.createSession({
      id: sessionID,
      projectID: "fixture" as ProjectId,
      directory: input.directory,
      slug: "queue",
      title: "queue",
      version: "1",
    });
    await store.saveSessionInput({
      id: "input-one",
      sessionID,
      kind: "user",
      delivery: "queue",
      payload: { text: "queued" },
    });
    assert.equal(await store.purgeSession(input), "busy");
    assert.ok(await store.getSession(sessionID));
    await store.settleSessionInput({
      id: "input-one",
      sessionID,
      status: "cancelled",
      reason: "user_removed",
    });
    assert.equal(await store.purgeSession(input), "deleted");
  } finally {
    store.close();
  }
});
