import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import type { NativeMcpServerRecord } from "@zcode/shared";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";
import { createAcpWorkflowWorld } from "../src/acp/acpWorkflowWorld.js";

const typedScript = `phase("调查");
const a = agent("研究员");
const result = await a.ask<{value: number}>("返回 42");
phase("交付");
await a.ask<{value: number}>("复核答案");
await artifact.markdown("report", "# 完成", {title: "报告"});
return result;`;

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const untilTime = Date.now() + 12000;
  let last: T | undefined;
  while (Date.now() < untilTime) {
    const value = await read();
    last = value;
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Workflow did not reach expected state: ${JSON.stringify(last).slice(0, 4000)}`);
}

async function call(server: NativeMcpServerRecord, name: string, args: unknown = {}) {
  const env = server.config.env!;
  const response = await fetch(env.ZCODE_WORKFLOW_URL!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  assert.equal(response.status, 200);
  const rpc = (await response.json()) as {
    result: { content: Array<{ text: string }>; isError?: boolean };
  };
  return JSON.parse(rpc.result.content[0]!.text) as Record<string, unknown>;
}

async function fixture(
  options: {
    script?: string;
    deny?: boolean;
    actor?: (
      input: Parameters<AcpConnectionFactory>[0],
      server: NativeMcpServerRecord,
    ) => Promise<void>;
    parentAfterCreate?: () => Promise<void>;
    parentResult?: (input: Parameters<AcpConnectionFactory>[0]) => Promise<void>;
    deferActorPermission?: boolean;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "zcode-acp-workflows-"));
  const target = {
    workspacePath: directory,
    workspaceIdentity: "remote:workflow",
    remoteSessionId: "attachment",
  };
  const actors: Array<Parameters<AcpConnectionFactory>[0]> = [];
  const changes: Array<[string, string | boolean]> = [];
  const received: string[] = [];
  const permissionTitles: string[] = [];
  let mainServer!: NativeMcpServerRecord;
  let createResult: Record<string, unknown> = {};
  let closed = 0;
  let parentCalls = 0;
  const answered = new Set<string>();
  const service = createAcpService({
    directory: join(directory, "sessions"),
    connect: async (input) => {
      const actorServer = input.workflowServers?.find(
        (server) => server.name === "zcode-workflow-result",
      );
      const server =
        actorServer ?? input.workflowServers?.find((server) => server.name === "zcode-workflows");
      assert.ok(server, "Host provisions the actual workflow MCP bridge");
      if (actorServer) actors.push(input);
      else mainServer = server;
      return {
        sessionId: actorServer ? `actor-${actors.length}` : "parent-native",
        configOptions: [
          {
            id: "model",
            name: "模型",
            category: "model",
            type: "select",
            currentValue: "initial",
            options: [
              { value: "initial", name: "initial" },
              { value: "chosen", name: "chosen" },
            ],
          },
        ],
        modeState: {
          currentModeId: "default",
          availableModes: [
            { id: "default", name: "default" },
            { id: "safe", name: "safe" },
          ],
        },
        provisionedMcpNames: new Set([server.name]),
        async setConfigOption(id, value) {
          changes.push([id, value]);
          return [
            {
              id: "model",
              name: "模型",
              category: "model",
              type: "select",
              currentValue: String(value),
              options: [{ value: "chosen", name: "chosen" }],
            },
          ];
        },
        async setMode(id) {
          changes.push(["mode", id]);
        },
        async prompt(_text, blocks) {
          const text =
            blocks
              ?.filter((block) => block.type === "text")
              .map((block) => block.text)
              .join("\n") ?? _text;
          received.push(text);
          if (actorServer) {
            if (options.actor) await options.actor(input, server);
            else {
              const rejected = await call(server, "submit_result", { result: { value: "bad" } });
              assert.equal(rejected.kind, "reject");
              const accepted = await call(server, "submit_result", { result: { value: 42 } });
              assert.equal(accepted.kind, "accept", JSON.stringify(accepted));
            }
          } else if (++parentCalls === 1) {
            assert.match(text, /CreateWorkflow/);
            createResult = await call(server, "CreateWorkflow", {
              script: options.script ?? typedScript,
              name: "测试工作流",
            });
            await options.parentAfterCreate?.();
          } else {
            assert.match(text, /ZCode 工作流运行结果/);
            if (options.parentResult) await options.parentResult(input);
            else await input.onUpdate({ kind: "text", text: "工作流已完成" });
          }
        },
        async cancel() {},
        close() {
          closed++;
        },
      };
    },
  });
  const unsubscribe = service.onDynamicSessionChanged(target)((change) => {
    if (change.kind !== "updated" || !change.session.pendingPermission) return;
    const permission = change.session.pendingPermission;
    if (answered.has(permission.requestId)) return;
    answered.add(permission.requestId);
    permissionTitles.push(permission.title);
    if (options.deferActorPermission && !permission.title.startsWith("启动工作流")) return;
    void service.decide({
      ...target,
      id: change.session.id,
      requestId: permission.requestId,
      optionId: options.deny ? "reject" : "allow",
    });
  });
  const session = await service.create({
    ...target,
    agent: "codex",
    requestId: crypto.randomUUID(),
  });
  await service.setConfigOption({ ...target, id: session.id, configId: "model", value: "chosen" });
  return {
    service,
    session,
    target,
    directory,
    actors,
    changes,
    received,
    permissionTitles,
    server: () => mainServer,
    result: () => createResult,
    closed: () => closed,
    async send() {
      return service.prompt({
        ...target,
        id: session.id,
        commandId: crypto.randomUUID(),
        text: "/workflow 返回答案",
        attachments: [],
        workspaceFiles: [],
      });
    },
    async cleanup() {
      unsubscribe.dispose();
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("ACP workflow uses the real engine, typed result validation, chosen ACP model and the original conversation", async () => {
  const f = await fixture();
  try {
    await f.send();
    const session = await until(
      () => f.service.read({ ...f.target, id: f.session.id }),
      (current) =>
        current.workflowRuns?.runs[0]?.status === "completed" &&
        current.entries.some(
          (entry) => entry.kind === "assistant" && entry.text === "工作流已完成",
        ),
    );
    assert.equal(
      session.entries.find((entry) => entry.kind === "user")?.text,
      "/workflow 返回答案",
    );
    assert.equal(f.result().status, "backgrounded");
    assert.equal(f.actors.length, 1);
    assert.equal(f.actors[0]!.agent, "codex");
    assert.equal(f.actors[0]!.workspacePath, f.target.workspacePath);
    assert.ok(f.changes.filter(([id, value]) => id === "model" && value === "chosen").length >= 2);
    assert.equal(session.workflowRuns?.runs[0]?.status, "completed");
    assert.ok(
      session.entries.some(
        (entry) => entry.kind === "tool" && entry.workflow?.graph?.phases?.length === 2,
      ),
    );
    assert.ok(
      session.entries.some((entry) => entry.kind === "assistant" && entry.text === "工作流已完成"),
    );
    assert.ok(f.closed() >= 1, "settlement closes workflow actors");
    const persisted = await readFile(
      await f.service.getSessionFilePath({ ...f.target, id: session.id }),
      "utf8",
    );
    assert.doesNotMatch(persisted, /ZCODE_WORKFLOW_TOKEN|Bearer /);
    assert.deepEqual(
      (await call(f.server(), "GetWorkflowRun", { runId: f.result().backgroundTaskId })).result,
      { value: 42 },
    );
    const runId = String(f.result().backgroundTaskId);
    const artifact = await f.service.getWorkflowArtifact({
      ...f.target,
      id: session.id,
      runId,
      artifactId: "report",
    });
    assert.equal(await readFile(artifact.path, "utf8"), "# 完成");
    await assert.rejects(
      f.service.getWorkflowArtifact({
        ...f.target,
        workspaceIdentity: "other",
        id: session.id,
        runId,
        artifactId: "report",
      }),
      /workspace/,
    );
    await assert.rejects(
      f.service.getWorkflowArtifact({ ...f.target, id: session.id, runId, artifactId: "missing" }),
      /not found/,
    );
  } finally {
    await f.cleanup();
  }
});

test("workflow completion during the parent turn automatically reaches the same ACP conversation", async () => {
  let release!: () => void;
  const parentHeld = new Promise<void>((resolve) => {
    release = resolve;
  });
  const script = `const out = await world.run("node", ["-e", "process.stdout.write('done')"]); return out.stdout; // ${"x".repeat(3200)}REVIEW_END`;
  const f = await fixture({ script, parentAfterCreate: () => parentHeld });
  try {
    const parentTurn = f.send();
    await until(
      () => f.service.read({ ...f.target, id: f.session.id }),
      (session) => session.workflowRuns?.runs[0]?.status === "completed",
    );
    assert.equal(f.received.length, 1, "the result waits while the parent uses its ACP port");
    assert.ok(
      f.permissionTitles[0]?.includes("REVIEW_END"),
      "confirmation shows the complete script",
    );
    release();
    await parentTurn;
    await until(
      () => f.service.read({ ...f.target, id: f.session.id }),
      (session) =>
        session.entries.some(
          (entry) => entry.kind === "assistant" && entry.text === "工作流已完成",
        ),
    );
    assert.equal(f.received.length, 2);
  } finally {
    release();
    await f.cleanup();
  }
});

test("an internal workflow-result failure stays an operation error and does not fail the original user turn", async () => {
  const f = await fixture({
    script: `return await world.run("node", ["-e", "process.stdout.write('done')"]);`,
    parentResult: async (input) => {
      await input.onUpdate({
        kind: "failure",
        failure: {
          id: "background",
          revision: 1,
          severity: "error",
          category: "connection",
          title: "background SSE error",
          actions: ["retry"],
        },
      });
    },
  });
  try {
    await f.send();
    const snapshot = await until(
      () => f.service.read({ ...f.target, id: f.session.id }),
      (session) => session.status === "interrupted" && session.error === "background SSE error",
    );
    assert.match(snapshot.errorCommandId ?? "", /^workflow-result:/);
    const user = snapshot.entries.find((entry) => entry.kind === "user");
    assert.equal(user?.traceError, undefined);
    assert.equal(user?.failures, undefined);
    assert.equal(f.received.length, 2);
  } finally {
    await f.cleanup();
  }
});

test("cancelling a workflow releases only its outstanding ACP actor permission", async () => {
  const f = await fixture({
    script: 'phase("查看"); const a = agent("甲"); return await a.ask("读取文件");',
    deferActorPermission: true,
    actor: async (input) => {
      const decision = await input.onPermission({
        requestId: crypto.randomUUID(),
        title: "读取文件",
        options: [
          { optionId: "allow", name: "允许", kind: "allow_once" },
          { optionId: "reject", name: "拒绝", kind: "reject" },
        ],
      });
      assert.equal(decision, null);
    },
  });
  try {
    await f.send();
    const pending = await until(
      () => f.service.read({ ...f.target, id: f.session.id }),
      (session) => session.pendingPermission?.title === "读取文件",
    );
    const runId = pending.workflowRuns!.runs[0]!.runId;
    await f.service.cancelWorkflow({ ...f.target, id: f.session.id, runId });
    const stopped = await f.service.read({ ...f.target, id: f.session.id });
    assert.equal(stopped.workflowRuns!.runs[0]!.status, "stopped");
    assert.equal(stopped.pendingPermission, null);
  } finally {
    await f.cleanup();
  }
});

test("invalid scripts and denied workflow permission never create actors or a run", async () => {
  for (const opts of [{ deny: true }, { script: "return invalidSymbol;" }]) {
    const f = await fixture(opts);
    try {
      const session = await f.send();
      assert.equal(f.actors.length, 0);
      assert.equal(session.workflowRuns?.runs.length ?? 0, 0);
      assert.notEqual(f.result().status, "backgrounded");
    } finally {
      await f.cleanup();
    }
  }
});

test("workflow progress survives restart; resume reuses completed asks and rejects cross-workspace commands", async () => {
  let release!: () => void;
  let secondStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    secondStarted = resolve;
  });
  let asks = 0;
  const script =
    'const a = agent("共享"); const first = await a.ask("first"); const second = await a.ask("second"); return {first, second};';
  const f = await fixture({
    script,
    actor: async (input) => {
      if (++asks === 1) await input.onUpdate({ kind: "text", text: "first-result" });
      else {
        secondStarted();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    },
  });
  try {
    const turn = f.send();
    await started;
    const live = await f.service.read({ ...f.target, id: f.session.id });
    const runId = live.workflowRuns!.runs[0]!.runId;
    await assert.rejects(
      f.service.cancelWorkflow({
        ...f.target,
        workspaceIdentity: "remote:other",
        id: f.session.id,
        runId,
      }),
      /workspace/,
    );
    await f.service.stop({ ...f.target, id: f.session.id });
    release();
    await turn;
    await f.service.disposeAllAndWait();
    // 模拟 journal 已写入但会话的进度投影尚未保存时的 Host 崩溃。
    const sessionFile = join(f.directory, "sessions", `${f.session.id}.json`);
    const saved = JSON.parse(await readFile(sessionFile, "utf8")) as Record<string, unknown>;
    delete saved.workflowRuns;
    await writeFile(sessionFile, JSON.stringify(saved));
    const replayed: string[] = [];
    const reconnect = createAcpService({
      directory: join(f.directory, "sessions"),
      connect: async (input) => ({
        sessionId: input.sessionId ?? "resumed-actor",
        configOptions: [
          {
            id: "model",
            name: "模型",
            type: "select",
            currentValue: "chosen",
            options: [{ value: "chosen", name: "chosen" }],
          },
        ],
        modeState: null,
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async prompt(text) {
          replayed.push(text);
          await input.onUpdate({ kind: "text", text: "second-result" });
        },
        async cancel() {},
        close() {},
      }),
    });
    try {
      const snapshot = await reconnect.read({ ...f.target, id: f.session.id });
      assert.equal(snapshot.workflowRuns!.runs[0]!.status, "stopped");
      await Promise.all([
        reconnect.resumeWorkflow({ ...f.target, id: f.session.id, runId }),
        reconnect.resumeWorkflow({ ...f.target, id: f.session.id, runId }),
      ]);
      await until(
        () => reconnect.read({ ...f.target, id: f.session.id }),
        (value) => value.workflowRuns?.runs[0]?.status === "completed",
      );
      assert.equal(replayed.length, 1);
      assert.match(replayed[0]!, /second/);
      assert.doesNotMatch(replayed[0]!, /first\n/);
    } finally {
      await reconnect.disposeAllAndWait();
    }
  } finally {
    release?.();
    await f.cleanup();
  }
});

test("workflow stdio MCP proxy speaks actual JSON-RPC and revokes its session token on shutdown", async () => {
  const f = await fixture();
  try {
    const config = f.server().config;
    const child = spawn(config.command!, config.args, {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });
    try {
      const response = new Promise<string>((resolve) => lines.once("line", resolve));
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2024-11-05" } })}\n`,
      );
      assert.equal(JSON.parse(await response).result.capabilities.tools !== undefined, true);
    } finally {
      lines.close();
      child.kill();
    }
    const server = f.server();
    const listed = await fetch(server.config.env!.ZCODE_WORKFLOW_URL!, {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.config.env!.ZCODE_WORKFLOW_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const catalog = (await listed.json()) as {
      result: { tools: Array<{ name: string; inputSchema: { required?: string[] } }> };
    };
    assert.deepEqual(
      catalog.result.tools.find((tool) => tool.name === "CreateWorkflow")?.inputSchema.required,
      ["script"],
    );
    assert.deepEqual(
      catalog.result.tools.find((tool) => tool.name === "ResumeWorkflowRun")?.inputSchema.required,
      ["runId"],
    );
    await f.service.disposeAllAndWait();
    await assert.rejects(call(server, "ReadWorkflowInstructions"));
  } finally {
    await f.cleanup();
  }
});

test("ACP workflow runs parallel actors after parent admission and forwards actor permissions", async () => {
  const script =
    'phase("并行调查"); const a = agent("甲"); const b = agent("乙"); const values = await Promise.all([a.ask("first"), b.ask("second")]); return values;';
  let admitted = 0;
  const permissions: Array<string | null> = [];
  const f = await fixture({
    script,
    actor: async (input) => {
      // The main ACP turn may already have finished when an actor asks for tool permission.
      await new Promise((resolve) => setTimeout(resolve, 25));
      permissions.push(
        await input.onPermission({
          requestId: crypto.randomUUID(),
          title: "读取文件",
          options: [
            { optionId: "allow", name: "允许", kind: "allow_once" },
            { optionId: "reject", name: "拒绝", kind: "reject" },
          ],
        }),
      );
      admitted++;
      await input.onUpdate({ kind: "text", text: "done" });
    },
  });
  try {
    await f.send();
    const completed = await until(
      () => f.service.read({ ...f.target, id: f.session.id }),
      (value) => value.workflowRuns?.runs[0]?.status === "completed",
    );
    assert.equal(admitted, 2);
    assert.deepEqual(permissions, ["allow", "allow"]);
    assert.equal(completed.workflowRuns?.runs[0]?.actors.length, 2);
  } finally {
    await f.cleanup();
  }
});

test("world.run executes only the approved literal command and records its result", async () => {
  const script =
    'phase("验证"); const out = await world.run("node", ["-e", "process.stdout.write(\'ok\')"]); return out.stdout;';
  const f = await fixture({ script });
  try {
    await f.send();
    await until(
      () => f.service.read({ ...f.target, id: f.session.id }),
      (value) => value.workflowRuns?.runs[0]?.status === "completed",
    );
    const runId = f.result().backgroundTaskId;
    const result = await call(f.server(), "GetWorkflowRun", { runId });
    assert.equal(result.result, "ok");
    assert.equal(f.actors.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("workflow artifact publishing does not follow a workspace output symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-artifact-root-"));
  const outside = await mkdtemp(join(tmpdir(), "zcode-acp-artifact-outside-"));
  try {
    await symlink(outside, join(root, ".zcode"), "dir");
    const world = createAcpWorkflowWorld({
      cwd: root,
      runId: "run-1",
      commands: new Set(),
      signal: new AbortController().signal,
    });
    await assert.rejects(
      world.publish({
        runId: "run-1",
        siteId: "artifact#1",
        ordinal: 1,
        op: "markdown",
        id: "result",
        version: 1,
        content: "ok",
      }),
      /symlink leaves the workspace/,
    );
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  }
});
