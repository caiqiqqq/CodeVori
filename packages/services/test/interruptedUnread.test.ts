import assert from "node:assert/strict";
import test from "node:test";
import { resolveTerminalUnreadSignal } from "../src/zcode-agent/zcodeTaskIndexSyncer.ts";

test("interruptions never allocate a new background completion unread signal", () => {
  for (const goalStatus of [undefined, "verified", "active"] as const) {
    assert.equal(
      resolveTerminalUnreadSignal({ phase: "completedInterrupted", goalStatus } as never),
      undefined,
    );
  }
});

test("success and failures keep their existing unread rules", () => {
  assert.equal(resolveTerminalUnreadSignal({ phase: "completedSuccess" }), "background_terminal");
  assert.equal(resolveTerminalUnreadSignal({ phase: "error" }), "background_terminal");
  assert.equal(resolveTerminalUnreadSignal({ phase: "running" }), undefined);
});
