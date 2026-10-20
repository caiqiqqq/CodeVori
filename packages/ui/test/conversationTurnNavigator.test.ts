import assert from "node:assert/strict";
import test from "node:test";
import { resolveConversationTurnNavigatorActiveQueryRowId as resolve } from "../src/v4/conversationTurnNavigatorHelpers.ts";

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
