import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ChannelClient, ChannelServer, Emitter, ProxyChannel, type VSBuffer } from "@zcode/rpc";
import { createForgeApiClient } from "../src/git/providers/forgeApiClient.js";

function fixture(
  t: TestContext,
  replies: Array<Response | Error>,
  provider: "github" | "gitlab" | "gitea" = "github",
) {
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args));
  const calls: RequestInit[] = [];
  const api = createForgeApiClient({
    provider,
    baseUrl: "https://private-forge.example.invalid/api",
    secret: "synthetic-secret",
    fetcher: (async (_url, init) => {
      calls.push(init ?? {});
      const response = replies.shift();
      if (response instanceof Error) throw response;
      assert.ok(response instanceof Response, "No automatic retry or extra request is allowed");
      return response;
    }) as typeof fetch,
  });
  const create = () =>
    api(
      "repos/private-owner/private-project/issues",
      { privateQuery: "private-search" },
      {
        method: "POST",
        body: { title: "private-title", body: "private-body" },
      },
    );
  return { api, create, warnings, calls };
}

test("image response diagnostics classify MIME without recording arbitrary header values or content", async (t) => {
  for (const [header, expected] of [
    [null, "missing"],
    ["application/octet-stream; private=synthetic-secret", "application/octet-stream"],
    ["image/png", "image/png"],
    ["text/html", "text/html"],
    ["application/json", "application/json"],
    ["application/private-synthetic-secret", "other"],
  ] as const) {
    const f = fixture(
      t,
      [
        new Response(Buffer.from("private-body"), {
          headers: header ? { "content-type": header } : {},
        }),
      ],
      "gitlab",
    );
    await assert.rejects(
      f.api("projects/private-project/uploads/private-file", {}, undefined, "image"),
      /FORGE_RESPONSE/,
    );
    assert.deepEqual(f.warnings[0]?.at(-1), {
      provider: "gitlab",
      method: "GET",
      phase: "response",
      status: 200,
      requestId: null,
      imageContentType: expected,
    });
    assert.equal(f.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(f.warnings), /private-|synthetic-secret|https:/);
  }
});

test("issue POST failures preserve HTTP status, classify errors and never automatically resend", async (t) => {
  const cases = [
    [400, "BAD_REQUEST"],
    [401, "AUTHENTICATION"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [405, "CONFLICT"],
    [409, "CONFLICT"],
    [410, "HTTP_ERROR"],
    [422, "CONFLICT"],
    [429, "RATE_LIMIT"],
    [500, "SERVER_ERROR"],
    [502, "SERVER_ERROR"],
    [503, "SERVER_ERROR"],
    [504, "SERVER_ERROR"],
  ] as const;
  for (const [status, code] of cases) {
    await t.test(String(status), async (t) => {
      const f = fixture(t, [
        new Response("private-provider-body synthetic-secret", {
          status,
          statusText: "private-status-text",
          headers: { "x-github-request-id": "ABCD:1234:EF56:7890", "set-cookie": "private-cookie" },
        }),
      ]);
      await assert.rejects(f.create(), (error: Error & { status?: number }) => {
        assert.equal(error.message, `FORGE_${code}`);
        assert.equal(error.status, status);
        return true;
      });
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0]?.method, "POST");
      assert.equal(f.warnings.length, 1);
      assert.deepEqual(f.warnings[0]?.at(-1), {
        provider: "github",
        method: "POST",
        phase: "http",
        status,
        requestId: "ABCD:1234:EF56:7890",
      });
      assert.doesNotMatch(
        JSON.stringify(f.warnings),
        /private-|synthetic-secret|set-cookie|https:/,
      );
    });
  }
});

test("GitHub exhausted and secondary rate limits remain distinct from permission denial", async (t) => {
  for (const headers of [{ "x-ratelimit-remaining": "0" }, { "retry-after": "60" }]) {
    const f = fixture(t, [new Response(null, { status: 403, headers })]);
    await assert.rejects(f.create(), /FORGE_RATE_LIMIT/);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(t, [
    new Response(null, { status: 403, headers: { "retry-after": "private-value" } }),
  ]);
  await assert.rejects(f.create(), /FORGE_FORBIDDEN/);
});

test("HTTP diagnostics discard untrusted request IDs and survive response cleanup failure", async (t) => {
  const response = new Response("private-body", {
    status: 502,
    headers: { "x-github-request-id": "https://private-host/token?secret=synthetic-secret" },
  });
  t.mock.method(response.body!, "cancel", async () => {
    throw new Error("private-cancel-error");
  });
  const f = fixture(t, [response]);
  await assert.rejects(f.create(), (error: Error & { status?: number }) => {
    assert.equal(error.message, "FORGE_SERVER_ERROR");
    assert.equal(error.status, 502);
    return true;
  });
  assert.deepEqual(f.warnings[0]?.at(-1), {
    provider: "github",
    method: "POST",
    phase: "http",
    status: 502,
    requestId: null,
  });
});

test("self-hosted request IDs are bounded and GitHub rate-limit headers do not change other providers", async (t) => {
  for (const provider of ["gitlab", "gitea"] as const) {
    for (const requestId of ["01ABC_correlation-12", "x".repeat(129)]) {
      const f = fixture(
        t,
        [
          new Response(null, {
            status: 403,
            headers: {
              "x-request-id": requestId,
              "x-ratelimit-remaining": "0",
            },
          }),
        ],
        provider,
      );
      await assert.rejects(f.create(), /FORGE_FORBIDDEN/);
      assert.deepEqual(f.warnings[0]?.at(-1), {
        provider,
        method: "POST",
        phase: "http",
        status: 403,
        requestId: requestId.length <= 128 ? requestId : null,
      });
    }
  }
});

test("the existing Host RPC wire preserves the normalized creation error and HTTP status", async (t) => {
  const f = fixture(t, [new Response("private-body", { status: 503 })]);
  const inboundClient = new Emitter<VSBuffer>();
  const inboundServer = new Emitter<VSBuffer>();
  const client = new ChannelClient({
    onMessage: inboundClient.event,
    send: (data) => inboundServer.fire(data),
  });
  const server = new ChannelServer(
    { onMessage: inboundServer.event, send: (data) => inboundClient.fire(data) },
    "fixture",
  );
  try {
    server.registerChannel("git", ProxyChannel.fromService({ createForgeIssue: f.create }));
    const remote = ProxyChannel.toService<{ createForgeIssue(): Promise<unknown> }>(
      client.getChannel("git"),
    );
    await assert.rejects(remote.createForgeIssue(), (error: Error & { status?: number }) => {
      assert.equal(error.message, "FORGE_SERVER_ERROR");
      assert.equal(error.status, 503);
      assert.doesNotMatch(error.message, /private-body/);
      return true;
    });
    assert.equal(f.calls.length, 1);
  } finally {
    client.dispose();
    server.dispose();
    inboundClient.dispose();
    inboundServer.dispose();
  }
});

test("network and malformed successful responses have different diagnostic phases without leaking payloads", async (t) => {
  for (const [reply, code, phase, status] of [
    [new Error("private-url synthetic-secret"), "NETWORK", "network", null],
    [new Response("<html>private-body</html>"), "RESPONSE", "response", 200],
  ] as const) {
    const f = fixture(t, [reply]);
    await assert.rejects(f.create(), new RegExp(`^Error: FORGE_${code}$`));
    assert.equal(f.calls.length, 1);
    assert.equal(f.warnings.length, 1);
    assert.deepEqual(f.warnings[0]?.at(-1), {
      provider: "github",
      method: "POST",
      phase,
      status,
      requestId: null,
    });
    assert.doesNotMatch(JSON.stringify(f.warnings), /private-|synthetic-secret/);
  }
});
