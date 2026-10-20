import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProxyChannel } from "@zcode/rpc";
import { acpAgentManagementSnapshotSchema } from "@zcode/shared";
import { AcpAgentOperations } from "../src/acp/acpAgentOperations.js";
import { createAcpAgentManager } from "../src/acp/acpAgentManager.js";
import { createAcpService } from "../src/acp/acpServiceImpl.js";
import { runAcpInstallProcess } from "../src/acp/acpInstallProcess.js";
import type { IAcpService } from "../src/acp/acpService.js";
import {
  buildAcpInstallNetworkEnv,
  mergeAcpInstallNetworkEnv,
} from "../src/acp/acpInstallNetworkEnv.js";

test("Host 快照单一所有者、日志环有界、旧取消拒绝、清理失败保留 admission", () => {
  const owner = new AcpAgentOperations();
  const operationId = randomUUID();
  const signal = owner.begin({ operationId, agent: "hermes", action: "install" });
  for (let index = 0; index < 150; index++) owner.emit("log", `${index}: ${"x".repeat(3000)}`);
  const snapshot = acpAgentManagementSnapshotSchema.parse(owner.read());
  assert.equal(snapshot.operation?.log.length, 100);
  snapshot.operation!.log.length = 0;
  assert.equal(owner.read().operation?.log.length, 100);
  assert.throws(() => owner.cancel({ operationId: randomUUID() }), /过期/);
  assert.throws(() => owner.cancel({ operationId }), /不支持/);
  owner.setCancellable(true);
  owner.cancel({ operationId });
  owner.cancel({ operationId });
  assert.equal(signal.aborted, true);
  assert.equal(owner.read().operation?.status, "cancelling");
  assert.throws(
    () => owner.begin({ operationId: randomUUID(), agent: "gemini", action: "install" }),
    /already running/,
  );
  owner.finish(true, true);
  assert.equal(owner.read().operation?.busy, true);
  assert.throws(
    () => owner.begin({ operationId: randomUUID(), agent: "gemini", action: "install" }),
    /already running/,
  );
  owner.dispose();
});

test("网络设置清除继承的大小写代理/证书，无 CA 时保留运行时系统根证书", () => {
  const explicit = mergeAcpInstallNetworkEnv(
    {
      HTTPS_PROXY: "old",
      https_proxy: "old",
      NPM_CONFIG_PROXY: "old",
      SSL_CERT_FILE: "old",
      KEEP: "yes",
    },
    buildAcpInstallNetworkEnv({}),
  );
  assert.equal(explicit.HTTPS_PROXY, "");
  assert.equal(explicit.https_proxy, "");
  assert.equal(explicit.NPM_CONFIG_PROXY, undefined);
  assert.equal(explicit.SSL_CERT_FILE, undefined);
  assert.equal(explicit.KEEP, "yes");
  const ca = buildAcpInstallNetworkEnv({
    httpProxy: "localhost:9999",
    noProxy: "localhost",
    caCertPath: "/fake/cert.pem",
  });
  assert.equal(ca.https_proxy, "http://localhost:9999");
  assert.equal(ca.npm_config_cafile, "/fake/cert.pem");
  assert.equal(ca.SSL_CERT_FILE, "/fake/cert.pem");
});

test("Node 原生 postinstall fetch 通过显式安装代理，而非只让 npm 本身走代理", async () => {
  let requested = "";
  const body = "postinstall-fetch-proxied";
  const proxy = createServer((request, response) => {
    requested = request.url ?? "";
    response.end(body);
  });
  proxy.on("connect", (request, socket) => {
    requested = request.url ?? "";
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () =>
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
      ),
    );
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const log: string[] = [];
  try {
    const address = proxy.address() as { port: number };
    await runAcpInstallProcess({
      command: process.execPath,
      args: [
        "-e",
        "fetch('http://unreachable.invalid/example').then(r=>r.text()).then(console.log).catch(()=>process.exit(1))",
      ],
      env: buildAcpInstallNetworkEnv({ httpProxy: `http://127.0.0.1:${address.port}` }),
      signal: new AbortController().signal,
      timeoutMs: 3000,
      onLog: (message) => log.push(message),
    });
    assert.ok(["http://unreachable.invalid/example", "unreachable.invalid:80"].includes(requested));
    assert.match(log.join("\n"), /postinstall-fetch-proxied/);
  } finally {
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

test(
  "真实假 npm 经 RPC 恢复快照/取消；每次读取最新代理且旧包保留",
  { timeout: 15000 },
  async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "zcode-acp-operations-"));
    const bin = join(root, "bin");
    const mode = join(root, "mode");
    const record = join(root, "record");
    let proxy = "http://127.0.0.1:9991";
    const manager = createAcpAgentManager({
      directory: join(root, "agents"),
      env: { PATH: bin, TEST_MODE: mode, TEST_RECORD: record },
      fetchMetadata: async () => ({ name: "@google/gemini-cli", version: "0.59.0" }),
      resolveInstallEnv: async () => buildAcpInstallNetworkEnv({ httpProxy: proxy }),
    });
    const service = createAcpService({ directory: join(root, "sessions"), agentManager: manager });
    const channel = ProxyChannel.fromService(service);
    const client = ProxyChannel.toService<IAcpService>({
      call: (name, args) => channel.call(undefined, name, args),
      listen: (name, args) => channel.listen(undefined, name, args),
    });
    try {
      await mkdir(bin);
      await symlink(process.execPath, join(bin, "node"));
      await writeFile(mode, "success");
      await writeFile(
        join(bin, "npm"),
        `#!${process.execPath}
const fs=require('node:fs'), path=require('node:path');
if(process.argv.includes('--version')) { console.log('11.0.0'); process.exit(0); }
fs.writeFileSync(process.env.TEST_RECORD, JSON.stringify({proxy:process.env.https_proxy,args:process.argv}));
if(fs.readFileSync(process.env.TEST_MODE,'utf8')==='hang') { console.log('waiting for Python'); setInterval(()=>{},1000); }
else { const dir=path.join(process.env.npm_config_prefix,'lib/node_modules/@google/gemini-cli'); fs.mkdirSync(path.join(dir,'bin'),{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'@google/gemini-cli',version:'0.59.0',bin:{gemini:'bin/gemini.js'}}));fs.writeFileSync(path.join(dir,'bin/gemini.js'),'// previous package'); }
`,
        { mode: 0o755 },
      );
      await client.manageAgent({ agent: "gemini", action: "install", operationId: randomUUID() });
      assert.equal(JSON.parse(await readFile(record, "utf8")).proxy, proxy);
      proxy = "http://127.0.0.1:9992";
      await writeFile(mode, "hang");
      let ready!: () => void;
      const started = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const subscription = client.onDynamicAgentManagement()((snapshot) => {
        if (snapshot.operation?.log.some((line) => line.includes("waiting for Python"))) ready();
      });
      const operationId = randomUUID();
      const install = client.manageAgent({ agent: "gemini", action: "upgrade", operationId });
      const rejected = assert.rejects(install, /取消/);
      await started;
      const snapshot = await client.readAgentManagement();
      assert.equal(snapshot.operation?.operationId, operationId);
      assert.equal(snapshot.operation?.busy, true);
      assert.equal(snapshot.operation?.cancellable, true);
      await assert.rejects(client.cancelAgentOperation({ operationId: randomUUID() }), /过期/);
      await assert.rejects(
        client.manageAgent({ agent: "gemini", action: "install", operationId: randomUUID() }),
        /already running/,
      );
      await client.cancelAgentOperation({ operationId });
      await rejected;
      assert.equal((await client.readAgentManagement()).operation?.busy, false);
      assert.equal((await client.readAgentManagement()).operation?.status, "failed");
      assert.equal(JSON.parse(await readFile(record, "utf8")).proxy, proxy);
      assert.ok(JSON.parse(await readFile(record, "utf8")).args.includes("--foreground-scripts"));
      assert.equal(
        await readFile(
          join(root, "agents/gemini/npm/lib/node_modules/@google/gemini-cli/bin/gemini.js"),
          "utf8",
        ),
        "// previous package",
      );
      subscription.dispose();
    } finally {
      service.disposeAll();
      manager.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);
