import assert from "node:assert/strict";
import test from "node:test";
import { SessionEventType, type SessionEvent } from "@zcode/contracts";
import { conversationTelemetryFactSchema } from "@zcode/shared/zcode-protocol-v4";
import { ConversationTelemetryFactNormalizer } from "../src/zcode-protocol-v4/conversation-telemetry-facts.js";

test("live turn start preserves the actual foreground execution identity without leaking input", () => {
  const normalizer = new ConversationTelemetryFactNormalizer();
  const event = {
    id: "event",
    turnId: "turn",
    sequenceNumber: 1,
    timestamp: new Date(123),
    type: SessionEventType.TurnStarted,
    payload: {
      turnNumber: 1,
      input: "Synthetic input",
      inputId: "command",
      foregroundExecutionId: "foreground",
    },
  } as unknown as SessionEvent;
  const fact = normalizer.normalize("session", event);
  assert.equal(fact?.kind, "turn.started");
  assert.ok(fact?.kind === "turn.started");
  assert.equal(fact.foregroundExecutionId, "foreground");
  assert.equal(fact.sourceCommandId, "command");
  assert.equal("input" in fact, false);
  assert.deepEqual(conversationTelemetryFactSchema.parse(fact), fact);
});

test("older turn facts without a foreground identity remain valid", () => {
  const fact = conversationTelemetryFactSchema.parse({
    version: 1,
    kind: "turn.started",
    eventId: "event",
    eventSeq: 1,
    occurredAt: 123,
    sessionId: "session",
    sourceCommandId: "command",
  });
  assert.ok(fact.kind === "turn.started");
  assert.equal(fact.foregroundExecutionId, undefined);
});
