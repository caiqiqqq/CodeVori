import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
