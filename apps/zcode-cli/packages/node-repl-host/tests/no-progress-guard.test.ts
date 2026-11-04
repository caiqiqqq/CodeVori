import assert from "node:assert/strict";
import test from "node:test";
import { createNoProgressGuard } from "../src/no-progress-guard.js";

const result = (text: string) => ({ content: [{ type: "text" as const, text }] });

test("同一 turn 的相同调用在第 5 次给出结束提示", () => {
  const guard = createNoProgressGuard();
  const requestMeta = { session_id: "session-a", turn_id: "turn-a" };
  for (let count = 1; count <= 5; count += 1) {
    const hint = guard.observe({ requestMeta, code: "same()", result: result(String(count)) });
    if (count < 5) assert.equal(hint, undefined);
    else assert.equal(hint?.text, "[node_repl] Same call ×5. You may end this turn.");
  }
});

test("代码变化但结果没有进展时按结果提示，换轮后计数清零", () => {
  const guard = createNoProgressGuard();
  const requestMeta = { session_id: "session-a", turn_id: "turn-a" };
  for (let count = 1; count <= 10; count += 1) {
    const hint = guard.observe({
      requestMeta,
      code: `call${count}()`,
      result: result("unchanged"),
    });
    if (count < 10) assert.equal(hint, undefined);
    else assert.equal(hint?.kind, "no_progress");
  }
  assert.equal(
    guard.observe({
      requestMeta: { session_id: "session-a", turn_id: "turn-b" },
      code: "call11()",
      result: result("unchanged"),
    }),
    undefined,
  );
});

test("缺少 turn 身份的调用不累计，其他会话不共享计数", () => {
  const guard = createNoProgressGuard();
  for (let count = 0; count < 10; count += 1) {
    assert.equal(
      guard.observe({
        requestMeta: { session_id: "session-a" },
        code: "same",
        result: result("x"),
      }),
      undefined,
    );
  }
  for (let count = 0; count < 4; count += 1) {
    guard.observe({
      requestMeta: { session_id: "session-a", turn_id: "t" },
      code: "same",
      result: result("x"),
    });
  }
  assert.equal(
    guard.observe({
      requestMeta: { session_id: "session-b", turn_id: "t" },
      code: "same",
      result: result("x"),
    }),
    undefined,
  );
});
