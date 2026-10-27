import assert from "node:assert/strict";
import test from "node:test";
import {
  createUnreadDotBitmap,
  formatWindowsUnreadDescription,
  parseWindowUnreadCount,
  sumWindowUnreadCounts,
  syncAppUnreadBadge,
} from "../src/main/unreadBadge.ts";

test("unread map aggregates and validates counts", () => {
  assert.equal(
    sumWindowUnreadCounts(
      new Map([
        [1, 2],
        [2, 3],
      ]),
    ),
    5,
  );
  assert.equal(parseWindowUnreadCount(-1), null);
  assert.equal(parseWindowUnreadCount(1.5), null);
  assert.equal(parseWindowUnreadCount(0), 0);
});

test("Windows taskbar description caps at 9+", () => {
  assert.equal(formatWindowsUnreadDescription(1), "1 unread task");
  assert.equal(formatWindowsUnreadDescription(12), "9+ unread tasks");
});

test("badge setter remains limited to macOS and Linux", () => {
  const counts: number[] = [];
  for (const platform of ["win32", "darwin", "linux"] as const) {
    syncAppUnreadBadge({
      platform,
      totalUnreadCount: 2,
      setBadgeCount: (count) => counts.push(count),
    });
  }
  assert.deepEqual(counts, [2, 2]);
});

test("dot bitmap keeps the base icon and adds a red opaque corner", () => {
  const original = Buffer.alloc(16 * 16 * 4, 0);
  original[0] = 42;
  const result = createUnreadDotBitmap(original, 16, 16);
  assert.equal(result[0], 42);
  const dot = (13 * 16 + 13) * 4;
  assert.equal(result[dot], 40);
  assert.equal(result[dot + 1], 45);
  assert.equal(result[dot + 2], 225);
  assert.equal(result[dot + 3], 255);
});
