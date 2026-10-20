import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getDelegationAgentReference, uuidv7, type DelegationApiAgent } from "@zcode/shared";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import type { IModelSelectionService } from "../src/model-provider/providerFacadeServices.js";
import { listApiDelegationTargets } from "../src/delegation/delegationTargets.js";
import { readDelegationApiAnswer } from "../src/delegation/delegationApiResult.js";
import { AgentDelegationService } from "../src/delegation/agentDelegationService.js";

const api: DelegationApiAgent = {
  kind: "api",
  providerName: "测试服务商",
  execution: {
    kind: "api",
    modelSelection: {
      providerId: "provider/中文",
      modelId: "model/中文 v2",
      options: { reasoningLevel: "high" },
    },
    mode: "build",
  },
  reasoningLevels: ["low", "high"],
};

test("API delegation catalog reuses Registry defaults and exposes no credentials", async () => {
  let reads = 0;
  const source = {
    getView: async () => {
      reads++;
      return {
        providers: [
          {
            providerId: "provider/中文",
            providerName: api.providerName,
            config: { api: { type: "openai" }, access: { apiKey: "synthetic-secret" } },
            models: [
              {
                modelId: "model/中文 v2",
                config: { optionSpecs: { reasoningLevel: { values: ["low", "high"] } } },
              },
              {
                modelId: "unselectable",
                config: { optionSpecs: { reasoningLevel: { values: [] } } },
              },
            ],
          },
          { providerId: "no-api", providerName: "No API", config: {}, models: [] },
        ],
      };
    },
  } as unknown as IModelSelectionService;
  assert.deepEqual(await listApiDelegationTargets(source), [api]);
  assert.equal(reads, 1);
  assert.ok(!JSON.stringify(await listApiDelegationTargets(source)).includes("synthetic-secret"));
  const reference = getDelegationAgentReference(api);
  const [, provider, model] = reference.split(".");
  assert.equal(Buffer.from(provider!, "hex").toString(), api.execution.modelSelection.providerId);
  assert.equal(Buffer.from(model!, "hex").toString(), api.execution.modelSelection.modelId);
  assert.notEqual(
    reference,
    getDelegationAgentReference({
      ...api,
      execution: {
        ...api.execution,
        modelSelection: { ...api.execution.modelSelection, providerId: "other-provider" },
      },
    }),
  );
});

test("API admission validates catalog identity/options and preserves accepted idempotency", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-api-"));
  let enabled = true;
  const service = new AgentDelegationService({
    path: join(directory, "tasks.sqlite"),
    targets: async () => [
      { agent: "codex", enabled: true, ready: true },
      { agent: "claude", enabled: false, ready: true },
    ],
    apiTargets: async () => (enabled ? [api] : []),
    execute: async () => {
      throw new Error("not scheduled");
    },
    deliver: async () => false,
  });
  try {
    assert.deepEqual(
      (await service.targets()).map((t) => t.kind),
      ["acp", "api"],
    );
    const input = {
      workspacePath: directory,
      kind: "acp" as const,
      sessionId: "parent",
      title: "API 委派",
      task: "检查",
      requestId: uuidv7(),
      background: "",
      constraints: "",
      expectedResult: "",
      intent: "analysis" as const,
      execution: api.execution,
      dependsOn: [],
    };
    const accepted = await service.delegate(input);
    assert.deepEqual(accepted.execution, api.execution);
    await assert.rejects(
      service.delegate({
        ...input,
        requestId: uuidv7(),
        execution: {
          ...api.execution,
          modelSelection: { ...api.execution.modelSelection, providerId: "missing" },
        },
      }),
      /model-unavailable/,
    );
    await assert.rejects(
      service.delegate({
        ...input,
        requestId: uuidv7(),
        execution: {
          ...api.execution,
          modelSelection: {
            ...api.execution.modelSelection,
            options: { reasoningLevel: "invalid" },
          },
        },
      }),
      /model-unavailable/,
    );
    await assert.rejects(
      service.delegate({
        ...input,
        requestId: uuidv7(),
        execution: {
          ...api.execution,
          modelSelection: { providerId: "provider/中文", modelId: "model/中文 v2" },
        },
      }),
      /model-unavailable/,
    );
    enabled = false;
    assert.deepEqual(
      (await service.targets()).map((t) => t.kind),
      ["acp"],
    );
    assert.equal((await service.delegate(input)).id, accepted.id);
    await assert.rejects(service.delegate({ ...input, requestId: uuidv7() }), /model-unavailable/);
  } finally {
    await service.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
});

function row(rowId: number, turnId: string, body: Record<string, unknown>): ConversationRow {
  return { rowId, turnId, createdAt: 1, createdAtSeq: rowId, ...body } as ConversationRow;
}
function reader(pages: ConversationRow[][], revisionChange = false) {
  const calls: Array<{ beforeRowId?: number; workspacePath: string; sessionId: string }> = [];
  return {
    calls,
    agent: {
      async conversationRowsRangeV4(input: (typeof calls)[number]) {
        calls.push(input);
        return {
          rows: pages[calls.length - 1]!,
          atSeq: 10,
          atRevision: revisionChange ? calls.length : 1,
          atLogEpoch: "epoch",
          hasMore: calls.length < pages.length,
        };
      },
    },
  };
}

test("API result reads only this command's last complete answer across row pages", async () => {
  const f = reader([
    [
      row(8, "current", { kind: "assistantText", text: "本轮结论", state: "complete" }),
      row(9, "later", { kind: "turnHeader", sourceCommandId: "other-command" }),
      row(10, "later", { kind: "assistantText", text: "别的用户回答", state: "complete" }),
    ],
    [
      row(1, "old", { kind: "assistantText", text: "旧回答", state: "complete" }),
      row(2, "current", { kind: "turnHeader", sourceCommandId: "current-command" }),
      row(3, "current", { kind: "assistantText", text: "前言", state: "complete" }),
      row(4, "current", { kind: "reasoning", text: "不能回传推理", state: "complete" }),
      row(5, "current", { kind: "assistantText", text: "未完成文本", state: "streaming" }),
    ],
  ]);
  assert.equal(
    await readDelegationApiAnswer(
      f.agent,
      "/worktree",
      "child",
      "current-command",
      new AbortController().signal,
    ),
    "本轮结论",
  );
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1]!.beforeRowId, 8);
  assert.equal(f.calls[0]!.workspacePath, "/worktree");
  assert.equal(f.calls[0]!.sessionId, "child");
});

test("API result never substitutes old text and refuses revision mixing or cancellation", async () => {
  const f = reader([[row(1, "old", { kind: "assistantText", text: "旧回答", state: "complete" })]]);
  assert.equal(
    await readDelegationApiAnswer(
      f.agent,
      "/project",
      "child",
      "missing-command",
      new AbortController().signal,
    ),
    undefined,
  );
  const changed = reader(
    [
      [row(5, "current", { kind: "assistantText", text: "结论", state: "complete" })],
      [row(1, "current", { kind: "turnHeader", sourceCommandId: "command" })],
    ],
    true,
  );
  await assert.rejects(
    readDelegationApiAnswer(
      changed.agent,
      "/project",
      "child",
      "command",
      new AbortController().signal,
    ),
    /result-changed/,
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    readDelegationApiAnswer(f.agent, "/project", "child", "command", aborted.signal),
  );
  assert.equal(f.calls.length, 1);
});
