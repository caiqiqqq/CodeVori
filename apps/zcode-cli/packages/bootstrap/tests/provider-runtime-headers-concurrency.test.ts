import assert from "node:assert/strict";
import test from "node:test";
import { createRootTraceContext } from "@zcode/contracts";
import { zcodeProtocolNotifications } from "@zcode/shared";
import { createProviderRuntimeHeadersPort } from "../src/zcode-protocol/provider-runtime-headers.ts";
import { ProtocolRequestError, type ZCodeProtocolAgentServerContext } from "../src/zcode-protocol/server-types.ts";

const workspace = { workspacePath: "/synthetic-workspace", workspaceIdentity: "synthetic-identity" };
const input = {
  traceContext: createRootTraceContext(),
  sessionId: "same-session", providerId: "fixture", modelId: "fixture-model", reason: "model-request" as const,
  accountAccess: { type: "zhipu-account" as const, accountType: "zai" as const, mode: "individual-coding-plan" as const, entitled: true },
};

test("same-millisecond parallel and consecutive auth requests keep independent correlation and results", async (t) => {
  t.mock.method(Date, "now", () => 1234);
  const requests: { requestId: string; finish: () => void }[] = [];
  const port = createProviderRuntimeHeadersPort({
    requestClient: async (_method: unknown, params: { requestId: string }, schema: { parse(value: unknown): unknown }) =>
      new Promise((resolve) => {
        requests.push({ requestId: params.requestId, finish: () => resolve(schema.parse({
          headersApplied: true, requestAuth: { apiKey: `synthetic-${params.requestId}` },
        })) });
      }),
  } as unknown as ZCodeProtocolAgentServerContext, workspace);
  const pending = Array.from({ length: 32 }, () => port.refreshBeforeModelRequest(input));
  assert.equal(new Set(requests.map((r) => r.requestId)).size, 32);
  // Host 可以乱序应答；返回材料属于自己的 attempt，不读共享 Registry revision。
  for (const request of [...requests].reverse()) request.finish();
  const outcomes = await Promise.all(pending);
  outcomes.forEach((result, i) => assert.equal(result.requestAuth?.apiKey, `synthetic-${requests[i].requestId}`));
  for (let i = 0; i < 8; i++) {
    const next = port.refreshBeforeModelRequest(input);
    requests.at(-1)!.finish();
    await next;
  }
  assert.equal(new Set(requests.map((r) => r.requestId)).size, 40);
});

test("one failed auth response does not break other parallel or subsequent requests", async () => {
  let calls = 0;
  const port = createProviderRuntimeHeadersPort({
    requestClient: async () => ++calls === 1
      ? { headersApplied: false, errorMessage: "synthetic failure" }
      : { headersApplied: true, requestAuth: { apiKey: "synthetic-key" } },
  } as unknown as ZCodeProtocolAgentServerContext, workspace);
  const results = await Promise.allSettled([port.refreshBeforeModelRequest(input), port.refreshBeforeModelRequest(input)]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
  assert.equal((await port.refreshBeforeModelRequest(input)).requestAuth?.apiKey, "synthetic-key");
});

for (const failure of ["abort", "timeout"] as const) {
  test(`${failure} cancels only its matching Host auth request`, async () => {
    const controller = new AbortController();
    let requestId: string | undefined;
    const notifications: unknown[] = [];
    const port = createProviderRuntimeHeadersPort({
      requestClient: async (_method: unknown, params: { requestId: string }) => {
        requestId = params.requestId;
        if (failure === "abort") {
          controller.abort(new Error("synthetic stop"));
          throw controller.signal.reason;
        }
        throw new ProtocolRequestError(-32022, "synthetic timeout");
      },
      notify: (value: unknown) => notifications.push(value),
    } as unknown as ZCodeProtocolAgentServerContext, workspace);
    await assert.rejects(port.refreshBeforeModelRequest({ ...input, abortSignal: controller.signal }));
    assert.equal(notifications.length, 1);
    const notification = notifications[0] as { method: string; params: unknown };
    assert.equal(notification.method, zcodeProtocolNotifications.providerRuntimeHeadersCancelled);
    assert.deepEqual(notification.params, { workspace, sessionId: input.sessionId, requestId });
  });
}
