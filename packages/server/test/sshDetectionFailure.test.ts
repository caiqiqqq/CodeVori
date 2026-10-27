import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test, type TestContext } from "node:test";
import { Client, type ClientChannel } from "ssh2";
import { SSHBackend } from "../src/remote/ssh-backend.js";
import { connectRemote } from "../src/remote/connect.js";

function fixture(
  t: TestContext,
  run: (channel: EventEmitter, client: Client, index: number) => void,
  beforeOpen?: (client: Client) => void,
) {
  const channels: EventEmitter[] = [];
  const clients: Client[] = [];
  let ended = false;
  let closedChannels = 0;
  t.mock.method(Client.prototype, "connect", function (this: Client) {
    clients.push(this);
    queueMicrotask(() => this.emit("ready"));
    return this;
  });
  t.mock.method(Client.prototype, "end", function (this: Client) {
    ended = true;
    return this;
  });
  t.mock.method(
    Client.prototype,
    "exec",
    function (
      this: Client,
      _command: string,
      callback: (error: Error | undefined, channel: ClientChannel) => void,
    ) {
      const channel = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
        close() {
          closedChannels++;
        },
      });
      channels.push(channel);
      beforeOpen?.(this);
      callback(undefined, channel as unknown as ClientChannel);
      queueMicrotask(() => run(channel, this, channels.length - 1));
      return this;
    },
  );
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
  const backend = new SSHBackend({ host: "example.invalid", username: "fixture" });
  t.after(() => backend.dispose());
  return {
    backend,
    channels,
    client: () => clients[0]!,
    ended: () => ended,
    closedChannels: () => closedChannels,
  };
}

for (const stage of [0, 1]) {
  test(`SSH detect rejects missing exit status at uname stage ${stage} before deployment`, async (t) => {
    const f = fixture(t, (channel, _client, index) => {
      if (index < stage) {
        channel.emit("data", Buffer.from("Linux\n"));
        channel.emit("exit", 0);
        channel.emit("close", 0);
      } else channel.emit("close");
    });
    t.mock.method(f.backend, "upload", async () => assert.fail("must not deploy"));
    await assert.rejects(connectRemote(f.backend), { code: "ECONNRESET" });
    assert.equal(f.channels.length, stage + 1);
    assert.equal(f.ended(), true, "connect must release failed backend");
  });
}

test("SSH signal exit is not accepted even when close has no code", async (t) => {
  const f = fixture(t, (channel) => {
    channel.emit("exit", null, "TERM");
    channel.emit("close");
  });
  await assert.rejects(f.backend.detect(), /TERM/);
});

for (const event of ["end", "close", "error", "channel-error"] as const) {
  test(
    `SSH ${event} settles pending command without waiting for channel close`,
    { timeout: 2_000 },
    async (t) => {
      const error = Object.assign(new Error("fixture network interrupted"), { code: "ECONNRESET" });
      const f = fixture(t, (channel, client) => {
        if (event === "channel-error") channel.emit("error", error);
        else client.emit(event, ...(event === "error" ? [error] : []));
      });
      await assert.rejects(f.backend.detect(), (caught: Error & { code?: string }) => {
        if (event.includes("error")) assert.equal(caught, error);
        else assert.equal(caught.code, "ECONNRESET");
        return true;
      });
      for (const name of ["data", "exit", "close", "error"])
        assert.equal(f.channels[0]!.listenerCount(name), 0);
      for (const name of ["end", "close", "error"])
        assert.equal(f.client().listenerCount(name), 1, "only backend lifecycle listener remains");
    },
  );
}

test("SSH detection keeps stdout delivered after exit and cleans command listeners", async (t) => {
  const f = fixture(t, (channel, _client, index) => {
    channel.emit("exit", 0);
    channel.emit("data", Buffer.from(["Linux\n", "x86_64\n", "Linux\n"][index]!));
    channel.emit("close");
  });
  assert.deepEqual(await f.backend.detect(), { platform: "linux", arch: "x64" });
  assert.equal(f.channels.length, 3);
  for (const channel of f.channels) {
    assert.equal(channel.listenerCount("data"), 0);
    assert.equal(channel.listenerCount("exit"), 0);
  }
});

test("disconnect before exec callback rejects and releases the late channel", async (t) => {
  const f = fixture(
    t,
    () => {},
    (client) => client.emit("end"),
  );
  await assert.rejects(f.backend.detect(), { code: "ECONNRESET" });
  assert.equal(f.closedChannels(), 1);
  assert.equal(f.channels[0]!.listenerCount("data"), 0);
});

test("explicit command failure retains exit code and ordinary diagnostic output", async (t) => {
  const f = fixture(t, (channel) => {
    (channel as EventEmitter & { stderr: EventEmitter }).stderr.emit(
      "data",
      Buffer.from("uname unavailable"),
    );
    channel.emit("exit", 127);
    channel.emit("close");
  });
  await assert.rejects(f.backend.detect(), /code 127.*uname unavailable/);
});
