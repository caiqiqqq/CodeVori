import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { Emitter } from "@zcode/rpc";
import { connectRemote } from "../src/remote/connect.js";
import type { IRemoteBackend } from "../src/remote/backend.js";
import { createRemoteDiagnosticLines, forwardRemoteStderr } from "../src/remote/diagnosticLog.js";
import { performHandshake } from "../src/remote/handshake.js";

test("remote stderr and failed handshake diagnostics redact fragmented synthetic credentials", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const closed = new Emitter<number>();
  const logs: unknown[][] = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args);
  };
  const backend: IRemoteBackend = {
    detect: async () => ({ platform: "linux", arch: "x64" }),
    exec: async () => {
      setImmediate(() => {
        stderr.write("startup failure Authorization: Bear");
        stderr.write("er fixture-bearer-secret api_key=fixture-");
        stderr.write(
          "api-secret https://fixture-user:fixture-password@example.com/start?token=fixture-query-secret\n",
        );
        stdout.write("fatal token=fixture-stdout-secret\n");
        closed.fire(17);
      });
      return { stdin, stdout, stderr, onClose: closed.event };
    },
    dispose() {
      stdin.destroy();
      stdout.destroy();
      stderr.destroy();
      closed.dispose();
    },
    upload: async () => {},
    exists: async () => false,
    readFile: async () => "",
  };
  try {
    await assert.rejects(connectRemote(backend, { skipDeploy: true }), (error: Error) => {
      const display = JSON.stringify(logs) + error.message;
      for (const secret of [
        "fixture-bearer-secret",
        "fixture-api-secret",
        "fixture-password",
        "fixture-query-secret",
        "fixture-stdout-secret",
      ]) {
        assert.equal(
          display.includes(secret),
          false,
          "synthetic secret leaked from connection diagnostics",
        );
      }
      assert.match(error.message, /exit code 17/);
      assert.match(error.message, /startup failure/);
      return true;
    });
  } finally {
    console.log = originalLog;
    backend.dispose();
  }
});

test("remote diagnostic lines preserve split UTF-8, bound long lines and flush only once", () => {
  const result: string[] = [];
  const lines = createRemoteDiagnosticLines((line) => result.push(line));
  const utf8 = Buffer.from("启动失败\n");
  lines.push(utf8.subarray(0, 2));
  lines.push(utf8.subarray(2));
  lines.push("x".repeat(40_000));
  lines.push("secret-tail\nordinary tail");
  lines.finish();
  lines.finish();
  lines.push("late\n");
  assert.deepEqual(result, ["启动失败", "[remote log line omitted: too long]", "ordinary tail"]);
});

test("remote stderr forwarding removes listeners and flushes a redacted final line on dispose", () => {
  const stream = new PassThrough();
  const result: string[] = [];
  const stop = forwardRemoteStderr(stream, (line) => result.push(line));
  stream.write("reason token=fixture-final-secret");
  stop();
  stop();
  stream.write("late\n");
  assert.equal(result.length, 1);
  assert.match(result[0]!, /reason/);
  assert.equal(result[0]!.includes("fixture-final-secret"), false);
  assert.equal(stream.listenerCount("data"), 0);
  stream.destroy();
});

test("diagnostic redaction leaves successful hello and acknowledgement unchanged", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const closed = new Emitter<number>();
  const hello = {
    type: "zcode-hello",
    version: "fixture",
    platform: "linux",
    arch: "x64",
    pid: 123,
  };
  let ack = "";
  stdin.on("data", (chunk) => {
    ack += chunk.toString();
  });
  const handshake = performHandshake(
    { stdin, stdout, stderr, onClose: closed.event },
    "fixture-client",
  );
  stdout.write(`${JSON.stringify(hello)}\n`);
  const result = await handshake;
  assert.deepEqual(result.hello, hello);
  assert.equal(JSON.parse(ack).clientId, "fixture-client");
  assert.equal(stderr.listenerCount("data"), 0);
  stdin.destroy();
  stdout.destroy();
  stderr.destroy();
  closed.dispose();
});

test("network failure during detection retains its original cause and never starts deployment", async () => {
  const failure = new Error("fixture connection interrupted");
  let disposed = false;
  const originalLog = console.log;
  console.log = () => {};
  try {
    await assert.rejects(
      connectRemote({
        detect: async () => {
          throw failure;
        },
        exec: async () => {
          throw new Error("must not launch after detection failure");
        },
        upload: async () => {
          throw new Error("must not deploy after detection failure");
        },
        exists: async () => false,
        readFile: async () => "",
        dispose() {
          disposed = true;
        },
      }),
      (error) => error === failure,
    );
    assert.equal(disposed, true);
  } finally {
    console.log = originalLog;
  }
});
