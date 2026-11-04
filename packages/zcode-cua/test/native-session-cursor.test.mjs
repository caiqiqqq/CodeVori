import assert from "node:assert/strict";
import test from "node:test";
import { createSessionCursor } from "../native-session-cursor.mjs";

test("interleaved sessions bind stable native scope and close independently", async () => {
  const calls = [];
  let current;
  const native = {
    ghostSetRequestSession: (id) => {
      current = id;
      calls.push(["scope", id]);
    },
    ghostSetMultiCursorEnabled: () => {},
    ghostSetEnabled: () => {},
    ghostBeginActionWithTitle: (...args) => calls.push(["title", ...args]),
    ghostRemoveSession: (id) => calls.push(["remove", id]),
    clickAtPoint: () => {
      calls.push(["click", current]);
      return Promise.resolve(current);
    },
    setValue: () => {
      calls.push(["value", current]);
      throw Error("native failure");
    },
  };
  const a = createSessionCursor(native, "fallback-a"),
    b = createSessionCursor(native, "fallback-b");
  a.bind({ cursorSessionId: "session-a", actionTitle: "点击 A" });
  b.bind({ cursorSessionId: "session-b", actionTitle: "点击 B" });
  assert.equal(await a.native.clickAtPoint(), "session-a");
  assert.equal(current, null);
  assert.equal(await b.native.clickAtPoint(), "session-b");
  assert.throws(() => a.native.setValue(), /native failure/);
  assert.equal(current, null);
  a.close();
  a.close();
  assert.equal(await b.native.clickAtPoint(), "session-b");
  assert.deepEqual(
    calls.filter(([kind]) => kind === "remove"),
    [["remove", "session-a"]],
  );
  assert.throws(() => a.native.clickAtPoint(), /closed/);
  assert.throws(() => b.bind({ cursorSessionId: "session-c" }), /changed/);
  assert.ok(
    calls.some((row) => row[0] === "title" && row[2] === "session-a" && row[3] === "点击 A"),
  );
});
