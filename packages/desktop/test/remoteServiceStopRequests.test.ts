import { afterEach, expect, it, vi } from "vitest";
import {
  HostResponseTypes,
  hostResponseMessageSchema,
  type HostRemoteWorkspaceServiceStopResultResponse,
} from "@zcode/shared";
import { createRemoteServiceStopRequests } from "../src/main/remoteServiceStopRequests.js";

afterEach(() => vi.useRealTimers());
function setup(timeout = 100) {
  const requests = createRemoteServiceStopRequests(timeout);
  const host = { postMessage: vi.fn() };
  const reply = (result: { ok: true } | { ok: false; error: string }) => {
    const message = host.postMessage.mock.calls.at(-1)![0];
    return {
      type: HostResponseTypes.RemoteWorkspaceServiceStopResult,
      requestId: message.requestId,
      remoteSessionId: message.remoteSessionId,
      result,
    } satisfies HostRemoteWorkspaceServiceStopResultResponse;
  };
  return { requests, host, reply };
}
it("waits for a typed Host result, then resolves the exact request", async () => {
  const { requests, host, reply } = setup();
  let done = false;
  const pending = requests.send(host, "session-a").then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  const response = reply({ ok: true });
  expect(hostResponseMessageSchema.safeParse(response).success).toBe(true);
  expect(requests.receive(host, response)).toBe(true);
  await pending;
  expect(requests.receive(host, response)).toBe(false);
});
it("forwards Host failures instead of confirming dispatch as success", async () => {
  const { requests, host, reply } = setup();
  const pending = requests.send(host, "session-a");
  const rejected = expect(pending).rejects.toThrow("stop denied");
  requests.receive(host, reply({ ok: false, error: "stop denied" }));
  await rejected;
});
it("ignores responses from another owner or session", async () => {
  const { requests, host, reply } = setup();
  const pending = requests.send(host, "session-a");
  const response = reply({ ok: true });
  expect(requests.receive({ postMessage() {} }, response)).toBe(false);
  expect(requests.receive(host, { ...response, remoteSessionId: "session-b" })).toBe(false);
  expect(requests.receive(host, response)).toBe(true);
  await pending;
});
it("rejects pending requests when the owner exits", async () => {
  const { requests, host } = setup();
  const rejected = expect(requests.send(host, "session-a")).rejects.toThrow("Host unavailable");
  requests.rejectHost(host);
  await rejected;
});
it("bounds a missing Host response and cleans up its timer", async () => {
  vi.useFakeTimers();
  const { requests, host } = setup();
  const rejected = expect(requests.send(host, "session-a")).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
it("rejects dispatch errors immediately", async () => {
  const { requests } = setup();
  await expect(
    requests.send(
      {
        postMessage() {
          throw Error("closed pipe");
        },
      },
      "a",
    ),
  ).rejects.toThrow("closed pipe");
});
it("rejects malformed failures at the shared protocol boundary", () => {
  expect(
    hostResponseMessageSchema.safeParse({
      type: HostResponseTypes.RemoteWorkspaceServiceStopResult,
      requestId: "request",
      remoteSessionId: "a",
      result: { ok: false },
    }).success,
  ).toBe(false);
});
