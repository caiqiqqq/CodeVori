import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AcpSession } from "@zcode/shared";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import { connectAcpAgent } from "../src/acp/acpStdioConnection.js";

const workspace = { workspacePath: "/synthetic/stream", workspaceIdentity: "stream:a" };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const textOf = (session: AcpSession) =>
  session.entries
    .filter((entry) => entry.kind === "assistant")
    .map((entry) => entry.text)
    .join("");

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "acp-streaming-snapshots-"));
  const started = deferred();
  const finish = deferred();
  let update!: Parameters<AcpConnectionFactory>[0]["onUpdate"];
  const updates: Array<typeof update> = [];
  const service = createAcpService({
    directory,
    connect: async (input) => {
      update = input.onUpdate;
      updates.push(update);
      return {
        sessionId: "synthetic-native",
        configOptions: [],
        modeState: null,
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async prompt() {
          started.resolve();
          await finish.promise;
        },
        async cancel() {
          finish.resolve();
        },
        close() {
          finish.resolve();
        },
      };
    },
  });
  const session = await service.create({ ...workspace, agent: "codex" });
  const target = { ...workspace, id: session.id };
  const turn = service.prompt({ ...target, commandId: "stream-turn", text: "synthetic request" });
  await started.promise;
  const changes: AcpSession[] = [];
  const subscription = service.onDynamicSessionChanged(workspace)((change) => {
    if (change.kind === "updated") changes.push(change.session);
  });
  const disk = async () =>
    JSON.parse(await readFile(join(directory, `${session.id}.json`), "utf8")) as AcpSession;
  return {
    directory,
    service,
    target,
    update,
    updates,
    turn,
    finish,
    changes,
    disk,
    async cleanup() {
      subscription.dispose();
      await service.disposeAllAndWait();
      finish.resolve();
      await turn;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("a long ACP transcript coalesces a burst without losing characters or durable update acknowledgements", async (t) => {
  const f = await fixture();
  try {
    const history = "合成历史。".repeat(20_000);
    await f.update({ kind: "text", text: history });
    f.changes.length = 0;
    const chunks = Array.from({ length: 512 }, (_, index) => String.fromCharCode(0x4e00 + index));
    await Promise.all(chunks.map((text) => f.update({ kind: "text", text })));
    assert.ok(
      f.changes.length > 0 && f.changes.length <= 2,
      `burst broadcast ${f.changes.length} full snapshots`,
    );
    t.diagnostic(
      `${chunks.length} text chunks persisted with ${f.changes.length} full snapshot broadcasts`,
    );
    const disk = await f.disk();
    assert.equal(textOf(disk), history + chunks.join(""));
    assert.equal(disk.revision, f.changes.at(-1)?.revision);
    assert.equal(disk.status, "running", "live text is persisted before the turn ends");
    f.finish.resolve();
    const completed = await f.turn;
    assert.equal(completed.status, "idle");
    assert.deepEqual((await f.disk()).entries, completed.entries);
  } finally {
    await f.cleanup();
  }
});

test("chunks arriving while the first snapshot is still writing get a following durable snapshot", async () => {
  const f = await fixture();
  let following: Promise<void>[] = [];
  let sent = false;
  const subscription = f.service.onDynamicSessionChanged(workspace)((change) => {
    if (change.kind !== "updated" || sent || textOf(change.session) !== "首") return;
    // 原子替换已完成，但当前 save 的清理 Promise 尚未结束；制造真实在途写入。
    sent = true;
    following = Array.from({ length: 128 }, () => f.update({ kind: "text", text: "续" }));
  });
  try {
    await f.update({ kind: "text", text: "首" });
    assert.equal(sent, true);
    await Promise.all(following);
    assert.equal(textOf(await f.disk()), "首" + "续".repeat(128));
    assert.equal(f.changes.length, 2);
    assert.ok(f.changes[1]!.revision > f.changes[0]!.revision);
  } finally {
    subscription.dispose();
    await f.cleanup();
  }
});

test("tool and completion barriers include pending stream chunks and never publish a stale running snapshot", async () => {
  const f = await fixture();
  try {
    const before = Array.from({ length: 128 }, () =>
      f.update({ kind: "text", text: "前", messageId: "first" }),
    );
    await f.update({ kind: "tool", id: "inspect", title: "Inspect", status: "completed" });
    assert.equal(textOf(await f.disk()), "前".repeat(128));
    await Promise.all(before);
    const after = Array.from({ length: 128 }, () =>
      f.update({ kind: "text", text: "后", messageId: "second" }),
    );
    f.finish.resolve();
    const completed = await f.turn;
    await Promise.all(after);
    const disk = await f.disk();
    assert.equal(textOf(disk), "前".repeat(128) + "后".repeat(128));
    assert.deepEqual(
      disk.entries.map((entry) => entry.kind),
      ["user", "assistant", "tool", "assistant"],
    );
    assert.equal(disk.status, "idle");
    assert.equal(disk.revision, completed.revision);
    const terminalIndex = f.changes.findIndex((snapshot) => snapshot.status === "idle");
    assert.ok(terminalIndex >= 0);
    assert.ok(f.changes.slice(terminalIndex).every((snapshot) => snapshot.status === "idle"));
    assert.ok(
      f.changes.every(
        (snapshot, index) => index === 0 || snapshot.revision > f.changes[index - 1]!.revision,
      ),
    );
  } finally {
    await f.cleanup();
  }
});

test("stop saves pending chunks and rejects late text from the stopped generation", async () => {
  const f = await fixture();
  try {
    const updates = Array.from({ length: 128 }, () => f.update({ kind: "text", text: "停" }));
    await f.service.stop(f.target);
    const stopped = await f.disk();
    const user = stopped.entries[0]!;
    assert.ok(user.kind === "user" && user.endedAt !== undefined);
    await Promise.all(updates);
    await f.turn;
    await f.update({ kind: "text", text: "迟到" });
    assert.equal(textOf(await f.disk()), "停".repeat(128));
    assert.deepEqual(
      (await f.disk()).entries[0],
      user,
      "Late prompt completion must not rewrite stopped time",
    );
    assert.equal((await f.disk()).status, "idle");
    assert.equal(f.changes.at(-1)?.status, "idle");
  } finally {
    await f.cleanup();
  }
});

test("Host shutdown waits for pending stream persistence and suppresses late broadcasts", async () => {
  const f = await fixture();
  try {
    const updates = Array.from({ length: 128 }, () => f.update({ kind: "text", text: "关" }));
    await f.service.disposeAllAndWait();
    assert.equal(textOf(await f.disk()), "关".repeat(128));
    assert.equal(f.changes.length, 0);
    await Promise.all(updates);
    const restarted = createAcpService({ directory: f.directory });
    try {
      const restored = await restarted.read(f.target);
      assert.equal(restored.status, "interrupted");
      const user = restored.entries[0]!;
      assert.ok(user.kind === "user");
      assert.equal(user.endedAt, undefined, "Host recovery cannot invent the old turn's end time");
    } finally {
      await restarted.disposeAllAndWait();
    }
  } finally {
    await f.cleanup();
  }
});

test("removing a session with a queued stream write cannot recreate its history", async () => {
  const f = await fixture();
  try {
    const updates = Array.from({ length: 128 }, () => f.update({ kind: "text", text: "删" }));
    await f.service.remove(f.target);
    await Promise.all(updates);
    await f.update({ kind: "text", text: "迟到" });
    assert.equal(
      (await readdir(f.directory)).some((name) => name.startsWith(f.target.id)),
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test("a coalesced write failure rejects every affected update and does not publish success", async () => {
  const f = await fixture();
  try {
    await rm(f.directory, { recursive: true, force: true });
    await writeFile(f.directory, "block snapshot directory");
    const results = await Promise.allSettled(
      Array.from({ length: 32 }, () => f.update({ kind: "text", text: "错" })),
    );
    assert.ok(results.every((result) => result.status === "rejected"));
    assert.equal(f.changes.length, 0);
    await rm(f.directory);
    await mkdir(f.directory);
    // 重试仍由同一保存路径恢复，失败分片不能被静默丢弃。
    await f.update({ kind: "text", text: "恢复" });
    assert.equal(textOf(await f.disk()), "错".repeat(32) + "恢复");
  } finally {
    await f.cleanup();
  }
});

test("simultaneous streams sharing a Host remain isolated by workspace identity and session", async () => {
  const f = await fixture();
  const otherWorkspace = { ...workspace, workspaceIdentity: "stream:b" };
  const otherChanges: AcpSession[] = [];
  const subscription = f.service.onDynamicSessionChanged(otherWorkspace)((change) => {
    if (change.kind === "updated") otherChanges.push(change.session);
  });
  try {
    const other = await f.service.create({ ...otherWorkspace, agent: "codex" });
    const target = { ...otherWorkspace, id: other.id };
    await f.service.submitPrompt({ ...target, commandId: "other-turn", text: "other request" });
    otherChanges.length = 0;
    await Promise.all(
      Array.from({ length: 128 }, () => [
        f.update({ kind: "text", text: "甲" }),
        f.updates.at(-1)!({ kind: "text", text: "乙" }),
      ]).flat(),
    );
    assert.equal(textOf(await f.disk()), "甲".repeat(128));
    const disk = JSON.parse(
      await readFile(join(f.directory, `${other.id}.json`), "utf8"),
    ) as AcpSession;
    assert.equal(textOf(disk), "乙".repeat(128));
    assert.ok(otherChanges.length > 0 && otherChanges.length <= 2);
    assert.ok(f.changes.every((snapshot) => snapshot.id === f.target.id));
    assert.ok(otherChanges.every((snapshot) => snapshot.id === other.id));
    const restarted = createAcpService({ directory: f.directory });
    try {
      assert.deepEqual((await restarted.read(target)).entries, disk.entries);
    } finally {
      await restarted.disposeAllAndWait();
    }
  } finally {
    subscription.dispose();
    await f.cleanup();
  }
});

test("thought and compaction summary bursts preserve order through their completion barriers", async () => {
  const f = await fixture();
  try {
    await Promise.all(
      Array.from({ length: 64 }, () =>
        f.update({ kind: "thought", text: "思", messageId: "thought" }),
      ),
    );
    assert.equal(f.changes.length, 1);
    await f.update({ kind: "compaction", id: "compact", status: "running" });
    f.changes.length = 0;
    await Promise.all(
      Array.from({ length: 64 }, () =>
        f.update({ kind: "compaction_summary", id: "compact", text: "摘" }),
      ),
    );
    assert.equal(f.changes.length, 1);
    await f.update({ kind: "compaction", id: "compact", status: "success" });
    await f.update({ kind: "text", text: "正文" });
    const disk = await f.disk();
    assert.deepEqual(
      disk.entries.map((entry) => entry.kind),
      ["user", "thought", "compaction", "assistant"],
    );
    const thought = disk.entries[1];
    assert.ok(thought?.kind === "thought");
    assert.equal(thought.text, "思".repeat(64));
    assert.equal(thought.state, "complete");
    const compact = disk.entries[2];
    assert.ok(compact?.kind === "compaction");
    assert.equal(compact.summary, "摘".repeat(64));
    assert.equal(compact.status, "success");
  } finally {
    await f.cleanup();
  }
});

test("a real stdio transport preserves a burst before the immediate prompt response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-streaming-wire-"));
  const script = join(directory, "agent.cjs");
  await writeFile(
    script,
    `
    const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\\n');
    require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
      const message=JSON.parse(line);
      if(message.method==='initialize') send({id:message.id,result:{protocolVersion:1,agentCapabilities:{}}});
      else if(message.method==='session/new') send({id:message.id,result:{sessionId:'wire-stream'}});
      else if(message.method==='session/prompt') {
        for(let index=0;index<256;index++) send({method:'session/update',params:{sessionId:'wire-stream',update:{
          sessionUpdate:'agent_message_chunk',messageId:'answer',content:{type:'text',text:String.fromCharCode(0x4e00+index)}
        }}});
        send({id:message.id,result:{stopReason:'end_turn'}});
      }
    });
  `,
  );
  const service = createAcpService({
    directory,
    connect: (input) =>
      connectAcpAgent({
        ...input,
        launch: { command: process.execPath, args: [script], env: process.env },
      }),
  });
  try {
    const wireWorkspace = { ...workspace, workspacePath: directory };
    const session = await service.create({ ...wireWorkspace, agent: "codex" });
    const changes: AcpSession[] = [];
    const subscription = service.onDynamicSessionChanged(wireWorkspace)((change) => {
      if (change.kind === "updated") changes.push(change.session);
    });
    const result = await service.prompt({
      ...wireWorkspace,
      id: session.id,
      commandId: "wire-turn",
      text: "wire request",
    });
    await service.disposeAllAndWait();
    subscription.dispose();
    const expected = Array.from({ length: 256 }, (_, index) =>
      String.fromCharCode(0x4e00 + index),
    ).join("");
    assert.equal(textOf(result), expected);
    const disk = JSON.parse(
      await readFile(join(directory, `${session.id}.json`), "utf8"),
    ) as AcpSession;
    assert.equal(textOf(disk), expected);
    assert.equal(disk.status, "idle");
    assert.ok(changes.length < 20, `wire burst broadcast ${changes.length} snapshots`);
    assert.ok(
      changes.every(
        (snapshot, index) => index === 0 || snapshot.revision > changes[index - 1]!.revision,
      ),
    );
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
