import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { Emitter } from "@zcode/rpc";
import type { CredentialVaultSshCommandExecutor } from "@zcode/services/node";
import test from "node:test";
import { runCredentialedSshCommand } from "../src/remote/credentialSshCommand.js";

const input: Parameters<CredentialVaultSshCommandExecutor>[0] = {
  host: "192.0.2.10",
  port: 22,
  username: "root",
  password: "test-only-password",
  command: "whoami",
};

test("credentialed SSH runner forwards one command and bounds captured output", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const closed = new Emitter<number>();
  let receivedCommand = "";
  let receivedPassword = "";
  let disposed = false;
  const resultTask = runCredentialedSshCommand(input, {
    maxOutputBytes: 5,
    timeoutMs: 1_000,
    createBackend(credentials) {
      receivedPassword = credentials.password;
      return {
        async exec(command) {
          receivedCommand = command;
          return { stdin, stdout, stderr, onClose: closed.event };
        },
        dispose() {
          disposed = true;
        },
      };
    },
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  stdout.write("1234567");
  stderr.write("error details");
  stdout.end();
  stderr.end();
  closed.fire(7);

  const result = await resultTask;
  assert.equal(receivedCommand, "whoami");
  assert.equal(receivedPassword, "test-only-password");
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout, "12345");
  assert.equal(result.stderr, "error");
  assert.equal(result.outputTruncated, true);
  assert.equal(disposed, true);
  closed.dispose();
});
