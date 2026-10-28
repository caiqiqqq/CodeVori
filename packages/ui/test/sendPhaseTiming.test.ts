import assert from "node:assert/strict";
import test from "node:test";
import { logger } from "../src/logger.ts";
import {
  reportSendFunnelSendClick,
  reportSendFunnelSendResult,
  setSendFunnelArmsReporter,
} from "../src/lib/sendFunnelArmsTelemetry.ts";

test("local click-to-render timing works without ARMS and excludes arbitrary telemetry details", (t) => {
  const records: Array<Record<string, unknown>> = [];
  t.mock.method(logger.lifecycle, "info", (_message: string, record: Record<string, unknown>) =>
    records.push(record),
  );
  setSendFunnelArmsReporter(null);
  reportSendFunnelSendClick({
    sessionId: "session-1",
    sendClickId: "click-1",
    sendTime: 1,
    trigger: "button",
    extraDetail: { private: "PRIVATE INPUT" },
  });
  reportSendFunnelSendResult({
    sessionId: "session-1",
    commandId: "command-1",
    sendClickId: "click-1",
    status: "success",
    ackStatus: "accepted",
    costMs: 2400,
    ackCostMs: 2100,
    queueConfirmed: false,
    extraDetail: { private: "PRIVATE INPUT" },
  });
  assert.equal(records.length, 2);
  assert.equal(records[1]?.sendClickId, records[0]?.sendClickId);
  assert.equal(records[1]?.commandId, "command-1");
  assert.equal(records[1]?.ackMs, 2100);
  assert.equal(records[1]?.postAckMs, 300);
  assert.ok(!JSON.stringify(records).includes("PRIVATE"));
});
