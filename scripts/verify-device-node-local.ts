// Actual Main connection owner + downloaded native client + independent pairing process.
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { checkDeviceBridgeMcp } from "../packages/desktop/src/main/deviceBridgeMcpCheck.js";
import {
  createDeviceNodeConnections,
  requestDeviceNodeService,
} from "../packages/desktop/src/main/deviceNodeConnections.js";
import { prepareLocalDeviceNode, startLocalPairing } from "./dev-device-node.mjs";

const exec = promisify(execFile);
assert.ok(
  ["darwin", "linux"].includes(process.platform),
  "Local verifier extracts ZIP on macOS/Linux",
);
// Fail before starting anything if the service port belongs to another process.
const probe = createServer();
probe.listen(18081, "127.0.0.1");
await once(probe, "listening");
await new Promise<void>((resolve) => probe.close(() => resolve()));
const config = await prepareLocalDeviceNode({ build: false });
await mkdir(join(config.directory, "proof"), { recursive: true, mode: 0o700 });
const proof = await mkdtemp(join(config.directory, "proof/run-"));
await chmod(proof, 0o700);
const stateDir = join(proof, "pairing"),
  agentDir = join(proof, "node");
await mkdir(agentDir, { mode: 0o700 });
const controllerFile = join(proof, "controller.json"),
  mcpFile = join(proof, "mcp.json");
let service: ChildProcess | undefined, agent: ChildProcess | undefined;
let endpoint: { url: string; token: string } | undefined;
const publications: unknown[] = [];
const manager = createDeviceNodeConnections({
  serviceUrl: config.serviceUrl,
  name: "Local verification",
  readRecords: async () => {
    try {
      return JSON.parse(await readFile(controllerFile, "utf8"));
    } catch {
      return [];
    }
  },
  writeRecords: async (records) => {
    await writeFile(controllerFile, JSON.stringify(records), { mode: 0o600 });
  },
  request: requestDeviceNodeService,
  checkMcp: (value) => checkDeviceBridgeMcp(value, config.serviceUrl),
  saveMcp: async (request) => {
    publications.push(request);
    if (request.action === "upsert") {
      const c = request.config as { url: string; headers: { Authorization: string } };
      endpoint = { url: c.url, token: c.headers.Authorization.slice(7) };
    } else endpoint = undefined;
    await writeFile(mcpFile, JSON.stringify(request), { mode: 0o600 });
  },
});
async function waitFor(check: () => Promise<boolean>, label: string, timeout = 20_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return;
    await delay(100);
  }
  throw new Error(`Timeout: ${label}`);
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 6_000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}
async function startService() {
  service = startLocalPairing(config, stateDir);
  service.stderr?.resume();
  await once(service, "spawn");
  await waitFor(
    async () => service?.exitCode === null && (await fetch(config.serviceUrl + "/healthz")).ok,
    "service health",
  );
}
async function ready() {
  await manager.refresh();
  return (await manager.read())[0]?.status === "ready";
}
async function tool(name: string, args = {}) {
  assert.ok(endpoint, "Main has not published MCP");
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomBytes(8).toString("hex"),
      method: "tools/call",
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return { status: response.status };
  }
  return { status: response.status, ...(await response.json()) };
}
const decode = (reply: any) => {
  assert.equal(reply.status, 200);
  assert.equal(reply.result.isError, undefined);
  return JSON.parse(reply.result.content[0].text);
};
try {
  await startService();
  const platform =
    `${process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}` as "darwin-arm64";
  await manager.execute({ action: "node-create", platform });
  const pending = (await manager.read())[0]!;
  assert.equal(pending.status, "waiting");
  assert.ok(pending.installationUrl);
  assert.equal((await fetch(pending.installationUrl)).status, 200);
  const download = await fetch(pending.installationUrl.replace("/v1/install/", "/v1/download/"));
  assert.equal(download.status, 200);
  const zip = join(proof, "download.zip");
  await writeFile(zip, Buffer.from(await download.arrayBuffer()), { mode: 0o600 });
  const extracted = join(proof, "download");
  await exec("unzip", ["-q", zip, "-d", extracted]);
  const mac = process.platform === "darwin";
  const binary = mac
    ? join(extracted, "CodeVori Node.app/Contents/MacOS/CodeVoriNode")
    : join(extracted, "CodeVoriNode");
  const inviteFile = mac
    ? join(extracted, "CodeVori Node.app/Contents/Resources/invitation.json")
    : join(extracted, "invitation.json");
  const invitation = JSON.parse(await readFile(inviteFile, "utf8"));
  assert.equal(invitation.serviceUrl, config.serviceUrl);
  const redeem = await fetch(config.serviceUrl + "/v1/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invitation: invitation.invitation,
      nonce: randomBytes(32).toString("base64url"),
    }),
  });
  assert.equal(redeem.status, 200);
  await writeFile(join(agentDir, "connection.json"), JSON.stringify(await redeem.json()), {
    mode: 0o600,
  });
  const startAgent = () => {
    agent = spawn(binary, ["agent", "--state-dir", agentDir], { stdio: "ignore" });
  };
  startAgent();
  await waitFor(ready, "Main automatic MCP readiness");
  const firstCount = publications.filter((p: any) => p.action === "upsert").length;
  const info = decode(await tool("node_info"));
  assert.equal(info.platform, process.platform);
  assert.equal(info.architecture, process.arch === "arm64" ? "arm64" : "amd64");
  const command = decode(
    await tool("command_run", {
      cwd: proof,
      command: "printf 'once\\n' >> marker.txt; printf 'local-command-ok'",
      timeoutSeconds: 5,
    }),
  );
  assert.equal(command.exitCode, 0);
  assert.equal(command.stdout, "local-command-ok");
  assert.equal(await readFile(join(proof, "marker.txt"), "utf8"), "once\n");
  // 等待一次服务端心跳，实际验证连接不受握手 context 取消影响。
  await delay(21_000);
  decode(await tool("node_info"));
  const runtime = JSON.parse(await readFile(join(agentDir, "runtime.json"), "utf8"));
  assert.equal(
    (await fetch(`${runtime.address}/${runtime.token}/uninstall`, { method: "POST" })).status,
    404,
  );
  await stop(agent);
  await manager.refresh();
  assert.equal((await manager.read())[0]?.status, "offline");
  assert.equal(endpoint, undefined);
  startAgent();
  await waitFor(ready, "client restart and fresh MCP check");
  assert.ok(publications.filter((p: any) => p.action === "upsert").length > firstCount);
  const interrupted = tool("command_run", {
    cwd: proof,
    command: "sleep 3; printf 'unexpected' > replay.txt",
    timeoutSeconds: 10,
  });
  await waitFor(
    async () => decode(await tool("node_info")).activeCommands === 1,
    "in-flight command",
  );
  await stop(service);
  assert.equal((await interrupted).status, 502);
  await startService();
  await waitFor(ready, "service restart and node reconnect");
  await delay(3_500);
  await assert.rejects(readFile(join(proof, "replay.txt")), { code: "ENOENT" });
  assert.equal(await readFile(join(proof, "marker.txt"), "utf8"), "once\n");
  const available = endpoint!;
  await manager.execute({ action: "node-enable", id: pending.id, enabled: false });
  await manager.refresh();
  assert.equal((await manager.read())[0]?.status, "disabled");
  const disabled = await fetch(available.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${available.token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(disabled.status, 403);
  await disabled.body?.cancel();
  await manager.execute({ action: "node-enable", id: pending.id, enabled: true });
  await waitFor(ready, "reenable");
  await manager.execute({ action: "node-remove", id: pending.id });
  assert.deepEqual(await manager.read(), []);
  const report = {
    verifiedAt: new Date().toISOString(),
    platform,
    toolCount: pending.toolCount ?? info.desktopTools.length + 2,
    checks: [
      "actual installer download",
      "real client process",
      "Main MCP handshake/publication",
      "native node_info",
      "shell output and marker",
      "heartbeat",
      "client restart",
      "service restart",
      "in-flight cancellation",
      "no replay",
      "disable/enable/revoke",
    ],
    excluded: [
      "native installer consent/autostart",
      "Windows/Linux real machine",
      "desktop OS permissions/actions",
    ],
    proof,
  };
  await writeFile(join(proof, "result.json"), JSON.stringify(report, null, 2));
  process.stdout.write(
    `PASS: real local execution chain; ${report.checks.join(", ")}\nEvidence: ${join(proof, "result.json")}\n`,
  );
} finally {
  await manager.dispose();
  await stop(agent);
  await stop(service);
}
