import { PhaseTimer } from "@zcode/shared";
import type { Logger, ModelStreamEvent, TraceContext } from "../deps.js";

/** Counts content size only; never retains provider content or logs individual deltas. */
export class CompactModelTiming extends PhaseTimer {
  private firstEvent = false;
  private firstOutput = false;
  private textChars = 0;
  private reasoningChars = 0;

  constructor(logger: Logger | undefined, trace: TraceContext, operationId: string | undefined) {
    super({ scope: "api.compact_model", sessionId: trace.sessionId, operationId }, (record) =>
      logger?.info("Compact model phase timing", {
        traceId: trace.traceId,
        queryId: trace.queryId,
        spanId: trace.spanId,
        ...record,
      }),
    );
  }

  observe(event: ModelStreamEvent): void {
    // SDK start 是本地开始；真实响应边界或内容到达才能结束首事件等待。
    if (
      !this.firstEvent &&
      (event.type === "text_delta" ||
        event.type === "reasoning_delta" ||
        (event.type === "compact_stream_boundary" && event.boundary === "provider_response_start"))
    ) {
      this.firstEvent = true;
      this.phase("await_first_output");
      this.report();
    }
    if (!this.firstOutput && (event.type === "text_delta" || event.type === "reasoning_delta")) {
      this.firstOutput = true;
      this.phase("stream_generate");
    }
    if (event.type === "text_delta") this.textChars += event.text.length;
    if (event.type === "reasoning_delta") this.reasoningChars += event.text.length;
  }

  override finish(status: string): void {
    this.setFacts({
      textChars: this.textChars,
      reasoningChars: this.reasoningChars,
      firstProviderEvent: this.firstEvent,
      firstOutput: this.firstOutput,
    });
    super.finish(status);
  }
}
