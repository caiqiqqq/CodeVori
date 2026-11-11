import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConversationTurnNavigatorItems,
  resolveConversationTurnNavigatorActiveQueryRowId as resolve,
} from "../src/v4/conversationTurnNavigatorHelpers.ts";
import { shouldTriggerLoadOlder } from "../src/v4/timelineScrollAnchor.ts";

const positions = [
  { rowId: 10, start: 1030, end: 1080 },
  { rowId: 20, start: 1500, end: 1590 },
  { rowId: 30, start: 1800, end: 1860 },
];
const bottom = {
  positions,
  scrollOffsetPx: 1000,
  viewportHeightPx: 900,
  contentHeightPx: 1900,
  latestQueryRowId: 30,
};

test("bottom selects the latest query when older queries are still visible", () => {
  assert.equal(resolve(bottom), 30);
});

test("away from bottom selects reading position and returning selects latest", () => {
  assert.equal(resolve({ ...bottom, scrollOffsetPx: 900 }), 10);
  assert.equal(resolve(bottom), 30);
});

test("bottom shares the existing 48px tolerance", () => {
  assert.equal(resolve({ ...bottom, scrollOffsetPx: 952 }), 30);
  assert.equal(resolve({ ...bottom, scrollOffsetPx: 951 }), 10);
});

test("bottom selects the directory latest query even when its anchor is unmounted", () => {
  assert.equal(resolve({ ...bottom, positions: positions.slice(0, 1) }), 30);
  assert.equal(resolve({ ...bottom, positions: [] }), 30);
});

test("content shorter than viewport selects latest; an unmeasured viewport does not", () => {
  const short = {
    positions: [
      { rowId: 10, start: 20, end: 70 },
      { rowId: 30, start: 170, end: 220 },
    ],
    scrollOffsetPx: 0,
    viewportHeightPx: 900,
    contentHeightPx: 400,
    latestQueryRowId: 30,
  };
  assert.equal(resolve(short), 30);
  assert.equal(resolve({ ...short, positions: [], viewportHeightPx: 0 }), undefined);
});

test("empty directory and callers without bottom metrics retain legacy behavior", () => {
  assert.equal(resolve({ ...bottom, positions: [], latestQueryRowId: undefined }), undefined);
  assert.equal(resolve({ positions, scrollOffsetPx: 1000, viewportHeightPx: 900 }), 10);
});

test("unloaded directory items stay lightweight and do not claim a virtual body unit", () => {
  const items = buildConversationTurnNavigatorItems(
    [],
    {
      assistantEmptyPreview: "empty",
      assistantRunningPreview: "running",
      userFallbackPreview: "question",
    },
    [
      {
        rowId: 5,
        turnId: "turn-5",
        userText: "q".repeat(1_000),
        assistantText: "a".repeat(1_000),
      },
      { rowId: 2, turnId: "turn-2", userText: "older" },
    ],
  );
  assert.deepEqual(
    items.map((item) => item.rowId),
    [2, 5],
  );
  assert.ok(items.every((item) => item.unitIndex === -1));
  assert.ok(items.every((item) => item.userPreview.length <= 220));
  assert.ok(items.every((item) => item.assistantPreview.length <= 220));
});

test("history prefetch consumes user scroll intent but ignores layout scroll", () => {
  const nearTop = {
    scrollTop: 100,
    triggerPx: 800,
    canLoadOlder: true,
    loadingOlder: false,
    userInitiated: false,
    restoringScroll: false,
  };
  assert.equal(shouldTriggerLoadOlder(nearTop), false);
  assert.equal(shouldTriggerLoadOlder({ ...nearTop, userInitiated: true }), true);
  assert.equal(shouldTriggerLoadOlder({ ...nearTop, restoringScroll: true }), true);
  assert.equal(
    shouldTriggerLoadOlder({ ...nearTop, userInitiated: true, loadingOlder: true }),
    false,
  );
});
