import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { acpSessionSchema, type WorkTask, type WorkTaskResultRequest } from "@zcode/shared";
import { createWorkTaskResult } from "../src/work-task/workTaskResult.js";
import type { IAcpService } from "../src/acp/acpService.js";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";
import type { IGitService } from "../src/git/git.js";

function fixture(kind: "api" | "acp") {
  const path = "/synthetic/task";
  const task = {
    id: "task",
    title: "Fix",
    prompt: "Fix the issue",
    workspacePath: path,
    useWorktree: false,
    directBranch: "main",
    session: { kind, id: "bound" },
    execution:
      kind === "api"
        ? { kind, modelSelection: { providerId: "old", modelId: "old-model" } }
        : { kind, agent: "codex", config: [] },
  } as WorkTask;
  const request: WorkTaskResultRequest = {
    workspacePath: path,
    id: task.id,
    requestId: randomUUID(),
    runSeq: 2,
    mode: "accept",
    locale: "zh-CN",
  };
  let model = {
    providerId: "dialog-provider",
    modelId: "dialog-model",
    options: { reasoningLevel: "low" },
  };
  let duringGeneration = () => {};
  let apiCalls = 0;
  let acpCalls = 0;
  const acp = acpSessionSchema.parse({
    id: "bound",
    workspacePath: path,
    agent: "codex",
    acpSessionId: "native",
    title: "Bound",
    status: "idle",
    pendingPermission: null,
    error: null,
    revision: 8,
    entries: [{ id: "answer", kind: "assistant", text: "typecheck passed" }],
    configOptions: [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "dialog-codex",
        options: [{ value: "dialog-codex", name: "Dialog Codex" }],
      },
    ],
  });
  let snapshot = () => ({
    session: { sessionId: "bound", workspace: { workspacePath: path } },
    settings: { model: { current: model }, thoughtLevel: { enabled: true, current: "high" } },
    messages: [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "typecheck passed" }] },
    ],
  });
  const port = createWorkTaskResult({
    git: {
      getTaskChangeRecord: async () => ({
        record: { state: "known", commits: [], files: [], uncommitted: [], truncated: false },
        patch: "+fix",
      }),
    } as unknown as IGitService,
    acp: {
      read: async (r: { workspacePath: string; id: string }) => {
        assert.equal(r.id, "bound");
        assert.equal(r.workspacePath, path);
        return structuredClone(acp);
      },
      generateText: async (r: { id: string; prompt: string; expectedRevision: number }) => {
        acpCalls++;
        assert.equal(r.id, "bound");
        assert.equal(r.expectedRevision, 8);
        assert.match(r.prompt, /typecheck passed/);
        duringGeneration();
        return {
          text: "ACP result",
          source: { agent: "codex", modelId: "dialog-codex", modelName: "Dialog Codex" },
        };
      },
    } as unknown as IAcpService,
    agent: {
      readSession: async (r: { sessionId: string; workspacePath: string }) => {
        assert.equal(r.sessionId, "bound");
        assert.equal(r.workspacePath, path);
        return snapshot();
      },
      generateWorkspaceText: async (r: {
        selection: unknown;
        tools: unknown[];
        prompt: string;
        workspacePath: string;
      }) => {
        apiCalls++;
        assert.equal(r.workspacePath, path);
        assert.deepEqual(r.tools, []);
        assert.deepEqual(r.selection, { ...model, options: { reasoningLevel: "high" } });
        assert.match(r.prompt, /typecheck passed/);
        assert.match(r.prompt, /\+fix/);
        duringGeneration();
        return { text: "API result" };
      },
    } as unknown as IZCodeAgentService,
  });
  return {
    port,
    task,
    request,
    acp,
    counts: () => ({ apiCalls, acpCalls }),
    changeModel: () => {
      model = { ...model, modelId: "changed-model" };
    },
    during: (fn: () => void) => {
      duringGeneration = fn;
    },
    setSnapshot: (fn: typeof snapshot) => {
      snapshot = fn;
    },
    snapshot: () => snapshot(),
  };
}

test("API summaries use the current conversation model and reasoning, not saved task selection", async () => {
  const f = fixture("api");
  assert.deepEqual(await f.port.source(f.task), {
    kind: "api",
    selection: {
      providerId: "dialog-provider",
      modelId: "dialog-model",
      options: { reasoningLevel: "high" },
    },
  });
  assert.deepEqual(f.counts(), { apiCalls: 0, acpCalls: 0 });
  f.changeModel();
  const result = await f.port.generate(f.task, f.request, new AbortController().signal);
  assert.equal(result.text, "API result");
  assert.equal(result.source.kind === "api" && result.source.selection.modelId, "changed-model");
  assert.deepEqual(f.counts(), { apiCalls: 1, acpCalls: 0 });
});

test("ACP summaries invoke the original agent channel without any API generation", async () => {
  const f = fixture("acp");
  const before = structuredClone(f.task);
  assert.deepEqual(await f.port.source(f.task), {
    kind: "acp",
    agent: "codex",
    modelId: "dialog-codex",
    modelName: "Dialog Codex",
  });
  assert.equal(
    (await f.port.generate(f.task, f.request, new AbortController().signal)).text,
    "ACP result",
  );
  assert.deepEqual(f.counts(), { apiCalls: 0, acpCalls: 1 });
  assert.deepEqual(f.task, before);
});

test("changed conversation model or reasoning discards the generated draft", async () => {
  const api = fixture("api");
  api.during(api.changeModel);
  await assert.rejects(
    api.port.generate(api.task, api.request, new AbortController().signal),
    /result-source-changed/,
  );
  const acp = fixture("acp");
  acp.during(() => {
    acp.acp.configOptions[0]!.currentValue = "different";
    acp.acp.configOptions[0]!.options = [{ value: "different", name: "Different" }];
  });
  await assert.rejects(
    acp.port.generate(acp.task, acp.request, new AbortController().signal),
    /result-source-changed/,
  );
});

test("missing model, remote identity, wrong session and unsupported ACP never fall back", async () => {
  const f = fixture("api");
  const snapshot = f.snapshot();
  f.setSnapshot(
    () =>
      ({
        ...snapshot,
        settings: { ...snapshot.settings, model: { current: undefined } },
      }) as ReturnType<typeof f.snapshot>,
  );
  await assert.rejects(f.port.source(f.task), /result-model-unavailable/);
  f.setSnapshot(() => ({
    ...snapshot,
    session: { ...snapshot.session, workspace: { workspacePath: "/wrong" } },
  }));
  await assert.rejects(f.port.source(f.task), /result-source-changed/);
  await assert.rejects(
    f.port.source({ ...f.task, remoteSessionId: "remote" }),
    /result-source-changed/,
  );
  const acp = fixture("acp");
  acp.acp.agent = "gemini";
  acp.task.execution = { kind: "acp", agent: "gemini", config: [] };
  await assert.rejects(acp.port.source(acp.task), /result-agent-unsupported/);
  assert.deepEqual(f.counts(), { apiCalls: 0, acpCalls: 0 });
  assert.deepEqual(acp.counts(), { apiCalls: 0, acpCalls: 0 });
});
