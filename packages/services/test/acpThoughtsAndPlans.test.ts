import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acpSessionSchema, type AcpSession, type AcpStopReason } from "@zcode/shared";
import {
  createAcpService,
  type AcpConnectionFactory,
  type AcpUpdate,
} from "../src/acp/acpServiceImpl.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "acp-thought-plan-"));
  const workspace = { workspacePath: directory, workspaceIdentity: "remote:thought-fixture" };
  let emit!: (update: AcpUpdate) => Promise<void>;
  let exit!: (reason: string) => void;
  let finish!: () => void;
  let fail!: (error: Error) => void;
  let stopReason: AcpStopReason = "end_turn";
  const notifications: AcpSession[] = [];
  const connect: AcpConnectionFactory = async (input) => {
    emit = input.onUpdate;
    exit = input.onExit;
    return {
      sessionId: input.sessionId ?? "thought-native",
      configOptions: [],
      modeState: null,
      get lastStopReason() {
        return stopReason;
      },
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt() {
        await new Promise<void>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        });
      },
      async cancel() {
        finish();
      },
      close() {},
    };
  };
  let service = createAcpService({ directory, connect });
  const session = await service.create({ ...workspace, agent: "codex" });
  const target = { ...workspace, id: session.id };
  service.onDynamicSessionChanged(workspace)((event) => {
    if (event.kind === "updated") notifications.push(event.session);
  });
  async function start(commandId = "first") {
    finish = undefined as never;
    const result = service.prompt({ ...target, commandId, text: "hello" });
    for (let n = 0; n < 200 && !finish; n++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(finish, "prompt admitted");
    return { result };
  }
  return {
    start,
    target,
    notifications,
    emit: (update: AcpUpdate) => emit(update),
    finish: () => finish(),
    fail: () => fail(new Error("fixture failure")),
    exit: () => exit("fixture exit"),
    stale: () => emit,
    setStopReason: (value: AcpStopReason) => {
      stopReason = value;
    },
    read: () => service.read(target),
    stop: () => service.stop(target),
    disk: async () =>
      acpSessionSchema.parse(
        JSON.parse(await readFile(join(directory, `${session.id}.json`), "utf8")),
      ),
    async restart() {
      await service.disposeAllAndWait();
      service = createAcpService({ directory, connect });
    },
    async dispose() {
      finish?.();
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("Host stores ordered thought segments and full plan replacement, then replays the same entries", async () => {
  const f = await fixture();
  try {
    const turn = await f.start();
    await f.emit({ kind: "thought", text: "inspect " });
    await f.emit({ kind: "thought", text: "source" });
    await f.emit({ kind: "tool", id: "read", title: "Read", status: "in_progress" });
    await f.emit({ kind: "thought", text: "compare " });
    await f.emit({ kind: "tool", id: "read", status: "completed" });
    await f.emit({ kind: "thought", text: "results" });
    const steps = [
      { content: "verify", priority: "high" as const, status: "in_progress" as const },
    ];
    await f.emit({ kind: "plan", entries: steps });
    await f.emit({ kind: "text", text: "answer" });
    await f.emit({ kind: "plan", entries: [{ ...steps[0]!, status: "pending" }] });
    await f.emit({ kind: "thought", text: "final check", messageId: "final" });
    f.finish();
    await turn.result;
    const snapshot = await f.read();
    assert.deepEqual(
      snapshot.entries.map((e) => e.kind),
      ["user", "thought", "tool", "thought", "plan", "assistant", "thought"],
    );
    const thoughts = snapshot.entries.filter((e) => e.kind === "thought");
    assert.deepEqual(
      thoughts.map((e) => [e.text, e.state]),
      [
        ["inspect source", "complete"],
        ["compare results", "complete"],
        ["final check", "complete"],
      ],
    );
    assert.ok(thoughts.every((e) => typeof e.durationMs === "number" && e.durationMs >= 0));
    const plan = snapshot.entries.find((e) => e.kind === "plan");
    assert.deepEqual(
      plan?.entries,
      [{ ...steps[0]!, status: "pending" }],
      "completion must not invent completed steps",
    );
    assert.deepEqual((await f.disk()).entries, snapshot.entries);
    assert.deepEqual(f.notifications.at(-1)?.entries, snapshot.entries);
    await f.restart();
    assert.deepEqual((await f.read()).entries, snapshot.entries);
    const next = await f.start("second");
    await f.emit({ kind: "plan", entries: [] });
    f.finish();
    await next.result;
    assert.equal((await f.read()).entries.filter((e) => e.kind === "plan").length, 2);
  } finally {
    await f.dispose();
  }
});

test("changing thought message ids splits segments; empty plan updates clear the saved list", async () => {
  const f = await fixture();
  try {
    const turn = await f.start();
    await f.emit({ kind: "thought", text: "one", messageId: "one" });
    await f.emit({ kind: "thought", text: "two", messageId: "two" });
    await f.emit({
      kind: "plan",
      entries: [{ content: "step", priority: "low", status: "completed" }],
    });
    const before = (await f.read()).entries.find((e) => e.kind === "plan");
    await f.emit({ kind: "plan", entries: [] });
    f.finish();
    await turn.result;
    const entries = (await f.read()).entries;
    assert.deepEqual(
      entries.filter((e) => e.kind === "thought").map((e) => e.text),
      ["one", "two"],
    );
    const plan = entries.find((e) => e.kind === "plan");
    assert.equal(plan?.id, before?.id);
    assert.deepEqual(plan?.entries, []);
    assert.equal((await f.read()).revision, f.notifications.at(-1)?.revision);
  } finally {
    await f.dispose();
  }
});

for (const ending of ["stop", "failure", "exit", "restart", "max_tokens", "cancelled"] as const) {
  test(`unfinished thoughts are interrupted on ${ending} and stale notifications are rejected`, async () => {
    const f = await fixture();
    try {
      const turn = await f.start();
      // Attach rejection handling before causing a failed prompt.
      const settled = turn.result.catch(() => undefined);
      await f.emit({ kind: "thought", text: "partial" });
      const stale = f.stale();
      if (ending === "stop") await f.stop();
      else if (ending === "failure") f.fail();
      else if (ending === "exit") {
        f.exit();
        f.finish();
      } else if (ending === "restart") {
        await f.restart();
        f.finish();
      } else {
        f.setStopReason(ending);
        f.finish();
      }
      await settled;
      const snapshot = await f.read();
      const thought = snapshot.entries.find((e) => e.kind === "thought");
      assert.equal(thought?.state, "interrupted");
      assert.equal(thought?.text, "partial");
      await stale({ kind: "thought", text: "late" });
      await stale({ kind: "plan", entries: [] });
      assert.deepEqual((await f.read()).entries, snapshot.entries);
      const next = await f.start("next");
      if (ending === "stop" || ending === "exit" || ending === "restart") {
        await stale({ kind: "thought", text: "old-generation" });
        assert.equal((await f.read()).entries.filter((e) => e.kind === "thought").length, 1);
      }
      f.finish();
      await next.result;
    } finally {
      await f.dispose();
    }
  });
}
