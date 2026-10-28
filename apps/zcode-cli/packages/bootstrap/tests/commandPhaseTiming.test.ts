import assert from "node:assert/strict";
import test from "node:test";
import type { PhaseTimingRecord } from "@zcode/shared";
import type { CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import { ConversationV4Gateway } from "../src/zcode-protocol-v4/v4-gateway.js";

test("command timing distinguishes inbox wait, durable ledger, execution and duplicate ACK", async () => {
  const records: PhaseTimingRecord[] = [];
  let release!: () => void;
  let entered!: () => void;
  const executing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const gateway = new ConversationV4Gateway({
    sessionExists: () => true,
    emitWireFrame() {},
    admitCommandInput: async () => null,
    executeCommand: async () => {
      calls++;
      if (calls === 1) {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return undefined;
    },
    onCommandTiming: (record) => records.push(record),
  });
  const command = (id: string): CommandEnvelope => ({
    commandId: id,
    clientId: "client-1",
    sessionId: "session-1",
    issuedAt: 1,
    type: "sendText",
    payload: { text: "PRIVATE TEXT" },
  });
  try {
    const first = gateway.handleCommand(command("command-1"));
    await executing;
    const second = gateway.handleCommand(command("command-2"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(calls, 1, "session gate must still serialize admission");
    release();
    assert.equal((await first).status, "accepted");
    assert.equal((await second).status, "accepted");
    const secondRecord = records.find((record) => record.commandId === "command-2")!;
    assert.ok(secondRecord.phasesMs.inbox_wait_validate! >= 20);
    assert.ok("input_ledger" in secondRecord.phasesMs);
    assert.ok("execute_command" in secondRecord.phasesMs);
    assert.equal(secondRecord.commandType, "sendText");
    await gateway.handleCommand(command("command-1"));
    assert.equal(calls, 2, "timing must not replay duplicate commands");
    assert.ok(!JSON.stringify(records).includes("PRIVATE"));
  } finally {
    gateway.dispose();
  }
});
