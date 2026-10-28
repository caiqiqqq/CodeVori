import assert from "node:assert/strict";
import test from "node:test";
import { createRootTraceContext, type Model } from "@zcode/contracts";
import type { PhaseTimingRecord } from "@zcode/shared";
import { runCompactSummaryModelRequest } from "../src/runtime/methods/compact-summary-model-request.js";

for (const transport of ["stream", "fallback", "cancelled"] as const) {
  test(`compact timing observes ${transport} without logging summary or changing fallback boundaries`, async () => {
    const records: PhaseTimingRecord[] = [];
    const abort = new AbortController();
    let fallbacks = 0;
    const model = {
      providerId: "fixture",
      modelId: "fixture",
      async *streamText() {
        yield { type: "start" as const };
        if (transport !== "stream") {
          if (transport === "cancelled") abort.abort();
          throw new Error("PRIVATE NETWORK ERROR");
        }
        yield { type: "text_start" as const, id: "text-1" };
        yield { type: "text_delta" as const, id: "text-1", text: "PRIVATE SUMMARY" };
        yield { type: "text_end" as const, id: "text-1" };
        yield { type: "finish" as const, finishReason: "stop", usage: {} };
      },
      async generateText() {
        fallbacks++;
        return { text: "PRIVATE FALLBACK", finishReason: "stop", usage: {} };
      },
    } as unknown as Model;
    const run = () =>
      runCompactSummaryModelRequest({
        model,
        logger: {
          info: (_message: string, record: PhaseTimingRecord) => records.push(record),
          warn() {},
        } as unknown as NonNullable<Parameters<typeof runCompactSummaryModelRequest>[0]["logger"]>,
        request: {
          messages: [],
          abortSignal: abort.signal,
          modelCall: { operation: "context_compaction", operationId: "compact-1" },
          traceContext: createRootTraceContext({ attributes: { prompt: "PRIVATE TRACE" } }),
        },
      });
    if (transport === "cancelled") await assert.rejects(run());
    else
      assert.equal(
        (await run()).text,
        transport === "stream" ? "PRIVATE SUMMARY" : "PRIVATE FALLBACK",
      );
    const final = records.at(-1)!;
    assert.equal(final.operationId, "compact-1");
    assert.equal(final.scope, "api.compact_model");
    assert.equal(
      final.outcome,
      transport === "stream"
        ? "completed"
        : transport === "fallback"
          ? "fallback_completed"
          : "cancelled",
    );
    assert.ok("await_first_provider_event" in final.phasesMs);
    assert.equal(fallbacks, transport === "fallback" ? 1 : 0);
    if (transport === "fallback") assert.ok("fallback_non_stream" in final.phasesMs);
    assert.ok(!JSON.stringify(records).includes("PRIVATE"));
  });
}
