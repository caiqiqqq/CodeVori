import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWorkflowActorModel,
  workflowActorModelPolicy,
} from "../src/app/workflow-actor-model.ts";

test("actor-specific model and reasoning override only that actor's run default", () => {
  const parent = { providerId: "p", modelId: "parent" };
  const run = { providerId: "p", modelId: "run" };
  const actor = parseWorkflowActorModel("other/special$high");
  assert.deepEqual(actor, {
    providerId: "other",
    modelId: "special",
    options: { reasoningLevel: "high" },
  });
  assert.equal(
    workflowActorModelPolicy(
      { parentSelection: parent, runSelection: run, actorSelection: actor },
      "old/pin",
    ).configOverrides.modelSelection,
    actor,
  );
  assert.equal(
    workflowActorModelPolicy({ parentSelection: parent, runSelection: run }, "old/pin")
      .configOverrides.modelSelection,
    run,
  );
  assert.deepEqual(
    workflowActorModelPolicy({ parentSelection: parent }, "p/parent").configOverrides,
    {},
  );
  assert.deepEqual(parent, { providerId: "p", modelId: "parent" });
  assert.throws(() => parseWorkflowActorModel("main"));
  assert.throws(() => parseWorkflowActorModel("/model"));
});

test("workflow DSL accepts per-actor concrete models and retains guarded child policy", async () => {
  const { compileWorkflowScript } = await import("@zcode/dynamic-workflow");
  const { workflowPermissionMode } = await import("../src/app/workflow-permission-mode.ts");
  const compiled = compileWorkflowScript(
    `const writer=agent('writer',{system:'Write',model:'fixture/writer$high'});\nreturn await writer.ask('Produce a short report');`,
  );
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.equal(workflowPermissionMode("guarded"), "guarded");
  assert.equal(workflowPermissionMode("yolo"), "yolo");
});

test("journal replay retains actor model, reasoning, session and resolved pin", async () => {
  const { WorkflowEngine, InMemoryJournalStore } = await import("@zcode/dynamic-workflow");
  const journal = new InMemoryJournalStore();
  const driver = { journal, emit: () => {}, now: () => 1 } as never;
  const config = {
    runId: "actor-model-replay",
    driver,
    caps: { maxConcurrency: 1 },
    askSpecs: new Map(),
    validate: () => ({ ok: true }),
  } as any;
  const first = new WorkflowEngine(config);
  first.createActor("writer-site", "writer", { model: "fixture/writer$high" });
  const actor = journal.getActor(config.runId, "writer-site", 1)!;
  assert.ok(actor);
  journal.putActor({ ...actor, sessionId: "child-fixture", resolvedModel: "fixture/writer" });
  const replay = new WorkflowEngine(config);
  replay.createActor("writer-site", "writer", { model: "fixture/writer$high" });
  const restored = journal.getActor(config.runId, "writer-site", 1)!;
  assert.equal(restored.persona.model, "fixture/writer$high");
  assert.equal(restored.sessionId, "child-fixture");
  assert.equal(restored.resolvedModel, "fixture/writer");
});

test("guarded survives strict submission schemas and offers only allow-once or deny", async () => {
  const { submissionModeSchema } = await import("@zcode/shared/zcode-protocol-v4");
  const { zcodeTaskModeSchema } =
    await import("../../../../../packages/shared/src/zcode-task-mode-schema.ts");
  const { buildProtocolPermissionOptions } = await import("../src/permission-options.ts");
  assert.equal(submissionModeSchema.parse("guarded"), "guarded");
  assert.equal(zcodeTaskModeSchema.parse("guarded"), "guarded");
  const options = buildProtocolPermissionOptions({
    toolName: "Bash",
    input: { command: "rm -rf fixture" },
    optionsPolicy: "no-always-allow",
  });
  assert.deepEqual(
    options.map((option) => option.kind),
    ["allow_once", "deny"],
  );
});
