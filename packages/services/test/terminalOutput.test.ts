import assert from "node:assert/strict";
import { test } from "node:test";
import { TerminalOutput } from "../src/terminal/terminalOutput.js";

test("terminal output survives initial and reconnect subscription gaps without duplicates", () => {
  const output = new TerminalOutput();
  output.fire("prompt");
  output.fire("early");
  const first: string[] = [];
  const subscription = output.event((data) => first.push(data));
  assert.deepEqual(first, ["prompt", "early"]);
  const second: string[] = [];
  const other = output.event((data) => second.push(data));
  output.fire("live");
  assert.deepEqual(second, ["live"]);
  subscription.dispose();
  output.fire("still-live");
  other.dispose();
  output.fire("gap");
  const reconnected: string[] = [];
  output.event((data) => reconnected.push(data));
  assert.deepEqual(reconnected, ["gap"]);
  assert.deepEqual(first, ["prompt", "early", "live"]);
  assert.deepEqual(second, ["live", "still-live"]);
  output.dispose();
});

test("terminal replay preserves ordering when a listener produces more output", () => {
  const output = new TerminalOutput();
  output.fire("one");
  output.fire("two");
  const received: string[] = [];
  output.event((data) => {
    received.push(data);
    if (data === "one") output.fire("three");
  });
  assert.deepEqual(received, ["one", "two", "three"]);
  output.dispose();
});

test("terminal backlog is bounded even for a single oversized chunk", () => {
  const output = new TerminalOutput(8);
  output.fire("old");
  output.fire("0123456789");
  output.fire("");
  output.fire("AB");
  const received: string[] = [];
  output.event((data) => received.push(data));
  assert.equal(received.join(""), "456789AB");
  output.dispose();
});

test("live reentrant output reaches every listener in the same order without truncation", () => {
  const output = new TerminalOutput(2);
  const first: string[] = [];
  const second: string[] = [];
  output.event((data) => {
    first.push(data);
    if (data === "long-live-output") output.fire("nested");
  });
  output.event((data) => second.push(data));
  output.fire("long-live-output");
  assert.deepEqual(first, ["long-live-output", "nested"]);
  assert.deepEqual(second, first);
  output.dispose();
});

test("disposed terminal drops buffered and late output", () => {
  const output = new TerminalOutput();
  output.fire("pending");
  output.dispose();
  output.fire("late");
  const received: string[] = [];
  output.event((data) => received.push(data));
  assert.deepEqual(received, []);
});
