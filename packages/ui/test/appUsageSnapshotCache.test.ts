import assert from "node:assert/strict";
import test from "node:test";
import type { AppUsageRequest, AppUsageSnapshot } from "@zcode/shared";
import {
  getCachedAppUsageSnapshot,
  readAppUsageSnapshot,
} from "../src/store/appUsageSnapshotCache.js";

const request: AppUsageRequest = { range: "all", timeZone: "UTC" };
const snapshot = (range: AppUsageRequest["range"], generatedAt = 1) =>
  ({ range, generatedAt }) as AppUsageSnapshot;

test("same service and scope share IO, retain successes and always revalidate after settlement", async () => {
  let calls = 0;
  let pending = Promise.withResolvers<AppUsageSnapshot>();
  const service = {
    getAppUsageSnapshot: () => {
      calls++;
      return pending.promise;
    },
  };
  const first = readAppUsageSnapshot(service, request);
  assert.strictEqual(readAppUsageSnapshot(service, request), first);
  assert.equal(getCachedAppUsageSnapshot(service, request), null);
  pending.resolve(snapshot("all"));
  await first;
  assert.equal(calls, 1);
  assert.equal(getCachedAppUsageSnapshot(service, request)?.generatedAt, 1);
  pending = Promise.withResolvers<AppUsageSnapshot>();
  const refresh = readAppUsageSnapshot(service, request);
  assert.equal(getCachedAppUsageSnapshot(service, request)?.generatedAt, 1);
  pending.resolve(snapshot("all", 2));
  await refresh;
  assert.equal(calls, 2);
  assert.equal(getCachedAppUsageSnapshot(service, request)?.generatedAt, 2);
});

test("Host instances, range and timezone are isolated, including late completion", async () => {
  const pending = Promise.withResolvers<AppUsageSnapshot>();
  const one = { getAppUsageSnapshot: () => pending.promise };
  const two = { getAppUsageSnapshot: async () => snapshot("all", 2) };
  const old = readAppUsageSnapshot(one, request);
  await readAppUsageSnapshot(two, request);
  assert.equal(getCachedAppUsageSnapshot(one, request), null);
  assert.equal(getCachedAppUsageSnapshot(two, { ...request, range: "7d" }), null);
  assert.equal(getCachedAppUsageSnapshot(two, { ...request, timeZone: "Asia/Shanghai" }), null);
  pending.resolve(snapshot("all", 1));
  await old;
  assert.equal(getCachedAppUsageSnapshot(two, request)?.generatedAt, 2);
});

test("a failed refresh preserves the last successful projection and allows retry", async () => {
  let fail = false;
  const service = {
    getAppUsageSnapshot: async () => {
      if (fail) throw new Error("offline");
      return snapshot("all");
    },
  };
  await readAppUsageSnapshot(service, request);
  fail = true;
  await assert.rejects(readAppUsageSnapshot(service, request), /offline/);
  assert.equal(getCachedAppUsageSnapshot(service, request)?.generatedAt, 1);
  fail = false;
  await readAppUsageSnapshot(service, request);
  const fresh = {
    getAppUsageSnapshot: async () => {
      throw new Error("offline");
    },
  };
  await assert.rejects(readAppUsageSnapshot(fresh, request), /offline/);
  assert.equal(getCachedAppUsageSnapshot(fresh, request), null);
});

test("only six settled scopes are retained and active requests are not evicted", async () => {
  const pending = Promise.withResolvers<AppUsageSnapshot>();
  const service = {
    getAppUsageSnapshot: (input: AppUsageRequest) =>
      input.timeZone === "UTC" ? pending.promise : Promise.resolve(snapshot(input.range)),
  };
  const flight = readAppUsageSnapshot(service, request);
  for (let i = 0; i < 8; i++)
    await readAppUsageSnapshot(service, { ...request, timeZone: `fixture-${i}` });
  assert.strictEqual(readAppUsageSnapshot(service, request), flight);
  assert.equal(getCachedAppUsageSnapshot(service, { ...request, timeZone: "fixture-0" }), null);
  pending.resolve(snapshot("all"));
  await flight;
  const retained = ["UTC", ...Array.from({ length: 8 }, (_, i) => `fixture-${i}`)].filter(
    (timeZone) => getCachedAppUsageSnapshot(service, { ...request, timeZone }),
  );
  assert.equal(retained.length, 6);
});
