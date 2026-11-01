import { createRequire } from "node:module";
import readline from "node:readline";
import { NativeEngine } from "./native-engine.mjs";
import { verifyNativeAsset } from "./native-assets.mjs";
import { dirname, join } from "node:path";

const [addonPath, mode] = process.argv.slice(2);
await verifyNativeAsset(addonPath);
const native = createRequire(import.meta.url)(addonPath);
const pump =
  process.platform === "darwin"
    ? createRequire(import.meta.url)(join(dirname(addonPath), "cocoa-runloop.node")).pump
    : null;
const engine = new NativeEngine({
  native,
  withRunLoop: async (run) => {
    const timer = pump ? setInterval(pump, 10) : null;
    try {
      return await run();
    } finally {
      if (timer) clearInterval(timer);
    }
  },
});
if (mode === "permissions") {
  process.stdout.write(`${JSON.stringify(engine.permissions())}\n`);
  await engine.close();
  process.exit(0);
}
if (mode !== "host") throw new Error("Unknown computer control helper mode.");
let session;
let stopping = false;
let tail = Promise.resolve();
async function receive(line) {
  const request = JSON.parse(line);
  let result;
  switch (request.method) {
    case "host.hello":
      result = { protocol: "codevori.cua/1" };
      break;
    case "session.begin":
      if (session) throw new Error("Computer control helper is already bound.");
      session = request.params.session;
      result = { ok: true };
      break;
    case "tool.call":
      if (!session || request.params.session !== session || stopping)
        throw new Error("Invalid native session.");
      result = await engine.callTool(request.params.name, request.params.args);
      break;
    case "session.end":
      stopping = true;
      await engine.close();
      result = { ok: true };
      break;
    default:
      throw new Error("Unknown native request.");
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
}
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  tail = tail
    .then(() => receive(line))
    .catch(() => {
      // 协议损坏后结束子进程，不能继续消费可能错位的输入或回传用户窗口内容到日志。
      stopping = true;
      process.exitCode = 1;
      lines.close();
      process.stdin.destroy();
    });
});
lines.once("close", () => {
  void tail.finally(async () => {
    await engine.close();
    process.exit(process.exitCode ?? 0);
  });
});

// 终止必须先取消原生按键 hold，让桌面锁在抬键完成后再交给其他连接。
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    stopping = true;
    void engine
      .close()
      .then(() => tail)
      .finally(() => process.exit(0));
  });
