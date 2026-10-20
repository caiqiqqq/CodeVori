import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createConnection, Server } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import type { BrowserControlPort, Logger } from "@zcode/contracts";
import { NODE_REPL_BROWSER_BROKER_SOCKET_ENV } from "@zcode/shared";
import {
  createNodeReplBrowserBroker,
  injectNodeReplBrowserBroker,
  type NodeReplBrowserBroker,
} from "../src/app/node-repl-browser-broker.js";

const posixOnly = { skip: process.platform === "win32" };
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
};
const browserControlPort: BrowserControlPort = {
  async list() {
    return [];
  },
  async execute() {
    return { ok: true, elapsedMs: 0 };
  },
};

async function fixture(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "znr-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function broker(t: TestContext, socketRootDirectories: string[]): NodeReplBrowserBroker {
  const result = createNodeReplBrowserBroker({ browserControlPort, logger, socketRootDirectories });
  t.after(() => result.close());
  return result;
}

async function request(endpoint: NodeReplBrowserBroker, fields: Record<string, unknown> = {}) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const client = createConnection(endpoint.socketPath);
    const timer = setTimeout(() => client.destroy(new Error("Broker request timed out")), 3000);
    let text = "";
    client.once("error", reject);
    client.once("close", () => clearTimeout(timer));
    client.once("connect", () => {
      client.end(
        `${JSON.stringify({
          id: randomUUID(),
          op: "list",
          token: endpoint.token,
          runtimeScope: "main",
          sessionId: "fixture-session",
          ...fields,
        })}\n`,
      );
    });
    client.on("data", (data) => {
      text += data.toString();
    });
    client.once("end", () => {
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
  });
}

test(
  "broker owns a private directory and exposes its endpoint only after ready",
  posixOnly,
  async (t) => {
    const root = await fixture(t);
    const sentinel = join(root, "keep.txt");
    await writeFile(sentinel, "keep");
    const endpoint = broker(t, [root]);
    assert.throws(() => endpoint.socketPath, /not ready/);
    await endpoint.ready;
    const directory = dirname(endpoint.socketPath);
    assert.equal(dirname(directory), root);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.ok(Buffer.byteLength(endpoint.socketPath) <= 103);
    const injected = injectNodeReplBrowserBroker(
      { node_repl: { type: "stdio", command: "node" } },
      endpoint,
    );
    assert.equal(
      injected.node_repl.type === "stdio" &&
        injected.node_repl.env?.[NODE_REPL_BROWSER_BROKER_SOCKET_ENV],
      endpoint.socketPath,
    );
    assert.equal((await request(endpoint)).ok, true);
    await endpoint.close();
    await assert.rejects(stat(directory), { code: "ENOENT" });
    assert.equal(await readFile(sentinel, "utf8"), "keep");
  },
);

test(
  "missing, non-directory and oversized temp roots fall back without recreating them",
  posixOnly,
  async (t) => {
    const root = await fixture(t);
    const missing = join(root, "external-process-gone");
    const file = join(root, "file");
    const oversized = join(root, "x".repeat(110));
    await writeFile(file, "keep");
    for (const first of [missing, file, oversized]) {
      const endpoint = broker(t, [first, root]);
      await endpoint.ready;
      assert.equal(dirname(dirname(endpoint.socketPath)), root);
      assert.equal((await request(endpoint)).ok, true);
      await endpoint.close();
    }
    await assert.rejects(stat(missing), { code: "ENOENT" });
    await assert.rejects(stat(oversized), { code: "ENOENT" });
    assert.equal(await readFile(file, "utf8"), "keep");
    assert.deepEqual(await readdir(root), ["file"]);
  },
);

test(
  "unwritable temp roots are not chmodded to make startup work",
  {
    skip: process.platform === "win32" || process.getuid?.() === 0,
  },
  async (t) => {
    const root = await fixture(t);
    const locked = await mkdtemp(join(root, "locked-"));
    await chmod(locked, 0o500);
    try {
      const endpoint = broker(t, [locked, root]);
      await endpoint.ready;
      assert.equal(dirname(dirname(endpoint.socketPath)), root);
      assert.equal((await stat(locked)).mode & 0o777, 0o500);
      await endpoint.close();
      assert.deepEqual(await readdir(locked), []);
    } finally {
      await chmod(locked, 0o700);
    }
  },
);

test("default roots recover from inherited missing TMPDIR, TMP and TEMP", posixOnly, async (t) => {
  const root = await fixture(t);
  const missing = join(root, "external-process-gone");
  const keys = ["TMPDIR", "TMP", "TEMP"];
  const previous = keys.map((key) => process.env[key]);
  let endpoint: NodeReplBrowserBroker | undefined;
  try {
    for (const key of keys) process.env[key] = missing;
    endpoint = createNodeReplBrowserBroker({ browserControlPort, logger });
    await endpoint.ready;
    assert.equal(dirname(dirname(endpoint.socketPath)), homedir());
    assert.equal((await request(endpoint)).ok, true);
    await assert.rejects(stat(missing), { code: "ENOENT" });
  } finally {
    await endpoint?.close();
    for (const [index, key] of keys.entries()) {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    }
  }
});

test(
  "binding permission failures clean up the first private directory before retry",
  posixOnly,
  async (t) => {
    const root = await fixture(t);
    const first = await mkdtemp(join(root, "first-"));
    const second = await mkdtemp(join(root, "second-"));
    const originalListen = Server.prototype.listen;
    t.mock.method(
      Server.prototype,
      "listen",
      function (this: Server, ...args: Parameters<Server["listen"]>) {
        if (String(args[0]).startsWith(first)) {
          throw Object.assign(new Error("fixture binding denied"), { code: "EACCES" });
        }
        return Reflect.apply(originalListen, this, args);
      },
    );
    const endpoint = broker(t, [first, second]);
    await endpoint.ready;
    assert.deepEqual(await readdir(first), []);
    assert.equal(dirname(dirname(endpoint.socketPath)), second);
    assert.equal((await request(endpoint)).ok, true);
    await endpoint.close();
  },
);

test(
  "concurrent brokers have separate endpoints and preserve token and subagent checks",
  posixOnly,
  async (t) => {
    const root = await fixture(t);
    const first = broker(t, [root]);
    const second = broker(t, [root]);
    await Promise.all([first.ready, second.ready]);
    assert.notEqual(dirname(first.socketPath), dirname(second.socketPath));
    assert.notEqual(first.token, second.token);
    assert.equal((await request(second, { token: first.token })).ok, false);
    assert.equal((await request(second, { runtimeScope: "subagent" })).ok, false);
    await first.close();
    assert.equal((await request(second)).ok, true);
    await second.close();
    assert.deepEqual(await readdir(root), []);
  },
);

test(
  "asynchronous listen errors recover once without stale event listeners",
  posixOnly,
  async (t) => {
    const root = await fixture(t);
    const first = await mkdtemp(join(root, "first-"));
    const originalListen = Server.prototype.listen;
    let denied = false;
    t.mock.method(
      Server.prototype,
      "listen",
      function (this: Server, ...args: Parameters<Server["listen"]>) {
        if (!denied) {
          denied = true;
          queueMicrotask(() =>
            this.emit(
              "error",
              Object.assign(new Error("fixture async denial"), { code: "EACCES" }),
            ),
          );
          return this;
        }
        return Reflect.apply(originalListen, this, args);
      },
    );
    const endpoint = broker(t, [first, root]);
    await endpoint.ready;
    assert.deepEqual(await readdir(first), []);
    assert.equal((await request(endpoint)).ok, true);
    await endpoint.close();
  },
);

test(
  "unrecoverable listen failures propagate and clean up without a fallback",
  posixOnly,
  async (t) => {
    const root = await fixture(t);
    const original = Object.assign(new Error("fixture unsupported socket"), { code: "EINVAL" });
    let calls = 0;
    t.mock.method(Server.prototype, "listen", function (this: Server) {
      calls += 1;
      queueMicrotask(() => this.emit("error", original));
      return this;
    });
    const endpoint = broker(t, [root, homedir()]);
    await assert.rejects(endpoint.ready, (error: unknown) => error === original);
    await endpoint.close();
    assert.equal(calls, 1);
    assert.deepEqual(await readdir(root), []);
  },
);

test("close during initialization and repeated close share one cleanup", posixOnly, async (t) => {
  const root = await fixture(t);
  const endpoint = broker(t, [root]);
  const closing = endpoint.close();
  assert.equal(endpoint.close(), closing);
  await closing;
  await endpoint.ready;
  await assert.rejects(stat(dirname(endpoint.socketPath)), { code: "ENOENT" });
  assert.deepEqual(await readdir(root), []);
});

test(
  "all unusable roots reject readiness with original causes and leave no resources",
  posixOnly,
  async (t) => {
    const root = await fixture(t);
    const endpoint = broker(t, [join(root, "missing-one"), join(root, "missing-two")]);
    await assert.rejects(endpoint.ready, (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.ok(error.errors.every((cause) => cause.code === "ENOENT"));
      return true;
    });
    await endpoint.close();
    assert.deepEqual(await readdir(root), []);
  },
);

test(
  "Windows uses named pipes without touching configured socket roots",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await fixture(t);
    const endpoint = broker(t, [join(root, "missing")]);
    await endpoint.ready;
    assert.match(endpoint.socketPath, /^\\\\\.\\pipe\\zcode-node-repl-/);
    assert.equal((await request(endpoint)).ok, true);
    await endpoint.close();
    assert.deepEqual(await readdir(root), []);
  },
);
