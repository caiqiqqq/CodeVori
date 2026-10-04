import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProxyChannel } from "@zcode/rpc";
import { ZipFile } from "yazl";
import { createAcpAgentManager } from "../src/acp/acpAgentManager.js";
import { createAcpService } from "../src/acp/acpServiceImpl.js";
import type { IAcpService } from "../src/acp/acpService.js";

const registry = (version: string) => ({
  agents: [
    {
      id: "codex-acp",
      version,
      distribution: { npx: { package: `@agentclientprotocol/codex-acp@${version}` } },
    },
  ],
});
const npmMetadata = (url: string) => ({
  name: decodeURIComponent(new URL(url).pathname.slice(1).replace(/\/latest$/, "")),
  version: "3.0.0",
});

test("发行检查经 RPC 查询官方版本；Host 缓存隔离、在途合并和强制刷新，聊天及普通诊断不联网", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-updates-"));
  let version = "2.0.1";
  let clock = 1_800_000_000_000;
  let registryCalls = 0;
  const options = {
    env: { PATH: "" },
    now: () => clock,
    fetchMetadata: async (url: string) => {
      if (url.includes("agentclientprotocol.com")) {
        registryCalls++;
        return registry(version);
      }
      return npmMetadata(url);
    },
  };
  const manager = createAcpAgentManager({ ...options, directory: root });
  const other = createAcpAgentManager({ ...options, directory: join(root, "other") });
  const service = createAcpService({ directory: join(root, "sessions"), agentManager: manager });
  const channel = ProxyChannel.fromService(service);
  const client = ProxyChannel.toService<IAcpService>({
    call: (name, args) => channel.call(undefined, name, args),
    listen: (name, arg) => channel.listen(undefined, name, arg),
  });
  try {
    assert.equal((await client.listAgents())[1]?.updateCheck?.status, "unchecked");
    await client.listAvailableAgents();
    await assert.rejects(manager.resolveLaunch("codex"), /not installed/);
    assert.equal(registryCalls, 0);
    const [first, concurrent] = await Promise.all([
      client.listAgents({ checkUpdates: true }),
      client.listAgents({ checkUpdates: true, force: true }),
    ]);
    assert.equal(registryCalls, 1);
    assert.deepEqual(first, concurrent);
    assert.equal(first[1]?.registryVersion, "2.0.1");
    assert.equal(first[1]?.updateCheck?.source, "acp-registry");
    assert.equal(first[1]?.updateCheck?.status, "checked");
    assert.equal(first.find((item) => item.agent === "openclaw")?.registryVersion, "3.0.0");
    assert.equal(first.find((item) => item.agent === "openclaw")?.updateCheck?.source, "npm");
    assert.equal(first.find((item) => item.agent === "cursor")?.updateCheck?.status, "unavailable");
    version = "2.1.0";
    assert.equal((await client.listAgents({ checkUpdates: true }))[1]?.registryVersion, "2.0.1");
    assert.equal((await other.listAgents({ checkUpdates: true }))[1]?.registryVersion, "2.1.0");
    assert.equal((await client.listAgents())[1]?.registryVersion, "2.0.1");
    assert.equal(
      (await client.listAgents({ checkUpdates: true, force: true }))[1]?.registryVersion,
      "2.1.0",
    );
    version = "2.2.0";
    clock += 10 * 60 * 1000 + 1;
    assert.equal((await client.listAgents({ checkUpdates: true }))[1]?.registryVersion, "2.2.0");
    assert.equal(registryCalls, 4);
  } finally {
    service.disposeAll();
    manager.dispose();
    other.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("检查失败、坏版本和错包保留上次目标；npm 缺项不会伪造检查成功", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-update-errors-"));
  let mode = "ok";
  const manager = createAcpAgentManager({
    directory: root,
    env: { PATH: "" },
    fetchMetadata: async (url) => {
      if (!url.includes("agentclientprotocol.com")) {
        if (mode === "npm-error") throw new Error("private diagnostic must not escape");
        return npmMetadata(url);
      }
      if (mode === "offline") throw new Error("private diagnostic must not escape");
      if (mode === "invalid") return registry("latest");
      if (mode === "wrong-package") {
        const value = registry("2.0.1");
        value.agents[0]!.distribution.npx.package = "other-package@2.0.1";
        return value;
      }
      return registry("2.0.1");
    },
  });
  try {
    await manager.listAgents({ checkUpdates: true });
    for (mode of ["offline", "invalid", "wrong-package"]) {
      const result = (await manager.listAgents({ checkUpdates: true, force: true }))[1]!;
      assert.equal(result.registryVersion, "2.0.1");
      assert.equal(result.updateCheck?.status, "error");
      assert.equal(JSON.stringify(result).includes("private diagnostic"), false);
    }
    mode = "npm-error";
    const failedNpm = (await manager.listAgents({ checkUpdates: true, force: true })).find(
      (item) => item.agent === "openclaw",
    )!;
    assert.equal(failedNpm.registryVersion, "3.0.0");
    assert.equal(failedNpm.updateCheck?.status, "error");
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("二进制目标读取当前平台的精确归档；平台缺项不阻止系统版就绪", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-binary-updates-"));
  const key = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "aarch64" : "x86_64"}`;
  const manager = createAcpAgentManager({
    directory: root,
    env: { PATH: "" },
    fetchMetadata: async (url) =>
      url.includes("agentclientprotocol.com")
        ? {
            agents: [
              {
                id: "opencode",
                version: "1.18.33",
                distribution: {
                  binary: {
                    [key]: {
                      archive: "https://example.invalid/opencode-1.18.33.zip",
                      cmd: process.platform === "win32" ? "./opencode.exe" : "./opencode",
                      args: ["acp"],
                      sha256: "a".repeat(64),
                    },
                  },
                },
              },
              {
                id: "cursor",
                version: "2026.09.26",
                distribution: { binary: {} },
              },
            ],
          }
        : npmMetadata(url),
  });
  try {
    const result = await manager.listAgents({ checkUpdates: true });
    assert.equal(result.find((item) => item.agent === "opencode")?.registryVersion, "1.18.33");
    assert.equal(result.find((item) => item.agent === "opencode")?.platformSupported, true);
    assert.equal(result.find((item) => item.agent === "cursor")?.platformSupported, false);
    assert.equal(
      result.find((item) => item.agent === "cursor")?.updateCheck?.status,
      "unavailable",
    );
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("显示的新版就是 npm 精确安装目标；拒绝过期目标、禁止降级、失败和坏包保留原安装", async () => {
  if (process.platform === "win32") return; // POSIX fake npm avoids real installs.
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-update-install-"));
  const bin = join(root, "bin");
  const attempts = join(root, "attempts");
  const switches = join(root, "switches.json");
  let version = "2.0.1";
  const manager = createAcpAgentManager({
    directory: join(root, "agents"),
    env: { PATH: bin, ACP_FAKE_ATTEMPTS: attempts, ACP_FAKE_SWITCHES: switches },
    fetchMetadata: async (url) =>
      url.includes("agentclientprotocol.com") ? registry(version) : npmMetadata(url),
  });
  const operate = (expectedVersion: string) =>
    manager.manageAgent({
      agent: "codex",
      action: "upgrade",
      operationId: randomUUID(),
      expectedVersion,
    });
  try {
    await mkdir(bin);
    await symlink(process.execPath, join(bin, "node"));
    await writeFile(switches, "{}");
    await writeFile(join(bin, "codex-acp"), "#!/bin/sh\necho 'codex-acp 1.13.1'\n", {
      mode: 0o755,
    });
    await writeFile(
      join(bin, "npm"),
      `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
if (process.argv.includes('--version')) { console.log('10.33.2'); process.exit(0); }
const spec = process.argv.at(-1); fs.appendFileSync(process.env.ACP_FAKE_ATTEMPTS, spec + '\\n');
const mode = JSON.parse(fs.readFileSync(process.env.ACP_FAKE_SWITCHES, 'utf8'));
if (mode.fail) process.exit(7);
const version = mode.wrongVersion || spec.slice(spec.lastIndexOf('@') + 1);
const dir = path.join(process.env.npm_config_prefix, 'lib/node_modules/@agentclientprotocol/codex-acp');
fs.mkdirSync(path.join(dir,'bin'), {recursive:true});
fs.writeFileSync(path.join(dir,'package.json'), JSON.stringify({name:'@agentclientprotocol/codex-acp',version,bin:{'codex-acp':'bin/cli.js'}}));
fs.writeFileSync(path.join(dir,'bin/cli.js'), '// fake ACP');
`,
      { mode: 0o755 },
    );
    const checked = (await manager.listAgents({ checkUpdates: true }))[1]!;
    assert.equal(checked.installedVersion, "1.13.1");
    assert.equal(checked.registryVersion, "2.0.1");
    assert.equal((await operate("2.0.1")).managedVersion, "2.0.1");
    version = "2.1.0";
    await manager.listAgents({ checkUpdates: true, force: true });
    await assert.rejects(operate("2.0.1"), /发行目标已变化/);
    await writeFile(switches, JSON.stringify({ fail: true }));
    await assert.rejects(operate("2.1.0"), /npm exited/);
    assert.equal((await manager.listAgents())[1]?.managedVersion, "2.0.1");
    await writeFile(switches, JSON.stringify({ wrongVersion: "9.9.9" }));
    await assert.rejects(operate("2.1.0"), /different.*version/);
    assert.equal((await manager.listAgents())[1]?.managedVersion, "2.0.1");
    version = "1.10.0";
    await manager.listAgents({ checkUpdates: true, force: true });
    await assert.rejects(operate("1.10.0"), /降级/);
    assert.deepEqual((await readFile(attempts, "utf8")).trim().split("\n"), [
      "@agentclientprotocol/codex-acp@2.0.1",
      "@agentclientprotocol/codex-acp@2.1.0",
      "@agentclientprotocol/codex-acp@2.1.0",
    ]);
    assert.equal(
      (await manager.resolveLaunch("codex")).args[0]?.includes("codex-acp/bin/cli.js"),
      true,
    );
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("二进制安装绑定查询出的 URL 和版本，检查期间目标变化不改变在途安装", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-binary-admission-"));
  const entry = process.platform === "win32" ? "opencode.exe" : "opencode";
  const key = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "aarch64" : "x86_64"}`;
  let version = "1.18.33";
  let downloadStarted!: () => void;
  let finishDownload!: () => void;
  const started = new Promise<void>((resolve) => {
    downloadStarted = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    finishDownload = resolve;
  });
  const seen: string[] = [];
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from("#!/bin/sh\nexit 0\n"), entry);
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  const payload = Buffer.concat(chunks);
  t.mock.method(globalThis, "fetch", async (url: string) => {
    seen.push(url);
    downloadStarted();
    await ready;
    return new Response(payload);
  });
  const manager = createAcpAgentManager({
    directory: root,
    env: { PATH: "" },
    fetchMetadata: async (url) =>
      url.includes("agentclientprotocol.com")
        ? {
            agents: [
              {
                id: "opencode",
                version,
                distribution: {
                  binary: {
                    [key]: {
                      archive: `https://example.invalid/opencode-${version}.zip`,
                      cmd: `./${entry}`,
                      args: ["acp"],
                    },
                  },
                },
              },
            ],
          }
        : npmMetadata(url),
  });
  let install: ReturnType<typeof manager.manageAgent> | undefined;
  try {
    await manager.listAgents({ checkUpdates: true });
    install = manager.manageAgent({
      agent: "opencode",
      action: "install",
      expectedVersion: version,
      operationId: randomUUID(),
    });
    await started;
    version = "1.18.34";
    await manager.listAgents({ checkUpdates: true, force: true });
    finishDownload();
    const result = await install;
    assert.equal(result.installedVersion, "1.18.33");
    assert.equal(result.registryVersion, "1.18.34");
    assert.deepEqual(seen, ["https://example.invalid/opencode-1.18.33.zip"]);
    assert.equal(
      (await manager.resolveLaunch("opencode")).command,
      join(root, "opencode", "binary", entry),
    );
  } finally {
    finishDownload();
    await install?.catch(() => {});
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
