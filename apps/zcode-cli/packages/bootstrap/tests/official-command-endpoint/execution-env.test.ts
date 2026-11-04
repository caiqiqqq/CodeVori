/* 官方插件命令进程的代理端点（技术方案 5.8）：CLI 不持有凭证，端点按 session token 认出会话、
 * 只放行 Sites 接口、向 host 现取身份头后转发给 zcode-server。这里用真实的 UDS 和一个本地
 * 假 zcode-server 验证转发细节，凭证解析由 host 侧测试覆盖。 */

import { assert, describe, expect, it, vi } from "vitest";

import type { ExecutionPort, ExecutionRequest } from "@zcode/contracts";
import {
  supportsBackgroundTaskWaiter,
  supportsBashBackgroundLifecycle,
  type BackgroundTaskWaiterExecutionPort,
  type BashBackgroundLifecycleExecutionPort,
} from "@zcode/core";
import { withOfficialCommandEnv } from "../../src/official-command-endpoint/index.js";
import { createOfficialCommandAuthHeadersPort } from "../../src/zcode-protocol/official-mcp-auth-port.js";

const IDENTITY = { Authorization: "Bearer zcode-jwt", "X-Bigmodel-Authorization": "Bearer maas" };
const WORKSPACE_A = { workspacePath: "/w/a" };
const WORKSPACE_B = { workspacePath: "/w/b", workspaceIdentity: "remote:b" };

describe("withOfficialCommandEnv", () => {
  function fakePort() {
    const run = vi.fn(async (_request: ExecutionRequest) => ({}) as never);
    const start = vi.fn(async (_request: ExecutionRequest) => ({}) as never);
    const getBackgroundTask = vi.fn(async () => undefined);
    return { getBackgroundTask, run, start } satisfies ExecutionPort;
  }
  const request = (env?: ExecutionRequest["env"]): ExecutionRequest =>
    ({ command: { mode: "shell", command: "true" }, ...(env ? { env } : {}) }) as ExecutionRequest;

  it("adds the session endpoint env to foreground and background runs", async () => {
    const port = fakePort();
    const wrapped = withOfficialCommandEnv(port, async () => ({ ZCODE_OFFICIAL_ENDPOINT: "/s" }));

    await wrapped.run(request({ set: { A: "1", ZCODE_OFFICIAL_ENDPOINT: "/forged" } }));
    await wrapped.start!(request());
    await wrapped.run(request({ base: "empty" }));

    expect(port.run.mock.calls[0]![0].env).toEqual({
      set: { A: "1", ZCODE_OFFICIAL_ENDPOINT: "/s" },
    });
    expect(port.start.mock.calls[0]![0].env).toEqual({ set: { ZCODE_OFFICIAL_ENDPOINT: "/s" } });
    expect(port.run.mock.calls[1]![0].env).toEqual({ base: "empty" });
    expect(wrapped.getBackgroundTask).toBeDefined();
    expect(wrapped.cancelBackgroundTask).toBeUndefined();
    expect(supportsBashBackgroundLifecycle(wrapped)).toBe(false);
    expect(supportsBackgroundTaskWaiter(wrapped)).toBe(false);
  });

  const lifecycleModes = ["explicit", "auto_on_timeout"] as const;
  const backgroundOutcome = {
    kind: "backgrounded" as const,
    task: { taskId: "task-1", status: "running" as const, startedAt: new Date(0) },
  };

  it.each(lifecycleModes)(
    "preserves the %s Bash lifecycle and injects the session env",
    async (mode) => {
      const runBash = vi
        .fn<BashBackgroundLifecycleExecutionPort["runBashWithBackgroundLifecycle"]>()
        .mockResolvedValue(backgroundOutcome);
      const port = Object.freeze({ ...fakePort(), runBashWithBackgroundLifecycle: runBash });
      const endpointEnv = {
        ZCODE_OFFICIAL_ENDPOINT: "/session",
        ZCODE_OFFICIAL_ENDPOINT_TOKEN: "token",
      };
      const resolveEnv = vi.fn(async () => endpointEnv);
      const wrapped = withOfficialCommandEnv(port, resolveEnv);
      const originalRequest = request({ set: { A: "1", ZCODE_OFFICIAL_ENDPOINT: "/forged" } });
      const lifecycle = { mode };
      const options = { signal: new AbortController().signal, onEvent: vi.fn() };

      assert(
        supportsBashBackgroundLifecycle(wrapped),
        "environment wrapper lost the Bash lifecycle",
      );
      const result = await wrapped.runBashWithBackgroundLifecycle(
        originalRequest,
        lifecycle,
        options,
      );

      expect(result).toBe(backgroundOutcome);
      expect(runBash).toHaveBeenCalledTimes(1);
      expect(runBash.mock.contexts[0]).toBe(port);
      const [forwardedRequest, forwardedLifecycle, forwardedOptions] = runBash.mock.calls[0]!;
      expect(forwardedRequest).toEqual({
        ...originalRequest,
        env: { set: { A: "1", ...endpointEnv } },
      });
      expect(forwardedLifecycle).toBe(lifecycle);
      expect(forwardedOptions).toBe(options);
      expect(originalRequest.env?.set?.ZCODE_OFFICIAL_ENDPOINT).toBe("/forged");
      expect(resolveEnv).toHaveBeenCalledTimes(1);
      expect(port.run).not.toHaveBeenCalled();
      expect(port.start).not.toHaveBeenCalled();
    },
  );

  it.each(lifecycleModes)(
    "preserves a clean environment for the %s Bash lifecycle",
    async (mode) => {
      const runBash = vi
        .fn<BashBackgroundLifecycleExecutionPort["runBashWithBackgroundLifecycle"]>()
        .mockResolvedValue(backgroundOutcome);
      const resolveEnv = vi.fn(async () => ({ ZCODE_OFFICIAL_ENDPOINT: "/session" }));
      const port = { ...fakePort(), runBashWithBackgroundLifecycle: runBash };
      const wrapped = withOfficialCommandEnv(port, resolveEnv);
      const originalRequest = request({ base: "empty" });

      assert(supportsBashBackgroundLifecycle(wrapped));
      await wrapped.runBashWithBackgroundLifecycle(originalRequest, { mode });

      expect(runBash.mock.calls[0]![0]).toBe(originalRequest);
      expect(resolveEnv).not.toHaveBeenCalled();
    },
  );

  it("preserves lifecycle errors when the endpoint env is unavailable", async () => {
    const failure = new Error("execution failed");
    const runBash = vi
      .fn<BashBackgroundLifecycleExecutionPort["runBashWithBackgroundLifecycle"]>()
      .mockRejectedValue(failure);
    const resolveEnv = vi.fn().mockRejectedValue(new Error("listen failed"));
    const warn = vi.fn();
    const port = { ...fakePort(), runBashWithBackgroundLifecycle: runBash };
    const wrapped = withOfficialCommandEnv(port, resolveEnv, { warn });
    const originalRequest = request();

    assert(supportsBashBackgroundLifecycle(wrapped));
    await expect(
      wrapped.runBashWithBackgroundLifecycle(originalRequest, { mode: "explicit" }),
    ).rejects.toBe(failure);

    expect(runBash.mock.calls[0]![0]).toBe(originalRequest);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("preserves the background task waiter so tracking does not fall back to polling", async () => {
    const snapshot = {
      taskId: "task-1",
      status: "completed" as const,
      startedAt: new Date(0),
    };
    const waitForBackgroundTask = vi
      .fn<BackgroundTaskWaiterExecutionPort["waitForBackgroundTask"]>()
      .mockResolvedValue(snapshot);
    const port = Object.freeze({ ...fakePort(), waitForBackgroundTask });
    const wrapped = withOfficialCommandEnv(port, async () => ({
      ZCODE_OFFICIAL_ENDPOINT: "/session",
    }));
    const options = { signal: new AbortController().signal };

    assert(supportsBackgroundTaskWaiter(wrapped), "environment wrapper lost the background waiter");
    const result = await wrapped.waitForBackgroundTask("task-1", options);

    expect(result).toBe(snapshot);
    expect(waitForBackgroundTask).toHaveBeenCalledTimes(1);
    expect(waitForBackgroundTask.mock.contexts[0]).toBe(port);
    expect(waitForBackgroundTask.mock.calls[0]).toEqual(["task-1", options]);
  });

  it("still runs the command when the endpoint is unavailable", async () => {
    const port = fakePort();
    const warn = vi.fn();
    const wrapped = withOfficialCommandEnv(
      port,
      async () => {
        throw new Error("listen failed");
      },
      { warn },
    );

    await wrapped.run(request());
    expect(port.run.mock.calls[0]![0].env).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe("createOfficialCommandAuthHeadersPort", () => {
  const ask = (workspace: { workspacePath: string; workspaceIdentity?: string } = WORKSPACE_A) => ({
    pluginId: "zcode-site",
    targetOrigin: "https://zcode.test",
    workspace,
  });

  it("asks for plugin-command identity with the session workspace and without an mcpKey", async () => {
    const requestClient = vi.fn(async () => ({ ok: true as const, headers: IDENTITY }));
    const port = createOfficialCommandAuthHeadersPort({
      resolveContext: () => ({ requestClient }) as never,
    });

    await expect(port.resolveHeaders(ask())).resolves.toEqual({ ok: true, headers: IDENTITY });
    await port.resolveHeaders(ask(WORKSPACE_B));
    const params = (requestClient.mock.calls as unknown as [string, Record<string, unknown>][]).map(
      ([, value]) => value,
    );
    expect(params[0]).toMatchObject({
      consumer: "plugin-command",
      pluginId: "zcode-site",
      targetOrigin: "https://zcode.test",
      workspace: { workspaceKey: "/w/a", workspacePath: "/w/a" },
    });
    expect(params[0]).not.toHaveProperty("mcpKey");
    expect(params[1]).toMatchObject({
      workspace: { workspaceIdentity: "remote:b", workspaceKey: "remote:b", workspacePath: "/w/b" },
    });
  });

  it("is unavailable before the protocol server is ready or when the host fails", async () => {
    const before = createOfficialCommandAuthHeadersPort({ resolveContext: () => undefined });
    await expect(before.resolveHeaders(ask())).resolves.toEqual({
      ok: false,
      reason: "official_auth_unavailable",
    });

    const warn = vi.fn();
    const failing = createOfficialCommandAuthHeadersPort({
      logger: { warn },
      resolveContext: () =>
        ({
          requestClient: vi
            .fn()
            .mockRejectedValue(new Error("Request workspace is not owned by this CLI")),
        }) as never,
    });
    await expect(failing.resolveHeaders(ask())).resolves.toEqual({
      ok: false,
      reason: "official_auth_unavailable",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        error: "Request workspace is not owned by this CLI",
        event: "zcode_protocol.official_command_endpoint.auth_request_failed",
        workspaceKey: "/w/a",
      }),
    );
  });
});
