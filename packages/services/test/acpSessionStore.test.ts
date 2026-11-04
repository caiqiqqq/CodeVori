import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acpSessionSchema } from "@zcode/shared";
import { AcpSessionStore } from "../src/acp/acpSessionStore.js";

test("legacy snapshots migrate lazily; commits append changed entries and recover after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-store-"));
  const path = join(directory, "session.json");
  try {
    const legacy = acpSessionSchema.parse({
      id: "session",
      workspacePath: "/tmp/project",
      agent: "codex",
      acpSessionId: "native",
      title: "history",
      status: "idle",
      revision: 1,
      pendingPermission: null,
      error: null,
      entries: Array.from({ length: 1000 }, (_, i) => ({
        id: `old:${i}`,
        kind: "assistant",
        text: "x".repeat(1000),
      })),
    });
    await writeFile(path, JSON.stringify(legacy));
    const store = new AcpSessionStore(() => path);
    const session = await store.read("session");
    session.revision++;
    session.entries.push({ id: "user:one", kind: "user", text: "new input" });
    const captured = store.capture(session);
    await store.commit(captured);
    session.entries.at(-1)!.text = "mutated owner";
    assert.equal(
      captured.entries.at(-1)!.text,
      "new input",
      "owner mutations cannot change durable projection",
    );
    const journal = await readFile(`${path}.journal`, "utf8");
    assert.ok(journal.length < 2000, `incremental write was ${journal.length} bytes`);
    assert.equal(await readFile(path, "utf8"), JSON.stringify(legacy));
    const restored = await new AcpSessionStore(() => path).read("session");
    assert.deepEqual(restored, captured);
    // 崩溃可留下半条写入；只丢弃未提交尾巴，不能吞掉完整的坏记录。
    await appendFile(`${path}.journal`, '{"partial":');
    const restarted = new AcpSessionStore(() => path);
    assert.deepEqual(await restarted.read("session"), captured);
    restored.revision++;
    restored.entries[0]!.text = "corrected old entry";
    await restarted.commit(restarted.capture(restored));
    assert.deepEqual(await new AcpSessionStore(() => path).read("session"), restored);
    await store.remove("session");
    await assert.rejects(readFile(path));
    await assert.rejects(readFile(`${path}.journal`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("complete corrupt records fail closed; checkpoint and repeated revisions replay safely", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-store-"));
  const path = join(directory, "session.json");
  try {
    const store = new AcpSessionStore(() => path);
    const session = acpSessionSchema.parse({
      id: "session",
      workspacePath: "/tmp/p",
      agent: "codex",
      acpSessionId: "native",
      title: "test",
      status: "idle",
      revision: 0,
      entries: [],
      pendingPermission: null,
      error: null,
    });
    await store.commit(store.capture(session));
    session.revision++;
    session.entries.push({ id: "user:first", kind: "user", text: "first" });
    await store.commit(store.capture(session));
    const oldJournal = await readFile(`${path}.journal`, "utf8");
    await store.checkpoint("session");
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), session);
    assert.deepEqual(await new AcpSessionStore(() => path).read("session"), session);
    await appendFile(`${path}.journal`, oldJournal);
    assert.deepEqual(await new AcpSessionStore(() => path).read("session"), session);
    await appendFile(`${path}.journal`, "broken\n");
    await assert.rejects(new AcpSessionStore(() => path).read("session"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cold ACP summaries are rebuildable and do not retain full session snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-summary-store-"));
  const path = join(directory, "session.json");
  try {
    const legacy = acpSessionSchema.parse({
      id: "session",
      workspacePath: "/tmp/project",
      agent: "codex",
      acpSessionId: "native",
      title: "history",
      status: "idle",
      revision: 1,
      entries: [
        { id: "user:old", kind: "user", text: "old input", createdAt: 100 },
        ...Array.from({ length: 1000 }, (_, index) => ({
          id: `assistant:${index}`,
          kind: "assistant" as const,
          text: "x".repeat(1000),
        })),
      ],
      pendingPermission: null,
      error: null,
    });
    await writeFile(path, JSON.stringify(legacy));
    const store = new AcpSessionStore(() => path);
    const initial = await store.readSummary("session");
    assert.equal(initial.history.entryCount, 1001);
    assert.deepEqual(
      initial.entries.map((entry) => entry.id),
      ["user:old"],
    );
    assert.equal(store.current("session"), undefined);
    assert.ok((await readFile(`${path}.summary`, "utf8")).length < 5000);

    await writeFile(`${path}.summary`, "broken");
    assert.deepEqual(await store.readSummary("session"), initial);
    assert.equal(store.current("session"), undefined);
    const oldSidecar = await readFile(`${path}.summary`, "utf8");

    const writer = new AcpSessionStore(() => path);
    const updated = await writer.read("session");
    updated.revision++;
    updated.entries.push({ id: "user:new", kind: "user", text: "new input", createdAt: 200 });
    await writer.commit(writer.capture(updated));
    // 模拟 data 已提交、sidecar 尚未来得及刷新的崩溃窗口。
    await writeFile(`${path}.summary`, oldSidecar);
    const afterJournal = await store.readSummary("session");
    assert.equal(afterJournal.revision, updated.revision);
    assert.equal(afterJournal.history.entryCount, 1002);
    assert.deepEqual(
      afterJournal.entries.map((entry) => entry.id),
      ["user:new"],
    );
    assert.equal(store.current("session"), undefined);

    await writer.checkpoint("session");
    assert.deepEqual(await store.readSummary("session"), afterJournal);
    await writer.remove("session");
    await assert.rejects(readFile(`${path}.summary`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("summary maintenance failure cannot reject accepted facts or hide journal corruption", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-summary-failure-"));
  const path = join(directory, "session.json");
  const errors: unknown[] = [];
  try {
    const store = new AcpSessionStore(
      () => path,
      (error) => errors.push(error),
    );
    const session = acpSessionSchema.parse({
      id: "session",
      workspacePath: "/tmp/project",
      agent: "codex",
      acpSessionId: "native",
      title: "history",
      status: "idle",
      revision: 1,
      entries: [{ id: "user:one", kind: "user", text: "accepted", createdAt: 100 }],
      pendingPermission: null,
      error: null,
    });
    await mkdir(`${path}.summary`);
    await store.commit(store.capture(session));
    assert.equal(errors.length, 1);
    const cold = new AcpSessionStore(
      () => path,
      (error) => errors.push(error),
    );
    assert.equal((await cold.readSummary("session")).revision, 1);
    assert.equal(cold.current("session"), undefined);
    assert.deepEqual(await cold.readTransient("session"), session);
    assert.equal(cold.current("session"), undefined);
    await rm(`${path}.summary`, { recursive: true });
    await cold.readSummary("session");
    await appendFile(`${path}.journal`, '{"partial":');
    assert.equal((await cold.readSummary("session")).revision, 1);
    assert.equal(await readFile(`${path}.journal`, "utf8"), '{"partial":');
    await appendFile(`${path}.journal`, "}\n");
    await assert.rejects(cold.readSummary("session"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
