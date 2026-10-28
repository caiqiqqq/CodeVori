import assert from "node:assert/strict";
import test from "node:test";
import { createRootTraceContext } from "@zcode/contracts";
import type { PhaseTimingRecord } from "@zcode/shared";
import { createInputFacade } from "../src/app/input-facade.js";

test("API ACK timing includes input-history persistence but never waits for model completion", async () => {
  const records: PhaseTimingRecord[] = [];
  let releaseHistory!: () => void;
  let historyStarted!: () => void;
  const historyReady = new Promise<void>((resolve) => {
    historyStarted = resolve;
  });
  const deps = {
    sessionId: "session-1",
    traceContext: createRootTraceContext({ attributes: { prompt: "PRIVATE TRACE" } }),
    logger: {
      info: (_message: string, record: PhaseTimingRecord) => records.push(record),
      warn() {},
    },
    prepareUserExecutionBoundary: async () => {},
    runtime: {
      getProjectId: () => "project-1",
      admitPrompt: async () => ({
        kind: "started",
        turnId: "turn-1",
        completion: new Promise(() => {}),
      }),
    },
    inputHistoryStore: {
      recordInputHistory: async () => {
        historyStarted();
        await new Promise<void>((resolve) => {
          releaseHistory = resolve;
        });
        return null;
      },
    },
  } as unknown as Parameters<typeof createInputFacade>[0];
  const facade = createInputFacade(deps);
  let accepted = false;
  const receipt = facade
    .sendInput({ text: "PRIVATE INPUT" }, { inputId: "command-1" })
    .then((value) => {
      accepted = true;
      return value;
    });
  await historyReady;
  assert.equal(accepted, false);
  assert.equal(records.length, 0);
  releaseHistory();
  assert.equal((await receipt).kind, "started_turn");
  const record = records[0]!;
  assert.equal(record.outcome, "accepted");
  assert.equal(record.commandId, "command-1");
  for (const phase of [
    "execution_boundary",
    "attachments_externalize",
    "custom_command_resolve",
    "core_admission",
    "input_history_write",
  ])
    assert.ok(phase in record.phasesMs, phase);
  assert.ok(!JSON.stringify(records).includes("PRIVATE"));
});
