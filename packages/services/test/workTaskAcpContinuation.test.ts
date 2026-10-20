import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { uuidv7 } from "@zcode/shared";
import { createAcpService } from "../src/acp/acpServiceImpl.js";
import { WorkTaskRepo } from "../src/session/workTaskRepo.js";
import { WorkTaskService } from "../src/session/workTaskService.js";
import { createWorkTaskConversation } from "../src/work-task/workTaskConversation.js";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";

async function assertAcpContinuation(initialStatus: "failed" | "done") {
  const directory = await mkdtemp(join(tmpdir(), "zcode-task-acp-continuation-"));
  const texts: string[] = [];
  let release: (() => void) | undefined;
  let reject: ((cause: Error) => void) | undefined;
  let cancels = 0;
  const acp = createAcpService({
    directory: join(directory, "acp"),
    connect: async () => ({
      sessionId: "native",
      configOptions: [],
      modeState: null,
      setConfigOption: async () => [],
      setMode: async () => {},
      close() {},
      async prompt(text) {
        texts.push(text);
        if (texts.length === 1) {
          if (initialStatus === "failed") throw new Error("Synthetic initial failure");
          return;
        }
        await new Promise<void>((resolve, fail) => {
          release = resolve;
          reject = fail;
        });
      },
      async cancel() {
        cancels++;
        release?.();
      },
    }),
  });
  const workspacePath = "/synthetic/trees/abcd/project";
  const taskScope = { workspacePath: "/synthetic/project" };
  const service = new WorkTaskService({
    repo: new WorkTaskRepo(join(directory, "tasks.sqlite")),
    conversation: createWorkTaskConversation({ acp, agent: {} as IZCodeAgentService }),
    execute: async (task, context) => {
      const session = await acp.create({ workspacePath, agent: "codex" });
      await context.update({
        session: { kind: "acp", id: session.id },
        worktree: {
          rootPath: "/synthetic/trees",
          path: workspacePath,
          projectPath: taskScope.workspacePath,
          branchName: "worktree/abcd",
          baseCommit: "abcdef",
        },
      });
      await acp.prompt({
        workspacePath,
        id: session.id,
        commandId: task.commandId,
        text: task.runText,
      });
    },
  });
  const read = async () => (await service.list(taskScope)).tasks[0]!;
  const until = async (status: string, ready = () => true) => {
    for (let i = 0; i < 100; i++) {
      if ((await read()).status === status && ready()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail(`task did not enter ${status}`);
  };
  try {
    const task = await service.create({
      ...taskScope,
      title: "Task",
      prompt: "Build",
      execution: { kind: "acp", agent: "codex", config: [] },
    });
    await service.start({ ...taskScope, id: task.id });
    await until(initialStatus === "failed" ? "failed" : "review");
    if (initialStatus === "done") await service.complete({ ...taskScope, id: task.id });
    const binding = (await read()).session!;
    const commandId = uuidv7();
    const send = () => acp.prompt({ workspacePath, id: binding.id, commandId, text: "Continue" });
    const running = send();
    await until("running", () => texts.length === 2);
    assert.equal((await read()).failureReason, undefined);
    assert.equal((await read()).completion, undefined);
    assert.equal((await read()).runSeq, 2);
    await send();
    assert.deepEqual(texts, ["Build", "Continue"], "duplicate ACK retry must not re-prompt");
    await acp.stop({ workspacePath, id: binding.id, expectedCommandId: task.commandId });
    assert.equal(cancels, 0, "old command's stop must not cancel the continued turn");
    assert.equal((await read()).status, "running");
    release?.();
    await running;
    await until("review");
    const failing = acp.prompt({
      workspacePath,
      id: binding.id,
      commandId: uuidv7(),
      text: "Try again",
    });
    const failed = assert.rejects(failing, /New failure/);
    await until("running", () => texts.length === 3);
    reject?.(new Error("New failure"));
    await failed;
    await until("failed");
    assert.equal((await read()).failureReason, "New failure");
    const last = acp.prompt({
      workspacePath,
      id: binding.id,
      commandId: uuidv7(),
      text: "One more",
    });
    await until("running", () => texts.length === 4);
    await service.cancel({ ...taskScope, id: task.id });
    await last;
    await until("canceled");
    assert.equal(cancels, 1);
    assert.deepEqual(texts, ["Build", "Continue", "Try again", "One more"]);
  } finally {
    await service.disposeAllAndWait();
    await acp.disposeAllAndWait();
    await rm(directory, { recursive: true, force: true });
  }
}

for (const initialStatus of ["failed", "done"] as const) {
  test(`real ACP Host admission directly resumes the ${initialStatus} task once and honors guarded stop`, () =>
    assertAcpContinuation(initialStatus));
}
