import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import type { AcpDiagnosticEvent } from "@zcode/shared";
import { connectAcpAgent } from "../src/acp/acpStdioConnection.js";

const workspace = { workspacePath: "/fixture/trace", workspaceIdentity: "fixture-host" };

async function waitUntil(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, "Expected Host event did not arrive");
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

test("trace correlates repeated tool ids, retains partial details and publishes only persisted metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-trace-"));
  let finish!: () => void;
  let update!: Parameters<AcpConnectionFactory>[0]["onUpdate"];
  const service = createAcpService({
    directory,
    connect: async ({ onUpdate }) => {
      update = onUpdate;
      return {
        sessionId: "fixture-native",
        configOptions: [],
        modeState: null,
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async prompt() {
          await onUpdate({
            kind: "tool",
            id: "same-id",
            status: "in_progress",
            title: "PRIVATE-TITLE",
            input: "PRIVATE-INPUT",
            toolKind: "execute",
          });
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          await onUpdate({
            kind: "tool",
            id: "same-id",
            status: "completed",
            output: "PRIVATE-OUTPUT",
          });
        },
        async cancel() {
          finish?.();
        },
        close() {},
      };
    },
  });
  const notifications: unknown[] = [];
  const foreign: unknown[] = [];
  try {
    const terminalSubscription = service.onDynamicSessionChanged(workspace)((change) => {
      if (
        change.kind === "updated" &&
        change.session.status === "idle" &&
        change.session.entries.some((entry) => entry.kind === "tool")
      ) {
        // 终态事件先于日志/active 清理；复现适配器在这个真实窗口里迟到的工具通知。
        void update({ kind: "tool", id: "same-id", status: "failed", output: "LATE" });
      }
    });
    const subscription = service.onDynamicExecutionTraceChanged(workspace)((change) =>
      notifications.push(change),
    );
    const other = service.onDynamicExecutionTraceChanged({
      ...workspace,
      workspaceIdentity: "different-host",
    })((change) => foreign.push(change));
    const session = await service.create({ ...workspace, agent: "codex", deferPersistence: true });
    for (let turn = 0; turn < 2; turn++) {
      const commandId = `command-${turn}`;
      const completed = service.prompt({
        ...workspace,
        id: session.id,
        text: "PRIVATE-PROMPT",
        commandId,
      });
      while (!finish || notifications.length < turn * 3 + 2)
        await new Promise<void>((resolve) => setImmediate(resolve));
      await update({
        kind: "tool",
        id: "same-id",
        output: "previous",
        outputTruncated: true,
        content: "previous",
        contentTruncated: true,
      });
      await update({
        kind: "tool",
        id: "same-id",
        output: "",
        outputTruncated: false,
        content: "",
        contentTruncated: false,
      });
      const partial = (await service.read({ ...workspace, id: session.id })).entries.at(-1)!;
      assert.ok(partial.kind === "tool");
      assert.equal(partial.input, "PRIVATE-INPUT");
      assert.equal(partial.output, "");
      assert.equal(partial.content, "");
      assert.equal(partial.outputTruncated, false);
      assert.equal(partial.contentTruncated, false);
      await update({ kind: "tool", id: "same-id", status: "in_progress" });
      finish();
      await completed;
      finish = undefined!;
      await service.prompt({ ...workspace, id: session.id, text: "duplicate", commandId });
    }
    const snapshot = await service.read({ ...workspace, id: session.id });
    const tools = snapshot.entries.filter((entry) => entry.kind === "tool");
    assert.equal(tools.length, 2);
    for (const tool of tools) {
      assert.equal(tool.input, "PRIVATE-INPUT");
      assert.equal(tool.output, "PRIVATE-OUTPUT");
      assert.equal(tool.toolKind, "execute");
    }
    const events = await service.getExecutionTrace({ ...workspace, id: session.id });
    assert.deepEqual(
      events.filter((event) => event.kind === "prompt-accepted").map((event) => event.turnIndex),
      [0, 2],
    );
    assert.deepEqual(
      events
        .filter((event) => event.kind === "tool-update")
        .map((event) => [event.turnIndex, event.entryIndex]),
      [
        [0, 1],
        [0, 1],
        [2, 3],
        [2, 3],
      ],
    );
    assert.equal(events.length, 8);
    assert.equal(new Set(events.map((event) => event.eventId)).size, 8);
    assert.equal(notifications.length, 8);
    assert.deepEqual(foreign, []);
    const path = await service.getDiagnosticLogPath({ ...workspace, id: session.id });
    assert.ok(!(await readFile(path, "utf8")).includes("PRIVATE"));
    subscription.dispose();
    other.dispose();
    terminalSubscription.dispose();
    const restarted = createAcpService({ directory });
    try {
      assert.deepEqual(await restarted.getExecutionTrace({ ...workspace, id: session.id }), events);
    } finally {
      await restarted.disposeAllAndWait();
    }
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("permission-only stdio tools retain details without fabricating an execution start", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-trace-permission-wire-"));
  const wireWorkspace = { ...workspace, workspacePath: directory };
  const path = join(directory, "agent.cjs");
  await writeFile(
    path,
    `
    const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\\n');
    let promptId;
    require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
      const message=JSON.parse(line);
      if(message.method==='initialize') send({id:message.id,result:{protocolVersion:1,agentCapabilities:{mcpCapabilities:{http:true}}}});
      else if(message.method==='session/new') send({id:message.id,result:{sessionId:'permission-native'}});
      else if(message.method==='session/prompt') {
        promptId=message.id;
        send({id:'permission',method:'session/request_permission',params:{sessionId:'permission-native',
          toolCall:{toolCallId:'only-permission',title:'PRIVATE TITLE',kind:'read',rawInput:{path:'PRIVATE FILE'}},options:[{optionId:'allow',name:'Allow',kind:'allow_once'}]}});
      } else if(message.id==='permission') {
        send({method:'session/update',params:{sessionId:'permission-native',update:{sessionUpdate:'tool_call_update',toolCallId:'only-permission',status:'completed',rawOutput:{text:'PRIVATE OUTPUT'}}}});
        send({id:promptId,result:{stopReason:'end_turn'}});
      }
    });
  `,
  );
  const events: AcpDiagnosticEvent[] = [];
  const service = createAcpService({
    directory,
    connect: (input) =>
      connectAcpAgent({
        ...input,
        launch: { command: process.execPath, args: [path], env: process.env },
      }),
  });
  try {
    const subscription = service.onDynamicExecutionTraceChanged(wireWorkspace)((change) =>
      events.push(change.event),
    );
    const session = await service.create({ ...wireWorkspace, agent: "codex" });
    const complete = service.prompt({
      ...wireWorkspace,
      id: session.id,
      commandId: "wire",
      text: "PRIVATE PROMPT",
    });
    await waitUntil(() => events.some((event) => event.kind === "permission-requested"));
    const pending = (await service.read({ ...wireWorkspace, id: session.id })).entries[1]!;
    assert.ok(pending.kind === "tool");
    assert.equal(pending.status, "unknown");
    assert.match(pending.input ?? "", /PRIVATE FILE/);
    const permission = events.find((event) => event.kind === "permission-requested")!;
    assert.equal(permission.entryIndex, 1);
    await service.decide({
      ...wireWorkspace,
      id: session.id,
      requestId: permission.requestId!,
      optionId: "allow",
    });
    await complete;
    const snapshot = await service.read({ ...wireWorkspace, id: session.id });
    const tool = snapshot.entries[1]!;
    assert.ok(tool.kind === "tool");
    assert.equal(tool.status, "completed");
    assert.equal(tool.toolKind, "read");
    assert.match(tool.output ?? "", /PRIVATE OUTPUT/);
    assert.deepEqual(
      events.filter((event) => event.kind === "tool-update").map((event) => event.status),
      ["unknown", "completed"],
    );
    assert.equal(events.at(-1)?.stopReason, "end_turn");
    assert.ok(
      !(
        await readFile(
          await service.getDiagnosticLogPath({ ...wireWorkspace, id: session.id }),
          "utf8",
        )
      ).includes("PRIVATE"),
    );
    subscription.dispose();
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("full diagnostics rotate instead of silently disabling all later trace events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-trace-rotation-"));
  const service = createAcpService({
    directory,
    connect: async () => ({
      sessionId: "native",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt() {},
      async cancel() {},
      close() {},
    }),
  });
  try {
    const session = await service.create({ ...workspace, agent: "claude" });
    await service.prompt({ ...workspace, id: session.id, text: "first", commandId: "first" });
    const path = await service.getDiagnosticLogPath({ ...workspace, id: session.id });
    await writeFile(
      path,
      `${JSON.stringify({ timestamp: 1, kind: "tool-update", status: "completed" })}\n`.repeat(
        40_000,
      ),
    );
    await service.prompt({ ...workspace, id: session.id, text: "latest", commandId: "latest" });
    const events = await service.getExecutionTrace({ ...workspace, id: session.id });
    assert.ok(events.some((event) => event.kind === "trace-truncated"));
    assert.equal(events.at(-1)?.kind, "turn-completed");
    assert.equal(events.at(-1)?.turnIndex, 1);
    assert.ok(events.length <= 500);
    assert.ok((await stat(path)).size < 2 * 1024 * 1024);
    await service.remove({ ...workspace, id: session.id });
    await assert.rejects(readFile(path), /ENOENT/);
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("permission decisions, stop and adapter exit preserve exact turn facts across retries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-trace-lifecycle-"));
  const callbacks: Parameters<AcpConnectionFactory>[0][] = [];
  const events: AcpDiagnosticEvent[] = [];
  const service = createAcpService({
    directory,
    connect: async (input) => {
      callbacks.push(input);
      return {
        sessionId: "native",
        configOptions: [
          {
            id: "model",
            name: "Model",
            type: "select",
            currentValue: "fixture-model",
            options: [{ name: "Fixture model", value: "fixture-model" }],
          },
        ],
        modeState: null,
        lastStopReason: "end_turn",
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async prompt() {
          await input.onUpdate({
            kind: "tool",
            id: "reused",
            title: "PRIVATE TOOL",
            status: "pending",
          });
          const choice = await input.onPermission({
            requestId: crypto.randomUUID(),
            toolCallId: "reused",
            title: "PRIVATE PERMISSION",
            options: [
              { optionId: "allow", name: "Allow", kind: "allow_once" },
              { optionId: "reject", name: "Reject", kind: "reject_once" },
            ],
          });
          if (choice === "reject") throw new Error("PRIVATE FAILURE");
          if (choice === "allow")
            await input.onUpdate({
              kind: "tool",
              id: "reused",
              status: "completed",
              output: "PRIVATE OUTPUT",
            });
        },
        async cancel() {},
        close() {},
      };
    },
  });
  try {
    const subscription = service.onDynamicExecutionTraceChanged(workspace)((change) =>
      events.push(change.event),
    );
    const session = await service.create({ ...workspace, agent: "codex" });
    for (const [ordinal, choice] of ["reject", "allow", "stop", "exit"].entries()) {
      const completed = service.prompt({
        ...workspace,
        id: session.id,
        text: "PRIVATE PROMPT",
        commandId: `turn-${ordinal}`,
      });
      // 拒绝会由 prompt 抛错，必须在投递时注册处理，避免把真实拒绝变成未处理 Promise。
      const result = completed.then(
        () => null,
        (error: Error) => error.message,
      );
      await waitUntil(
        () =>
          events.filter((event) => event.kind === "permission-requested").length === ordinal + 1,
      );
      const request = events.filter((event) => event.kind === "permission-requested").at(-1)!;
      if (choice === "stop") await service.stop({ ...workspace, id: session.id });
      else if (choice === "exit") callbacks.at(-1)!.onExit("PRIVATE EXIT");
      else
        await service.decide({
          ...workspace,
          id: session.id,
          requestId: request.requestId!,
          optionId: choice,
        });
      assert.equal(await result, choice === "reject" ? "PRIVATE FAILURE" : null);
      const expected =
        choice === "reject"
          ? "turn-interrupted"
          : choice === "stop"
            ? "turn-stopped"
            : choice === "exit"
              ? "adapter-exited"
              : "turn-completed";
      await waitUntil(() =>
        events.some((event) => event.kind === expected && event.turnIndex === ordinal * 2),
      );
      const resolved = events.find(
        (event) => event.kind === "permission-resolved" && event.requestId === request.requestId,
      )!;
      assert.equal(resolved.turnIndex, ordinal * 2);
      assert.equal(resolved.entryIndex, ordinal * 2 + 1);
      assert.equal(
        resolved.permissionDecision,
        choice === "reject" ? "reject_once" : choice === "allow" ? "allow_once" : "cancelled",
      );
      const sequence = events
        .filter((event) => event.turnIndex === ordinal * 2)
        .map((event) => event.kind);
      assert.ok(sequence.indexOf("permission-requested") < sequence.indexOf("permission-resolved"));
      assert.ok(sequence.indexOf("permission-resolved") < sequence.indexOf(expected));
      const snapshot = await service.read({ ...workspace, id: session.id });
      const user = snapshot.entries[ordinal * 2]!;
      assert.ok(user.kind === "user");
      assert.equal(
        user.endedAt,
        events.find((event) => event.kind === expected && event.turnIndex === ordinal * 2)
          ?.timestamp,
      );
      assert.ok(user.endedAt! >= user.createdAt!);
    }
    const snapshot = await service.read({ ...workspace, id: session.id });
    assert.equal(
      snapshot.entries[0]?.kind === "user" && snapshot.entries[0].traceError,
      "PRIVATE FAILURE",
    );
    assert.deepEqual(snapshot.entries[0]?.kind === "user" && snapshot.entries[0].traceSelections, [
      { name: "Model", value: "fixture-model" },
    ]);
    assert.equal(
      snapshot.entries[6]?.kind === "user" && snapshot.entries[6].traceError,
      "PRIVATE EXIT",
    );
    const before = events.length;
    await callbacks[0]!.onUpdate({ kind: "tool", id: "reused", title: "LATE", status: "failed" });
    assert.equal(events.length, before, "Old generation must not append terminal mutations");
    assert.deepEqual(await service.read({ ...workspace, id: session.id }), snapshot);
    const restored = createAcpService({ directory });
    try {
      assert.deepEqual(
        (await restored.read({ ...workspace, id: session.id })).entries,
        snapshot.entries,
      );
    } finally {
      await restored.disposeAllAndWait();
    }
    await assert.rejects(
      service.getExecutionTrace({ ...workspace, workspaceIdentity: "other-host", id: session.id }),
      /does not belong/,
    );
    const log = await readFile(
      await service.getDiagnosticLogPath({ ...workspace, id: session.id }),
      "utf8",
    );
    assert.ok(!log.includes("PRIVATE"));
    subscription.dispose();
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});
