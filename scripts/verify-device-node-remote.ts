// Live HTTPS/WSS verification against an explicitly selected Linux server.
// Downloads a real installer, runs its native node in a temporary XDG configuration,
// then applies the downloaded update while preserving the pairing identity.
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { checkDeviceBridgeMcp } from "../packages/desktop/src/main/deviceBridgeMcpCheck.js";
import {
  createDeviceNodeConnections,
  requestDeviceNodeService,
} from "../packages/desktop/src/main/deviceNodeConnections.js";

const exec = promisify(execFile);
const option = (key: string) =>
  process.argv.find((v) => v.startsWith(`--${key}=`))?.slice(key.length + 3);
const host = option("host"),
  socket = option("socket"),
  serviceUrl = option("url"),
  oldBinary = option("old-binary");
assert.ok(host && /^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+$/.test(host), "Use --host=user@host");
assert.ok(
  socket && serviceUrl?.startsWith("https://") && oldBinary,
  "Use --socket, --url and --old-binary",
);
const sshArgs = ["-S", socket, "-o", "BatchMode=yes", host];
const remote = async (command: string) =>
  (await exec("ssh", [...sshArgs, command], { maxBuffer: 2_000_000 })).stdout.trim();
const local = await mkdtemp(join(tmpdir(), "codevori-node-remote-"));
await chmod(local, 0o700);
let remoteDir = "",
  old: ChildProcess | undefined,
  pairId: string | undefined;
let endpoint: { url: string; token: string } | undefined;
let records: unknown[] = [];
const manager = createDeviceNodeConnections({
  serviceUrl,
  name: "Temporary remote verification",
  readRecords: async () => records,
  writeRecords: async (value) => {
    records = value;
  },
  request: requestDeviceNodeService,
  checkMcp: (value) => checkDeviceBridgeMcp(value, serviceUrl),
  saveMcp: async (request) => {
    if (request.action === "upsert") {
      const c = request.config as { url: string; headers: { Authorization: string } };
      endpoint = { url: c.url, token: c.headers.Authorization.slice(7) };
    } else endpoint = undefined;
  },
});
async function waitFor(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(150);
  }
  throw new Error(`Timeout: ${label}`);
}
async function tool() {
  assert.ok(endpoint);
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${endpoint.token}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "proof",
      method: "tools/call",
      params: {
        name: "command_run",
        arguments: { command: "printf codevori-public-node-ok", cwd: "/tmp" },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.ok(!reply.error && !reply.result.isError);
  assert.ok(JSON.stringify(reply.result).includes("codevori-public-node-ok"));
}
try {
  await manager.execute({ action: "node-create", platform: "linux-x64" });
  const pending = (await manager.read())[0]!;
  pairId = pending.id;
  assert.ok(pending.installationUrl);
  const page = await fetch(pending.installationUrl);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes("下载并安装"));
  const download = await fetch(pending.installationUrl.replace("/v1/install/", "/v1/download/"));
  assert.equal(download.status, 200);
  const archive = join(local, "download.zip");
  await writeFile(archive, Buffer.from(await download.arrayBuffer()), { mode: 0o600 });
  await exec("unzip", ["-q", archive, "-d", local]);
  const binary = join(local, "CodeVoriNode"),
    bytes = await readFile(binary);
  const manifest = await (
    await fetch(new URL("/codevori-node/clients/latest.json", serviceUrl))
  ).json();
  const expected = manifest.files.find(
    (file: { platform: string }) => file.platform === "linux-x64",
  );
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sha256);
  const invite = JSON.parse(await readFile(join(local, "invitation.json"), "utf8"));
  const redeemed = await fetch(serviceUrl + "/v1/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invitation: invite.invitation,
      nonce: randomBytes(32).toString("base64url"),
    }),
  });
  assert.equal(redeemed.status, 200);
  const nodeConfig = { ...(await redeemed.json()), serviceUrl };
  const configPath = join(local, "connection.json");
  await writeFile(configPath, JSON.stringify(nodeConfig), { mode: 0o600 });
  remoteDir = await remote("mktemp -d /tmp/codevori-node-proof.XXXXXXXX");
  assert.match(remoteDir, /^\/tmp\/codevori-node-proof\.[A-Za-z0-9]+$/);
  const nodeDir = `${remoteDir}/CodeVoriNode`;
  await remote(`mkdir -m 700 '${nodeDir}' '${nodeDir}/updates'`);
  const upload = (source: string, target: string) =>
    exec("scp", ["-o", `ControlPath=${socket}`, "--", source, `${host}:${target}`]);
  await upload(resolve(oldBinary), `${nodeDir}/CodeVoriNode`);
  await upload(binary, `${nodeDir}/updates/node-update.exe`);
  await upload(configPath, `${nodeDir}/connection.json`);
  await remote(
    `chmod 700 '${nodeDir}/CodeVoriNode' '${nodeDir}/updates/node-update.exe'; chmod 600 '${nodeDir}/connection.json'`,
  );
  old = spawn(
    "ssh",
    [...sshArgs, `XDG_CONFIG_HOME='${remoteDir}' '${nodeDir}/CodeVoriNode' agent`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  old.stdout?.resume();
  old.stderr?.resume();
  await once(old, "spawn");
  await waitFor(async () => {
    await manager.refresh();
    return (await manager.read())[0]?.status === "ready";
  }, "public WSS/MCP registration");
  await tool();
  const before = await remote(`sha256sum '${nodeDir}/connection.json' | cut -d ' ' -f 1`);
  await remote(
    `XDG_CONFIG_HOME='${remoteDir}' '${nodeDir}/updates/node-update.exe' apply-update '${expected.sha256}'`,
  );
  await waitFor(async () => {
    const state = await remote(`python3 - '${nodeDir}' <<'PY'
import json,pathlib,sys,urllib.request
try:
 s=json.loads((pathlib.Path(sys.argv[1])/'runtime.json').read_text())
 print(urllib.request.urlopen(s['address']+'/'+s['token'],timeout=2).read().decode())
except Exception: print('not ready')
PY`);
    return state.includes(`版本 ${manifest.version}`) && state.includes("检查更新");
  }, "updated native client status");
  await waitFor(async () => {
    await manager.refresh();
    return (await manager.read())[0]?.status === "ready";
  }, "reconnection after binary update");
  await tool();
  assert.equal(
    await remote(`sha256sum '${nodeDir}/connection.json' | cut -d ' ' -f 1`),
    before,
    "update changed pairing identity",
  );
  assert.equal(
    await remote(`sha256sum '${nodeDir}/CodeVoriNode' | cut -d ' ' -f 1`),
    expected.sha256,
  );
  console.log(
    JSON.stringify({
      httpsDownload: true,
      installerSha256: true,
      publicWss: true,
      mainMcpCheck: true,
      actualCommand: true,
      updateVersion: manifest.version,
      actualBinaryReplacement: true,
      pairingPreserved: true,
      reconnectedCommand: true,
      mainUiClick: false,
    }),
  );
} finally {
  if (pairId) await manager.execute({ action: "node-remove", id: pairId }).catch(() => {});
  await manager.dispose();
  if (remoteDir) {
    await remote(`python3 - '${remoteDir}' <<'PY'
import json,pathlib,sys,time,urllib.request,shutil
d=pathlib.Path(sys.argv[1]); p=d/'CodeVoriNode/runtime.json'
try:
 s=json.loads(p.read_text()); urllib.request.urlopen(urllib.request.Request(s['address']+'/'+s['token']+'/stop',method='POST'),timeout=2).close()
except Exception: pass
for _ in range(40):
 if not p.exists(): break
 time.sleep(.1)
if not p.exists(): shutil.rmtree(d)
PY`).catch(() => {});
  }
  if (old && old.exitCode === null && old.signalCode === null) old.kill("SIGTERM");
  await rm(local, { recursive: true, force: true });
}
