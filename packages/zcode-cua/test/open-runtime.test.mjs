import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOpenComputerUseService } from "../open-runtime.mjs";
import { withDesktopControlLease } from "../open-control-lease.mjs";

function fixture(overrides = {}) {
  const calls = [];
  const host = { close: async () => calls.push("close"), terminate: () => calls.push("terminate") };
  const service = {
    stopped: false,
    start: async () => calls.push("start"),
    close: async () => host.close(),
    callTool: async (name, args) => {
      calls.push([name, args]);
      if (name === "stop_computer_control") service.stopped = true;
      return { content: [{ type: "text", text: name }] };
    },
  };
  const runtime = createOpenComputerUseService({
    platform: "darwin",
    macOsVersion: "14.0",
    createService: () => ({ host, service }),
    withLease: async (run) => run(),
    readRefreshMarker: async () => "generation-1",
    ...overrides,
  });
  return { runtime, calls, service };
}

test("initialization does not start native; the first tool starts exactly once", async () => {
  const { runtime, calls } = fixture();
  await runtime.start();
  assert.deepEqual(calls, []);
  await runtime.callTool("list_apps", {});
  await runtime.callTool("list_displays", {});
  assert.equal(calls.filter((call) => call === "start").length, 1);
  await runtime.close();
  assert.equal(calls.at(-1), "close");
  assert.equal((await runtime.callTool("list_apps", {})).isError, true);
});

test("unsupported platforms and old macOS fail before native startup", async () => {
  for (const options of [{ platform: "win32" }, { platform: "linux" }, { macOsVersion: "13.6" }]) {
    const { runtime, calls } = fixture(options);
    assert.equal((await runtime.callTool("list_apps", {})).isError, true);
    assert.deepEqual(calls, []);
    await runtime.close();
  }
});

test("invalid tools and physical pointer calls cannot start the executor", async () => {
  const { runtime, calls } = fixture();
  for (const name of ["unknown", "mouse_move", "left_mouse_down", "left_mouse_up"]) {
    assert.equal((await runtime.callTool(name, {})).isError, true);
  }
  assert.deepEqual(calls, []);
});

test("stop remains latched across permission refresh", async () => {
  let marker = "first";
  const { runtime, calls } = fixture({ readRefreshMarker: async () => marker });
  await runtime.callTool("stop_computer_control", {});
  marker = "second";
  const result = await runtime.callTool("list_apps", {});
  assert.equal(result.isError, true);
  assert.equal(calls.filter((call) => call === "start").length, 1);
  await runtime.close();
});

test("permission refresh closes stale native without recreating the MCP connection", async () => {
  let marker = "first";
  const { runtime, calls } = fixture({ readRefreshMarker: async () => marker });
  await runtime.callTool("list_apps", {});
  marker = "second";
  await runtime.callTool("list_displays", {});
  assert.deepEqual(
    calls.filter((call) => typeof call === "string"),
    ["start", "close", "start"],
  );
  await runtime.close();
});

test("startup failure closes the partially created executor and reports not_sent", async () => {
  let closed = 0;
  const { runtime } = fixture({
    createService: () => ({
      host: {},
      service: {
        start: async () => {
          throw Object.assign(new Error("missing native"), { code: "ENOENT" });
        },
        close: async () => {
          closed += 1;
        },
      },
    }),
  });
  const result = await runtime.callTool("list_apps", {});
  assert.equal(result.isError, true);
  assert.equal(closed, 1);
  assert.equal(result.structuredContent.request_delivery_state, "not_sent");
  await runtime.close();
});

test("cancelled queued work cannot start native", async () => {
  const { runtime, calls } = fixture();
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await runtime.callTool("list_apps", {}, { signal: controller.signal })).isError,
    true,
  );
  assert.deepEqual(calls, []);
  await runtime.close();
});

test("desktop control lease rejects concurrent clients and releases after failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-cua-lease-test-"));
  const lockPath = join(directory, "desktop");
  let entered;
  let finish;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const held = new Promise((resolve) => {
    finish = resolve;
  });
  try {
    const first = withDesktopControlLease(
      async () => {
        entered();
        await held;
      },
      { lockPath },
    );
    await ready;
    await assert.rejects(
      withDesktopControlLease(async () => {}, { lockPath }),
      { code: "computer_control_busy" },
    );
    finish();
    await first;
    await assert.rejects(
      withDesktopControlLease(
        async () => {
          throw new Error("native failed");
        },
        { lockPath },
      ),
      /native failed/,
    );
    assert.equal(await withDesktopControlLease(async () => "released", { lockPath }), "released");
  } finally {
    finish();
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancellation during startup fences the candidate and never dispatches input", async () => {
  let started;
  let finish;
  let fenced = false;
  let dispatched = false;
  let closed = false;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const { runtime } = fixture({
    createService: () => ({
      host: {
        fence: () => {
          fenced = true;
        },
      },
      service: {
        start: async () => {
          started();
          await gate;
        },
        callTool: async () => {
          dispatched = true;
        },
        close: async () => {
          closed = true;
        },
      },
    }),
  });
  const controller = new AbortController();
  const operation = runtime.callTool("list_apps", {}, { signal: controller.signal });
  await ready;
  controller.abort();
  assert.equal(fenced, true);
  finish();
  assert.equal((await operation).structuredContent.request_delivery_state, "not_sent");
  assert.equal(dispatched, false);
  assert.equal(closed, true);
  await runtime.close();
});

test("cancellation drains a sent action before closing and releasing the desktop lease", async () => {
  let started;
  let finish;
  let released = false;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const { runtime, service, calls } = fixture({
    withLease: async (run) => {
      try {
        return await run();
      } finally {
        released = true;
      }
    },
  });
  service.callTool = async () => {
    started();
    await gate;
    return { content: [] };
  };
  const controller = new AbortController();
  const operation = runtime.callTool("list_apps", {}, { signal: controller.signal });
  await ready;
  controller.abort();
  assert.equal(released, false);
  const closing = runtime.close();
  finish();
  const result = await operation;
  await closing;
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.request_delivery_state, "possibly_sent");
  assert.equal(released, true);
  assert.equal(calls.filter((call) => call === "close").length, 1);
  assert.equal((await runtime.callTool("list_apps")).isError, true);
});
