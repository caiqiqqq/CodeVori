import assert from "node:assert/strict";
import test from "node:test";
import { removeTailscaleDevice } from "../src/main/deviceBridgeManagement.js";

test("management DELETE pins origin, stable ID, Basic credentials and refuses redirects", async () => {
  const calls: unknown[] = [];
  await removeTailscaleDevice(
    "synthetic-api-key",
    "n123CNTRL",
    new AbortController().signal,
    async (url, init) => {
      calls.push(url);
      assert.equal(init?.method, "DELETE");
      assert.equal(init?.redirect, "error");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        `Basic ${Buffer.from("synthetic-api-key:").toString("base64")}`,
      );
      assert.ok(init?.signal);
      return new Response(null, { status: 200 });
    },
  );
  assert.deepEqual(calls, ["https://api.tailscale.com/api/v2/device/n123CNTRL"]);
});

test("management errors never expose response body or transport secrets", async () => {
  for (const [status, code] of [
    [401, "management_unauthorized"],
    [403, "management_forbidden"],
    [404, "device_missing"],
    [501, "device_external"],
    [429, "management_failed"],
    [500, "removal_unconfirmed"],
  ] as const) {
    await assert.rejects(
      removeTailscaleDevice(
        "synthetic",
        "n123",
        new AbortController().signal,
        async () => new Response("private-secret", { status }),
      ),
      { message: `device_bridge_${code}` },
    );
  }
  await assert.rejects(
    removeTailscaleDevice("synthetic", "n123", new AbortController().signal, async () => {
      throw new Error("private-secret");
    }),
    { message: "device_bridge_removal_unconfirmed" },
  );
});

test("invalid targets and pre-cancelled requests never dispatch DELETE", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return new Response(null, { status: 200 });
  };
  for (const id of ["../other", "x?redirect=1", "", "https://evil.test", "."]) {
    await assert.rejects(
      removeTailscaleDevice("synthetic", id, new AbortController().signal, fetcher),
    );
  }
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(removeTailscaleDevice("synthetic", "n123", abort.signal, fetcher));
  assert.equal(calls, 0);
});
