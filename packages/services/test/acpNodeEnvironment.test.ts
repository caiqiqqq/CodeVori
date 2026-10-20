import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAcpAgentManager } from "../src/acp/acpAgentManager.js";
import { createAcpReleaseRegistry } from "../src/acp/acpReleaseRegistry.js";

const range = ">=24.16.0 <25 || >=26.1.0";
const version = "2026.10.5";

test("目标 Host 投影精确发行包的 Node 要求，安装前重查环境且拒绝不兼容版本", async () => {
  if (process.platform === "win32") return; // POSIX fake commands; never installs a real package.
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-node-"));
  const bin = join(root, "bin");
  const marker = join(root, "npm-installed");
  const urls: string[] = [];
  const manager = createAcpAgentManager({
    directory: join(root, "agents"),
    env: { PATH: bin, ACP_INSTALL_MARKER: marker },
    fetchMetadata: async (url) => {
      urls.push(url);
      if (url.includes("agentclientprotocol.com")) return { agents: [] };
      const parts = new URL(url).pathname.slice(1).split("/");
      return {
        name: decodeURIComponent(parts[0]!),
        version: parts[1] === "latest" ? version : parts[1],
        engines: { node: range },
      };
    },
  });
  const setNode = (value: string) =>
    writeFile(join(bin, "node"), `#!/bin/sh\necho '${value}'\n`, { mode: 0o755 });
  const openclaw = async (checkUpdates = false) =>
    (await manager.listAgents({ checkUpdates })).find((item) => item.agent === "openclaw")!;
  const operate = (action: "install" | "upgrade" | "uninstall" = "install") =>
    manager.manageAgent({ agent: "openclaw", action, operationId: randomUUID() });
  try {
    await mkdir(bin);
    await writeFile(
      join(bin, "npm"),
      `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
if (process.argv.includes('--version')) { console.log('10.9.2'); process.exit(0); }
fs.writeFileSync(process.env.ACP_INSTALL_MARKER, process.argv.at(-1));
const dir = path.join(process.env.npm_config_prefix, 'lib/node_modules/openclaw');
fs.mkdirSync(dir, {recursive:true});
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name:'openclaw',version:'${version}',bin:{openclaw:'cli.js'}}));
fs.writeFileSync(path.join(dir, 'cli.js'), '// fake');
`,
      { mode: 0o755 },
    );
    await setNode("v22.17.0");
    const first = await openclaw(true);
    assert.equal(first.nodeVersionRange, range);
    assert.equal(first.nodeVersionCompatible, false);
    assert.equal(first.nodeVersion, "22.17.0");
    await assert.rejects(operate(), /Node\.js.*22\.17\.0.*24\.16\.0/);
    await assert.rejects(access(marker));
    await assert.rejects(access(join(root, "agents", "openclaw", "npm")));

    const calls = urls.length;
    for (const [value, compatible] of [
      ["24.14.0", false],
      ["24.16.0", true],
      ["24.19.0", true],
      ["25.1.0", false],
      ["26.1.0", true],
      ["24.16.0-rc.1", false],
    ] as const) {
      await setNode(`v${value}`);
      assert.equal((await openclaw()).nodeVersionCompatible, compatible, value);
    }
    assert.equal(urls.length, calls, "Local diagnostics must not query the network");
    await setNode("v24.19.0");
    assert.equal((await openclaw()).nodeVersionCompatible, true);
    await setNode("v22.17.0");
    await assert.rejects(operate(), /Node\.js.*22\.17\.0/);
    await setNode("v24.19.0");
    assert.equal((await operate()).managedVersion, version);
    assert.equal(await readFile(marker, "utf8"), `openclaw@${version}`);
    await setNode("v22.17.0");
    await assert.rejects(operate("upgrade"), /Node\.js.*22\.17\.0/);
    assert.equal((await openclaw()).managedVersion, version);
    assert.equal((await operate("uninstall")).managedVersion, null);
    await rm(join(bin, "node"));
    assert.equal((await openclaw()).nodeVersionCompatible, false);
    await assert.rejects(operate(), /Node\.js and npm are required/);
    await setNode("unrecognized");
    await assert.rejects(operate(), /Node\.js 当前版本 未知/);
    await setNode("v24.19.0");
    await rm(join(bin, "npm"));
    assert.equal((await openclaw()).npmVersion, null);
    await assert.rejects(operate(), /Node\.js and npm are required/);
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("未检查的安装目标查询精确版本；无 engines 不伪造要求，查询失败可重试且旧请求不覆盖新目标", async () => {
  let mode = "offline";
  let releaseOld: () => void = () => {};
  const oldPending = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const requested: string[] = [];
  const registry = createAcpReleaseRegistry(
    [
      {
        agent: "openclaw",
        kind: "npm",
        packageName: "openclaw",
        version: "1.0.0",
        args: ["acp"],
        platformSupported: true,
      },
    ],
    {
      fetchMetadata: async (url) => {
        requested.push(url);
        if (url.includes("agentclientprotocol.com")) return { agents: [] };
        if (mode === "offline") throw new Error("private error");
        if (url.endsWith("/1.0.0")) {
          await oldPending;
          return { name: "openclaw", version: "1.0.0", engines: { node: ">=20" } };
        }
        return { name: "openclaw", version: "2.0.0" };
      },
    },
  );
  const old = registry.target("openclaw");
  await assert.rejects(
    registry.resolveNpmTarget("openclaw", old),
    /无法检查目标版本的 Node.js 要求/,
  );
  mode = "online";
  const resolving = registry.resolveNpmTarget("openclaw", old);
  await registry.refresh();
  assert.equal(registry.target("openclaw").version, "2.0.0");
  assert.equal(registry.target("openclaw").nodeVersionRange, null);
  releaseOld();
  assert.equal((await resolving).nodeVersionRange, ">=20");
  assert.equal(registry.target("openclaw").version, "2.0.0");
  assert.ok(requested.includes("https://registry.npmjs.org/openclaw/1.0.0"));
});

test("ACP 目录版本使用同包精确 npm 元数据；错误需求不能替换已知版本和范围", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-node-metadata-"));
  let mode = "ok";
  const manager = createAcpAgentManager({
    directory: root,
    env: { PATH: "" },
    fetchMetadata: async (url) => {
      if (url.includes("agentclientprotocol.com"))
        return {
          agents: [
            {
              id: "codex-acp",
              version: "2.2.2",
              distribution: { npx: { package: "@agentclientprotocol/codex-acp@2.2.2" } },
            },
          ],
        };
      const [pkg, requested] = new URL(url).pathname.slice(1).split("/");
      if (mode === "offline") throw new Error("private response");
      return {
        name: mode === "wrong-package" ? "unexpected" : decodeURIComponent(pkg!),
        version: mode === "wrong-version" ? "99.0.0" : requested === "latest" ? "3.0.0" : requested,
        engines: { node: mode === "invalid" ? "not a range" : range },
      };
    },
  });
  try {
    const first = (await manager.listAgents({ checkUpdates: true }))[1]!;
    assert.equal(first.registryVersion, "2.2.2");
    assert.equal(first.nodeVersionRange, range);
    for (mode of ["invalid", "wrong-package", "wrong-version", "offline"]) {
      const result = (await manager.listAgents({ checkUpdates: true, force: true }))[1]!;
      assert.equal(result.registryVersion, "2.2.2");
      assert.equal(result.nodeVersionRange, range);
      assert.equal(result.updateCheck?.status, "error");
      assert.equal(JSON.stringify(result).includes("private response"), false);
    }
    assert.equal(
      (await manager.listAgents()).find((item) => item.agent === "cursor")?.nodeVersionRange,
      null,
    );
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
