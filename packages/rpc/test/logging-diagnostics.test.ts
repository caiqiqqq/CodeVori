import assert from "node:assert/strict";
import test from "node:test";
import { LoggingChannelServer, LoggingChannelClient } from "../src/logging-middleware.js";
import { Event } from "../src/foundation.js";
import type { IServerChannel, IChannelServer } from "../src/channels.js";

test("both RPC wrappers preserve results, cancellation arguments and original failures when logging throws", async () => {
  let exposed!: IServerChannel<string>;
  const server = new LoggingChannelServer(
    {
      registerChannel(_name: string, channel: IServerChannel<string>) {
        exposed = channel;
      },
      initialize() {},
    } as IChannelServer<string>,
    () => {
      throw new Error("logger failed");
    },
  );
  const value = {};
  const arg = { private: "secret" };
  let calls = 0;
  const failure = new Error("business failure");
  server.registerChannel("fixture", {
    call: async (_ctx, command, received) => {
      calls++;
      assert.equal(received, arg);
      if (command === "readFail") throw failure;
      return value as never;
    },
    listen: () => Event.None,
  });
  assert.equal(await exposed.call("context", "read", arg), value);
  await assert.rejects(exposed.call("context", "readFail", arg), (e) => e === failure);
  assert.equal(calls, 2);
  assert.doesNotThrow(() => exposed.listen("context", "changes"));
  const client = new LoggingChannelClient(
    {
      getChannel: () => ({
        call: async () => value,
        listen: () => Event.None,
      }),
    } as never,
    () => {
      throw new Error("logger failed");
    },
  );
  assert.equal(await client.getChannel("fixture").call("read"), value);
});
