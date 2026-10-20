import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import test from "node:test";
import {
  uuidv7,
  zcodeDelegationMcpResponseSchema,
  type DelegationTask,
  type NativeMcpServerRecord,
  type DelegationParent,
  type DelegationApiAgent,
} from "@zcode/shared";
import { AgentDelegationService } from "../src/delegation/agentDelegationService.js";
import { createDelegationMcp, delegationProtocolServer } from "../src/delegation/delegationMcp.js";
import {
  createDelegationExecution,
  createDelegationDelivery,
} from "../src/delegation/delegationExecution.js";
import { createAcpService } from "../src/acp/acpServiceImpl.js";
import { createGitService } from "../src/git/gitService.js";
import { createGitCliRepo } from "../src/git/repo/gitCliRepo.js";
import { WorkTaskAttachmentStore } from "../src/session/workTaskAttachmentStore.js";
import type { ISettingService } from "../src/setting/setting.js";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";

async function rpc(record: NativeMcpServerRecord, method: string, params?: unknown) {
  const env = record.config.env!;
  const response = await fetch(env.ZCODE_WORKFLOW_URL!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as {
    result: {
      content: Array<{ text: string }>;
      isError?: boolean;
      tools: Array<{ name: string; inputSchema: Record<string, unknown> }>;
    };
  };
}
async function call(record: NativeMcpServerRecord, name: string, args: unknown = {}) {
  const response = await rpc(record, "tools/call", { name, arguments: args });
  const data = JSON.parse(response.result.content[0]!.text);
  if (response.result.isError) throw new Error(data.error);
  return data;
}
async function until(
  service: AgentDelegationService,
  parent: DelegationParent,
  predicate: (task: DelegationTask) => boolean,
) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await service.tick();
    const tasks = await service.list(parent);
    if (tasks[0] && predicate(tasks[0])) return tasks[0];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`delegation fixture timed out: ${JSON.stringify(await service.list(parent))}`);
}

test("API and ACP scoped MCP capabilities use strict tools; stdio wait does not block cancel", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-mcp-"));
  const parent = { workspacePath: directory, kind: "api" as const, sessionId: "api-parent" };
  const apiTarget: DelegationApiAgent = {
    kind: "api",
    providerName: "Fixture API",
    execution: {
      kind: "api",
      modelSelection: {
        providerId: "fixture-provider",
        modelId: "model/v2",
        options: { reasoningLevel: "high" },
      },
      mode: "build",
    },
    reasoningLevels: ["high"],
  };
  const service = new AgentDelegationService({
    path: join(directory, "tasks.sqlite"),
    targets: async () => [
      { agent: "codex", ready: true, enabled: true },
      { agent: "claude", ready: true, enabled: false },
    ],
    apiTargets: async () => [apiTarget],
    execute: async () => {
      throw new Error("not scheduled");
    },
    deliver: async () => false,
  });
  const bridge = createDelegationMcp(directory, service);
  let worker: ReturnType<typeof spawn> | undefined;
  try {
    const registration = (await bridge.register(parent))!;
    assert.equal(
      zcodeDelegationMcpResponseSchema.parse([delegationProtocolServer(registration.record)])
        .length,
      1,
    );
    const tools = (await rpc(registration.record, "tools/list")).result.tools;
    assert.equal(tools.length, 10);
    assert.equal(
      tools.find((t) => t.name === "DelegateTask")!.inputSchema.additionalProperties,
      false,
    );
    const targets = await call(registration.record, "ListDelegationAgents");
    assert.deepEqual(
      targets
        .filter((target: { kind: string }) => target.kind === "acp")
        .map((target: { agent: string }) => target.agent),
      ["codex"],
    );
    const api = targets.find((target: { kind: string }) => target.kind === "api");
    assert.deepEqual(api.execution, apiTarget.execution);
    assert.match(api.reference, /^api\.[0-9a-f]+\.[0-9a-f]+$/);
    const apiTask = await call(registration.record, "DelegateTask", {
      title: "API 分析",
      task: "检查 API",
      execution: api.execution,
      intent: "analysis",
    });
    assert.deepEqual(apiTask.execution, apiTarget.execution);
    await call(registration.record, "CancelDelegation", { id: apiTask.id });
    const task = await call(registration.record, "DelegateTask", {
      title: "分析",
      task: "检查",
      execution: { kind: "acp", agent: "codex", config: [] },
      intent: "analysis",
    });
    const other = (await bridge.register({ ...parent, kind: "acp", sessionId: "other" }))!;
    await assert.rejects(call(other.record, "GetDelegationTask", { id: task.id }), /not-found/);
    await assert.rejects(
      call(registration.record, "DelegateTask", {
        title: "越界",
        task: "检查",
        workspacePath: "/other",
        execution: { kind: "acp", agent: "codex", config: [] },
      }),
      /Unrecognized key/,
    );
    worker = spawn(registration.record.config.command!, registration.record.config.args!, {
      env: { ...process.env, ...registration.record.config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const readers = new Map<number, (value: unknown) => void>();
    const lines = createInterface({ input: worker.stdout! });
    lines.on("line", (line) => {
      const response = JSON.parse(line);
      readers.get(response.id)?.(response.result);
    });
    const send = (id: number, name: string, args: unknown) =>
      new Promise<any>((resolve) => {
        readers.set(id, resolve);
        worker!.stdin!.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "tools/call",
            params: { name, arguments: args },
          }) + "\n",
        );
      });
    const waiting = send(1, "WaitDelegationTask", { id: task.id, timeoutMs: 5000 });
    const canceled = await Promise.race([
      send(2, "CancelDelegation", { id: task.id }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("stdio cancel blocked behind wait")), 1500);
        timer.unref();
      }),
    ]);
    assert.equal(JSON.parse(canceled.content[0].text).canceled, true);
    assert.equal(JSON.parse((await waiting).content[0].text).status, "canceled");
    worker.stdin!.end();
    await new Promise((resolve) => worker!.once("exit", resolve));
    lines.close();
    registration.revoke();
    assert.equal(
      (
        await fetch(registration.record.config.env!.ZCODE_WORKFLOW_URL!, {
          method: "POST",
          headers: {
            authorization: `Bearer ${registration.record.config.env!.ZCODE_WORKFLOW_TOKEN}`,
          },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.ok(
      !JSON.stringify(await service.list(parent)).includes(
        registration.record.config.env!.ZCODE_WORKFLOW_TOKEN!,
      ),
    );
  } finally {
    worker?.kill();
    bridge.dispose();
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ACP parent delegates through MCP, edit uses configured Git worktree, result and follow-up reuse original conversation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-chain-"));
  const project = join(directory, "project");
  const root = join(directory, "managed", "worktrees");
  await mkdir(project);
  const git = (args: string[]) => promisify(execFile)("git", ["-C", project, ...args]);
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "Fixture"]);
  await git(["config", "user.email", "fixture@example.invalid"]);
  await writeFile(join(project, "README.md"), "project evidence\n");
  await git(["add", "README.md"]);
  await git(["commit", "-qm", "initial"]);
  const attachments = new WorkTaskAttachmentStore(join(directory, "attachments"));
  const attachment = await attachments.importFile({
    workspacePath: project,
    localPath: join(project, "README.md"),
    fileName: "evidence.txt",
    mime: "text/plain",
  });
  let service!: AgentDelegationService;
  let bridge!: ReturnType<typeof createDelegationMcp>;
  let parentId = "";
  let parentServer!: NativeMcpServerRecord;
  const childPaths: string[] = [];
  const childCommands: string[] = [];
  const received: string[] = [];
  const configs: string[] = [];
  let launches = 0;
  const acp = createAcpService({
    directory: join(directory, "sessions"),
    delegation: {
      register: (session) =>
        bridge.register(
          { workspacePath: session.workspacePath, kind: "acp", sessionId: session.id },
          session.createRequestId,
        ),
      onInput: (session) =>
        service.armParent({
          workspacePath: session.workspacePath,
          kind: "acp",
          sessionId: session.id,
        }),
      onStop: (session) =>
        service.pauseParent({
          workspacePath: session.workspacePath,
          kind: "acp",
          sessionId: session.id,
        }),
      onResultInput: (session, commandId) =>
        service.beforeParentCommand(
          { workspacePath: session.workspacePath, kind: "acp", sessionId: session.id },
          "sendText",
          commandId,
        ),
    },
    connect: async (input) => {
      launches++;
      const server = input.workflowServers!.find((item) => item.name === "zcode-delegation")!;
      assert.ok(server);
      if (input.agent === "codex") parentServer = server;
      else childPaths.push(input.workspacePath);
      return {
        sessionId: input.sessionId ?? `native-${launches}`,
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "initial",
            options: [
              { value: "initial", name: "Initial" },
              { value: "chosen", name: "Chosen" },
            ],
          },
        ],
        modeState: null,
        provisionedMcpNames: new Set([server.name]),
        setConfigOption: async (_id, value) => {
          configs.push(String(value));
          return [
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: String(value),
              options: [{ value: "chosen", name: "Chosen" }],
            },
          ];
        },
        setMode: async () => {},
        cancel: async () => {},
        close() {},
        prompt: async (text, blocks) => {
          if (input.agent === "codex") {
            received.push(text);
            if (received.length === 1) {
              assert.match(
                blocks?.map((b) => (b.type === "text" ? b.text : "")).join("\n") ?? "",
                /ListDelegationAgents/,
              );
              await call(server, "DelegateTask", {
                title: "跨智能体检查",
                task: "检查文件",
                intent: "edit",
                attachments: [attachment],
                workspaceFiles: ["README.md"],
                execution: {
                  kind: "acp",
                  agent: "claude",
                  config: [{ configId: "model", value: "chosen" }],
                },
              });
            } else assert.match(text, /ZCode 智能体委派结果/);
          } else {
            const commandId = text.match(/commandId=([\w-]+)/)![1]!;
            childCommands.push(commandId);
            const links = blocks?.filter((block) => block.type === "resource_link") ?? [];
            assert.deepEqual(
              links.map((block) => block.name),
              ["README.md", "evidence.txt"],
            );
            for (const link of links)
              assert.match(await readFile(new URL(link.uri), "utf8"), /project evidence/);
            await call(server, "SubmitDelegationResult", {
              commandId,
              conclusion: "已核对文件",
              tests: ["fake ACP integration"],
              risks: ["未调用真实模型"],
            });
            await input.onUpdate({ kind: "text", text: "子智能体最终回答" });
          }
        },
      };
    },
  });
  const deps = {
    git: createGitService({ repo: createGitCliRepo() }),
    settings: { get: async () => ({ worktreeRootDirectory: root }) } as ISettingService,
    acp,
    agent: {} as IZCodeAgentService,
    homeDirectory: directory,
    ensureWorkspaceSubscription: () => {},
  };
  service = new AgentDelegationService({
    path: join(directory, "tasks.sqlite"),
    targets: async () => [{ agent: "claude", ready: true, enabled: true }],
    execute: createDelegationExecution(deps),
    deliver: createDelegationDelivery(deps),
    validateAssets: (input) => attachments.validate(input, input.attachments ?? []),
  });
  bridge = createDelegationMcp(directory, service);
  try {
    parentId = (await acp.create({ workspacePath: project, agent: "codex" })).id;
    assert.equal(launches, 1);
    await acp.prompt({
      workspacePath: project,
      id: parentId,
      commandId: uuidv7(),
      text: "@acp.claude 检查文件",
      attachments: [],
      workspaceFiles: [],
    });
    const parent = { workspacePath: project, kind: "acp" as const, sessionId: parentId };
    const task = await until(service, parent, (t) => t.attempts[0]?.delivery === "delivered");
    assert.equal(task.status, "completed", JSON.stringify(task.attempts));
    assert.equal(task.attempts[0]!.result!.conclusion, "已核对文件");
    assert.equal(task.worktree?.rootPath, root);
    assert.match(task.worktree!.path, /worktrees\/[0-9a-f]{4}\/project$/);
    assert.deepEqual(childPaths, [task.worktree!.path]);
    assert.deepEqual(configs, ["chosen"]);
    assert.equal((await git(["branch", "--show-current"])).stdout.trim(), "main");
    assert.equal(received.length, 2);
    const follow = await call(parentServer, "FollowUpDelegation", {
      id: task.id,
      task: "复核",
      attachments: [attachment],
      workspaceFiles: ["README.md"],
    });
    await until(service, parent, (t) => t.status === "completed");
    const deadline = Date.now() + 8000;
    while (
      !(await service.list(parent)).find((t) => t.id === follow.id)?.attempts.at(-1)?.endedAt &&
      Date.now() < deadline
    ) {
      await service.tick();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const followed = (await service.list(parent)).find((t) => t.id === follow.id)!;
    assert.equal(followed.status, "completed");
    assert.equal(followed.session?.id, task.session?.id);
    assert.equal(launches, 2, "follow-up keeps the live child connection");
    assert.equal(childCommands.length, 2);
    await assert.rejects(
      service.submitResult(followed.id, childCommands[0]!, { conclusion: "late" }),
      /stale-attempt/,
    );
    assert.equal((await service.list(parent))[0]!.attempts[0]!.result!.conclusion, "已核对文件");
    assert.equal(
      (await readFile(join(directory, "sessions", `${task.session!.id}.json`), "utf8")).includes(
        "ZCODE_WORKFLOW_TOKEN",
      ),
      false,
    );
  } finally {
    await service.disposeAllAndWait();
    await acp.disposeAllAndWait();
    bridge.dispose();
    await attachments.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const variant of [
  { name: "without MCP capability", provisioned: false, canDelegate: true },
  { name: "with only the child result tool", provisioned: true, canDelegate: false },
]) {
  test(`ACP ${variant.name} never advertises main delegation tools`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-capability-"));
    const received: string[] = [];
    const service = createAcpService({
      directory,
      delegation: {
        register: async () => ({
          record: {
            source: "zcodeagentmcp",
            scope: "workspace",
            name: "zcode-delegation",
            config: { command: process.execPath },
          },
          revoke() {},
          canDelegate: variant.canDelegate,
        }),
        onInput: async () => {},
        onStop: async () => {},
        onResultInput: async () => {},
      },
      connect: async () => ({
        sessionId: "native",
        configOptions: [],
        modeState: null,
        provisionedMcpNames: new Set(variant.provisioned ? ["zcode-delegation"] : []),
        setConfigOption: async () => [],
        setMode: async () => {},
        cancel: async () => {},
        close() {},
        prompt: async (_text, blocks) => {
          received.push(
            ...(blocks ?? []).filter((block) => block.type === "text").map((block) => block.text),
          );
        },
      }),
    });
    try {
      const session = await service.create({ workspacePath: directory, agent: "codex" });
      await service.prompt({
        workspacePath: directory,
        id: session.id,
        commandId: uuidv7(),
        text: "正常输入",
        attachments: [],
        workspaceFiles: [],
      });
      assert.equal(
        received.some((text) => text.includes("ListDelegationAgents")),
        false,
      );
      assert.ok(received.includes("正常输入"));
    } finally {
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
