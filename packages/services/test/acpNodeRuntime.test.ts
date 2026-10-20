import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { c as createTar } from "tar";
import { createAcpAgentManager } from "../src/acp/acpAgentManager.js";
import { nodeArchive, selectNodeRelease } from "../src/acp/acpNodeRuntime.js";

test("Node 国内镜像只选满足目标要求且包含平台归档的稳定 LTS", () => {
  const releases = [
    { version: "v24.19.0", lts: "Krypton", files: ["osx-arm64-tar"] },
    { version: "v24.16.0", lts: "Krypton", files: ["osx-arm64-tar"] },
    { version: "v26.1.0", lts: false, files: ["osx-arm64-tar"] },
    { version: "v24.20.0-rc.1", lts: "Krypton", files: ["osx-arm64-tar"] },
    { version: "v24.21.0", lts: "Krypton", files: ["linux-x64"] },
  ];
  assert.equal(selectNodeRelease(releases, ">=24.16 <25 || >=26.1", "darwin", "arm64"), "24.19.0");
  assert.throws(() => selectNodeRelease(releases, ">=28", "darwin", "arm64"), /LTS/);
  assert.throws(() => nodeArchive("24.19.0", "freebsd", "x64"), /平台/);
  assert.throws(() => nodeArchive("../../evil", "linux", "x64"));
  for (const platform of ["darwin", "linux", "win32"]) {
    for (const arch of ["arm64", "x64"]) {
      const archive = nodeArchive("24.19.0", platform, arch);
      assert.ok(archive.file.startsWith("node-v24.19.0-"));
      assert.ok(archive.entry.endsWith(platform === "win32" ? "node.exe" : "bin/node"));
      assert.ok(archive.npm.endsWith("npm/bin/npm-cli.js"));
    }
  }
});

test("一键安装通过同一 Host 管理运行环境，失败保留旧指针，诊断/安装/启动立即使用托管 Node", async () => {
  if (process.platform === "win32") return; // POSIX fake node; platform paths are covered above.
  const root = await mkdtemp(join(tmpdir(), "zcode-node-runtime-"));
  const directory = join(root, "agents");
  const content = join(root, "content");
  const systemBin = join(root, "system");
  let releaseVersion = "24.19.0";
  let archive = nodeArchive(releaseVersion);
  const archivePath = join(root, "node.tar.gz");
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let badChecksum = false;
  let wrongVersion = false;
  let rejectDownload = false;
  let releaseDownload: (() => void) | undefined;
  let pendingDownload: Promise<void> | undefined;
  const events: string[] = [];
  const baseEnv = {
    PATH: systemBin,
    NPM_CONFIG_REGISTRY: "https://private.invalid",
    npm_config_registry: "https://old.invalid",
  };
  const manager = createAcpAgentManager({
    directory,
    env: baseEnv,
    fetchMetadata: async (url) => {
      if (url.includes("agentclientprotocol.com")) return { agents: [] };
      const parts = new URL(url).pathname.slice(1).split("/");
      return {
        name: decodeURIComponent(parts[0]!),
        version: parts[1] === "latest" ? "2026.10.5" : parts[1],
        engines: { node: ">=24.16 <25" },
      };
    },
  });
  const subscription = manager.onAgentOperation((event) =>
    events.push(`${event.phase}:${event.message}`),
  );
  const operate = (action: "install-runtime" | "install" = "install-runtime") =>
    manager.manageAgent({ agent: "openclaw", action, operationId: randomUUID() });
  try {
    await mkdir(systemBin);
    await writeFile(join(systemBin, "node"), "#!/bin/sh\necho v22.17.0\n", { mode: 0o755 });
    await mkdir(join(content, archive.root, "bin"), { recursive: true });
    const npmBin = join(content, archive.root, "lib/node_modules/npm/bin");
    await mkdir(npmBin, { recursive: true });
    const nodeContents = () =>
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo v${wrongVersion ? "22.17.0" : releaseVersion}; else exec '${process.execPath}' "$@"; fi\n`;
    await writeFile(join(content, archive.entry), nodeContents(), { mode: 0o755 });
    await writeFile(
      join(npmBin, "npm-cli.js"),
      `#!/usr/bin/env node
const fs=require('node:fs'), path=require('node:path');
if(process.argv.includes('--version')) {console.log('11.9.0'); process.exit(0);}
const dir=path.join(process.env.npm_config_prefix,'lib/node_modules/openclaw');
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'openclaw',version:'2026.10.5',bin:{openclaw:'cli.js'}}));
fs.writeFileSync(path.join(dir,'cli.js'),'// fake');
fs.writeFileSync(${JSON.stringify(join(root, "installed.json"))},JSON.stringify({registry:process.env.npm_config_registry,upperRegistry:process.env.NPM_CONFIG_REGISTRY,path:process.env.PATH,args:process.argv}));
`,
      { mode: 0o755 },
    );
    await writeFile(join(npmBin, "npx-cli.js"), "// fake");
    await symlink("/tmp/unsafe-outside-node", join(content, archive.root, "bin/npm"));
    await createTar({ file: archivePath, cwd: content, gzip: true }, [archive.root]);
    let payload = await readFile(archivePath);
    globalThis.fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      assert.ok(url.startsWith("https://npmmirror.com/mirrors/node/"));
      if (url.endsWith("index.json"))
        return Response.json([
          { version: `v${releaseVersion}`, lts: "Krypton", files: [archive.marker] },
        ]);
      if (url.endsWith("SHASUMS256.txt"))
        return new Response(
          `${badChecksum ? "0".repeat(64) : createHash("sha256").update(payload).digest("hex")}  ${archive.file}\n`,
        );
      if (pendingDownload) await pendingDownload;
      if (rejectDownload) throw new Error("fixture download unavailable");
      return new Response(payload, { headers: { "content-length": String(payload.length) } });
    };
    await manager.listAgents({ checkUpdates: true });
    await assert.rejects(
      manager.manageAgent({
        agent: "openclaw",
        action: "install-runtime",
        expectedVersion: "stale",
        operationId: randomUUID(),
      }),
      /目标已变化/,
    );
    assert.equal(requests.length, 0);
    await assert.rejects(
      manager.manageAgent({
        agent: "opencode",
        action: "install-runtime",
        operationId: randomUUID(),
      }),
      /不需要 Node/,
    );
    assert.equal(requests.length, 0);
    pendingDownload = new Promise((resolve) => {
      releaseDownload = resolve;
    });
    const installing = operate();
    while (!requests.some((url) => url.endsWith(archive.file)))
      await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(operate(), /already running/);
    releaseDownload!();
    pendingDownload = undefined;
    const installed = await installing;
    assert.equal(installed.nodeVersion, "24.19.0");
    assert.equal(installed.npmVersion, "11.9.0");
    assert.equal(installed.nodeRuntimeSource, "managed");
    assert.equal(installed.nodeVersionCompatible, true);
    assert.equal(installed.nodeInstallSupported, true);
    assert.ok(events.some((event) => event.includes("正在下载")));
    assert.ok(events.some((event) => event.startsWith("completed:")));
    const pointer = join(directory, "runtime/active.json");
    const previous = await readFile(pointer, "utf8");
    for (const mode of ["checksum", "download", "version"]) {
      badChecksum = mode === "checksum";
      rejectDownload = mode === "download";
      wrongVersion = mode === "version";
      if (wrongVersion) {
        await writeFile(join(content, archive.entry), nodeContents(), { mode: 0o755 });
        await createTar({ file: archivePath, cwd: content, gzip: true }, [archive.root]);
        payload = await readFile(archivePath);
      }
      await assert.rejects(operate());
      assert.equal(await readFile(pointer, "utf8"), previous);
      assert.equal(
        (await manager.listAgents()).find((item) => item.agent === "openclaw")!.nodeVersion,
        "24.19.0",
      );
    }
    badChecksum = rejectDownload = wrongVersion = false;
    await writeFile(join(content, archive.entry), nodeContents(), { mode: 0o755 });
    await createTar({ file: archivePath, cwd: content, gzip: true }, [archive.root]);
    payload = await readFile(archivePath);
    await operate();
    assert.equal((await operate("install")).managedVersion, "2026.10.5");
    const invocation = JSON.parse(await readFile(join(root, "installed.json"), "utf8"));
    assert.equal(invocation.registry, "https://registry.npmmirror.com");
    assert.equal(invocation.upperRegistry, undefined);
    assert.ok(
      invocation.path.startsWith(join(directory, "runtime/versions/24.19.0", archive.root, "bin")),
    );
    const launch = await manager.resolveLaunch("openclaw");
    assert.equal(launch.command, join(directory, "runtime/versions/24.19.0", archive.entry));
    assert.equal(launch.env.PATH, invocation.path);
    assert.equal(baseEnv.NPM_CONFIG_REGISTRY, "https://private.invalid");
    assert.equal(await readFile(join(systemBin, "node"), "utf8"), "#!/bin/sh\necho v22.17.0\n");
    const calls = requests.length;
    await manager.listAvailableAgents();
    await manager.resolveLaunch("openclaw");
    assert.equal(requests.length, calls, "launch/menu paths must remain network-free");
    assert.deepEqual(await readdir(join(directory, "runtime/versions")), ["24.19.0"]);
    const nextManager = createAcpAgentManager({ directory, env: baseEnv });
    try {
      assert.equal((await nextManager.resolveLaunch("openclaw")).command, launch.command);
    } finally {
      nextManager.dispose();
    }
    // 新版只切换指针，既有会话引用的旧运行环境仍保留。
    const nextArchive = nodeArchive("24.20.0");
    await cp(join(content, archive.root), join(content, nextArchive.root), {
      recursive: true,
      verbatimSymlinks: true,
    });
    archive = nextArchive;
    releaseVersion = "24.20.0";
    await writeFile(join(content, archive.entry), nodeContents(), { mode: 0o755 });
    await createTar({ file: archivePath, cwd: content, gzip: true }, [archive.root]);
    payload = await readFile(archivePath);
    assert.equal((await operate()).nodeVersion, "24.20.0");
    assert.deepEqual(await readdir(join(directory, "runtime/versions")), ["24.19.0", "24.20.0"]);
    await access(launch.command);
    // 即使校验和正确，越界归档也不能发布或改变 active 指针。
    const active = await readFile(pointer, "utf8");
    await createTar({ file: archivePath, cwd: content, gzip: true, prefix: "../../escape" }, [
      archive.root,
    ]);
    payload = await readFile(archivePath);
    await assert.rejects(operate(), /archive path/);
    assert.equal(await readFile(pointer, "utf8"), active);
    assert.equal(
      (await manager.resolveLaunch("openclaw")).command,
      join(directory, "runtime/versions/24.20.0", archive.entry),
    );
  } finally {
    releaseDownload?.();
    globalThis.fetch = originalFetch;
    subscription.dispose();
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
