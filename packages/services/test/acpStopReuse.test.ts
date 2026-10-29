import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";

const workspace = { workspacePath: "/synthetic/stop", workspaceIdentity: "remote:stop" };
async function waitFor(check: () => unknown | Promise<unknown>) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("stop fixture did not settle");
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "acp-stop-reuse-"));
  const connections: Array<{
    input: Parameters<AcpConnectionFactory>[0];
    turns: Array<ReturnType<typeof Promise.withResolvers<void>>>;
    closed: boolean;
    cancelled: boolean;
    failCancel: boolean;
  }> = [];
  const service = createAcpService({
    directory,
    connect: async (input) => {
      const state = {
        input,
        turns: [],
        closed: false,
        cancelled: false,
        failCancel: false,
      } as (typeof connections)[number];
      connections.push(state);
      return {
        sessionId: input.sessionId ?? "native-stop",
        configOptions: [],
        modeState: null,
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async prompt() {
          const turn = Promise.withResolvers<void>();
          state.turns.push(turn);
          await turn.promise;
        },
        async cancel() {
          state.cancelled = true;
          if (state.failCancel) throw new Error("fixture cancel failed");
        },
        close() {
          state.closed = true;
          state.turns.at(-1)?.resolve();
        },
      };
    },
  });
  const session = await service.create({ ...workspace, agent: "codex" });
  const target = { ...workspace, id: session.id };
  return {
    service,
    connections,
    target,
    async dispose() {
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test(
  "stop waits for the actual prompt terminal and reuses the same native connection",
  { timeout: 5000 },
  async () => {
    const f = await fixture();
    try {
      const first = f.service.prompt({ ...f.target, commandId: "first", text: "first" });
      await waitFor(() => f.connections[0]!.turns.length === 1);
      const old = f.connections[0]!;
      let stopped = false;
      const stopping = f.service.stop(f.target).then(() => {
        stopped = true;
      });
      await waitFor(() => old.cancelled);
      assert.equal(stopped, false, "cancel notification alone is not a terminal");
      assert.equal(old.closed, false);
      await assert.rejects(
        f.service.prompt({ ...f.target, commandId: "early", text: "early" }),
        /running/,
      );
      await old.input.onUpdate({ kind: "text", text: "stale while cancelling" });
      assert.equal(
        await old.input.onPermission({ requestId: "late", title: "late", options: [] }),
        null,
      );
      old.turns[0]!.resolve();
      await stopping;
      const cancelled = await first;
      assert.equal(
        cancelled.entries[0]?.kind === "user" && cancelled.entries[0].stopReason,
        "cancelled",
      );
      assert.equal(cancelled.unreadAt, null);
      assert.equal(cancelled.entries.length, 1);
      assert.equal(old.closed, false);
      const second = f.service.prompt({ ...f.target, commandId: "second", text: "second" });
      await waitFor(() => old.turns.length === 2 || f.connections.length === 2);
      assert.equal(f.connections.length, 1, "normal stop must not launch/load an Agent again");
      await old.input.onUpdate({ kind: "text", text: "fresh answer" });
      // A delayed command-scoped stop must not cancel the new foreground execution.
      await f.service.stop({ ...f.target, expectedCommandId: "first" });
      assert.equal((await f.service.read(f.target)).status, "running");
      old.turns[1]!.resolve();
      const complete = await second;
      assert.equal(complete.status, "idle");
      assert.equal(complete.acpSessionId, "native-stop");
      assert.ok(
        complete.entries.some(
          (entry) => entry.kind === "assistant" && entry.text === "fresh answer",
        ),
      );
    } finally {
      await f.dispose();
    }
  },
);

for (const fault of ["cancel", "prompt", "exit", "timeout"] as const) {
  test(
    `stop isolates an unusable connection after ${fault} failure`,
    { timeout: 10000 },
    async () => {
      const f = await fixture();
      try {
        const first = f.service.prompt({ ...f.target, commandId: "first", text: "first" });
        await waitFor(() => f.connections[0]!.turns.length === 1);
        const old = f.connections[0]!;
        old.failCancel = fault === "cancel";
        const stopping = f.service.stop(f.target);
        await waitFor(() => old.cancelled);
        if (fault === "prompt") old.turns[0]!.reject(new Error("fixture transport failed"));
        if (fault === "exit") {
          old.input.onExit("fixture exited");
          old.turns[0]!.reject(new Error("fixture exited"));
        }
        await stopping;
        await first;
        assert.equal(old.closed, true);
        const next = f.service.prompt({ ...f.target, commandId: "next", text: "next" });
        await waitFor(() => f.connections[1]?.turns.length === 1);
        await old.input.onUpdate({ kind: "text", text: "old connection" });
        f.connections[1]!.turns[0]!.resolve();
        const complete = await next;
        assert.ok(
          !complete.entries.some(
            (entry) => entry.kind === "assistant" && entry.text === "old connection",
          ),
        );
      } finally {
        await f.dispose();
      }
    },
  );
}
