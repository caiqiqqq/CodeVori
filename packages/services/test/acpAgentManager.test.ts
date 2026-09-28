import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProxyChannel } from "@zcode/rpc";
import type { IAcpService } from "../src/acp/acpService.js";
import { createAcpAgentManager } from "../src/acp/acpAgentManager.js";
import { createAcpService } from "../src/acp/acpServiceImpl.js";
import { ACP_AGENT_CATALOG } from "@zcode/shared";

test("Host release catalog covers every builtin agent with Codeg launch arguments and pinned versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-catalog-"));
  const manager = createAcpAgentManager({ directory: root, env: { PATH: "" } });
  try {
    const agents = await manager.listAgents();
    assert.deepEqual(
      agents.map(({ agent }) => agent),
      ACP_AGENT_CATALOG.map(({ id }) => id),
    );
    assert.deepEqual(
      agents.map(({ packageName, registryVersion }) => [packageName, registryVersion]),
      [
        ["@agentclientprotocol/claude-agent-acp", "0.75.1"],
        ["@agentclientprotocol/codex-acp", "1.10.0"],
        ["@google/gemini-cli", "0.59.0"],
        ["openclaw", "2026.9.3"],
        ["", "1.18.30"],
        ["cline", "3.0.61"],
        ["hermes-agent", "0.21.1"],
        ["@tencent-ai/codebuddy-code", "2.149.0"],
        ["@moonshot-ai/kimi-code", "0.42.0"],
        ["pi-acp", "0.0.33"],
        ["@xai-official/grok", "1.0.25"],
        ["", "2026.09.02-c22c1a3"],
        ["deepseek-acp", "0.9.0"],
        ["@qoder-ai/qodercli", "1.1.49"],
        ["", "1.1.1"],
      ],
    );
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("npm 安装只请求固定版，旧 latest 标志不生效，失败保留原托管包", async () => {
  if (process.platform === "win32") return; // Fake npm fixture uses POSIX executable shims.
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-channel-"));
  const bin = join(root, "bin");
  const attempts = join(root, "attempts");
  const switches = { failAll: "0" };
  const managerRoot = join(root, "agents");
  const manager = createAcpAgentManager({
    directory: managerRoot,
    env: {
      PATH: bin,
      ZCODE_ADAPTER_CHANNEL: "latest",
      ACP_FAKE_ATTEMPTS: attempts,
      ACP_FAKE_SWITCHES: join(root, "switches.json"),
    },
  });
  const logs: string[] = [];
  const subscription = manager.onAgentOperation((event) => {
    if (event.phase === "log") logs.push(event.message);
  });
  try {
    await mkdir(bin);
    await symlink(process.execPath, join(bin, "node"));
    await writeFile(join(root, "switches.json"), JSON.stringify(switches));
    await writeFile(
      join(bin, "npm"),
      `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
if (process.argv.includes('--version')) { process.stdout.write('1.0.0\\n'); process.exit(0); }
const spec = process.argv.at(-1);
fs.appendFileSync(process.env.ACP_FAKE_ATTEMPTS, spec + '\\n');
const { failAll } = JSON.parse(fs.readFileSync(process.env.ACP_FAKE_SWITCHES, 'utf8'));
if (failAll === '1') process.exit(7);
const version = '0.59.0';
const directory = path.join(process.env.npm_config_prefix, 'lib/node_modules/@google/gemini-cli');
fs.mkdirSync(path.join(directory, 'bin'), { recursive: true });
fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({name:'@google/gemini-cli',version,bin:{gemini:'bin/gemini.js'}}));
fs.writeFileSync(path.join(directory, 'bin/gemini.js'), '// fake ACP');
`,
      { mode: 0o755 },
    );
    const operate = async (action: "install" | "upgrade") =>
      manager.manageAgent({
        agent: "gemini",
        action,
        operationId: randomUUID(),
      });
    assert.equal((await operate("install")).managedVersion, "0.59.0");
    await writeFile(
      join(managerRoot, "gemini.json"),
      JSON.stringify({ enabled: true, env: { ZCODE_ADAPTER_CHANNEL: "latest", EXTRA: "keep" } }),
    );
    const legacy = (await manager.listAgents()).find(({ agent }) => agent === "gemini")!;
    assert.equal(legacy.env.ZCODE_ADAPTER_CHANNEL, undefined);
    assert.equal(legacy.env.EXTRA, "keep");
    assert.equal((await manager.resolveLaunch("gemini")).env.ZCODE_ADAPTER_CHANNEL, undefined);
    await manager.updateAgent({ agent: "gemini", env: { ZCODE_ADAPTER_CHANNEL: "latest" } });
    assert.equal(
      (await manager.listAgents()).find(({ agent }) => agent === "gemini")?.env
        .ZCODE_ADAPTER_CHANNEL,
      undefined,
    );
    assert.equal(
      JSON.parse(await readFile(join(managerRoot, "gemini.json"), "utf8")).env
        .ZCODE_ADAPTER_CHANNEL,
      undefined,
    );
    assert.equal((await operate("upgrade")).managedVersion, "0.59.0");
    switches.failAll = "1";
    await writeFile(join(root, "switches.json"), JSON.stringify(switches));
    await assert.rejects(operate("upgrade"), /npm exited/);
    assert.equal(
      (await manager.listAgents()).find(({ agent }) => agent === "gemini")?.managedVersion,
      "0.59.0",
    );
    assert.deepEqual((await readFile(attempts, "utf8")).trim().split("\n"), [
      "@google/gemini-cli@0.59.0",
      "@google/gemini-cli@0.59.0",
      "@google/gemini-cli@0.59.0",
    ]);
    assert.ok(logs.every((line) => !line.includes("@latest")));
  } finally {
    subscription.dispose();
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("composer availability uses launch readiness without running adapter version commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-available-"));
  const bin = join(root, "bin");
  const marker = join(root, "version-command-ran");
  const manager = createAcpAgentManager({ directory: join(root, "settings"), env: { PATH: bin } });
  const service = createAcpService({ directory: join(root, "sessions"), agentManager: manager });
  try {
    await mkdir(bin);
    for (const command of ["node", "npm", "codex-acp", "pi-acp"]) {
      await writeFile(join(bin, command), `#!/bin/sh\necho called >> '${marker}'\n`, {
        mode: 0o755,
      });
    }
    const managed = join(
      root,
      "settings",
      "claude",
      "npm",
      ...(process.platform === "win32" ? [] : ["lib"]),
      "node_modules",
      "@agentclientprotocol",
      "claude-agent-acp",
    );
    await mkdir(join(managed, "bin"), { recursive: true });
    await writeFile(
      join(managed, "package.json"),
      JSON.stringify({
        name: "@agentclientprotocol/claude-agent-acp",
        version: "0.75.1",
        bin: { "claude-agent-acp": "bin/cli.js" },
      }),
    );
    await writeFile(join(managed, "bin", "cli.js"), "// fake ACP adapter\n");
    const first = await manager.listAvailableAgents();
    assert.deepEqual(
      first.filter(({ ready }) => ready).map(({ agent }) => agent),
      ["claude", "codex"],
    );
    const channel = ProxyChannel.fromService(service);
    const client = ProxyChannel.toService<IAcpService>({
      call: (name, args) => channel.call(undefined, name, args),
      listen: (name, arg) => channel.listen(undefined, name, arg),
    });
    assert.deepEqual(await client.listAvailableAgents(), first);
    await assert.rejects(readFile(marker, "utf8"), { code: "ENOENT" });

    const systemLaunch = await manager.resolveLaunch("codex");
    const managedLaunch = await manager.resolveLaunch("claude");
    assert.equal(systemLaunch.command, join(bin, "codex-acp"));
    assert.equal(managedLaunch.command, join(bin, "node"));
    assert.equal(managedLaunch.args[0], join(managed, "bin", "cli.js"));
    // 修复原因：连接前只需启动解析；--version 是设置页诊断，等待它会延迟认证错误出现。
    await assert.rejects(readFile(marker, "utf8"), { code: "ENOENT" });

    await manager.updateAgent({ agent: "codex", enabled: false });
    await rm(marker, { force: true });
    const disabled = await manager.listAvailableAgents();
    assert.equal(disabled.find(({ agent }) => agent === "codex")?.enabled, false);
    await writeFile(join(bin, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const withPi = await manager.listAvailableAgents();
    assert.equal(withPi.find(({ agent }) => agent === "pi")?.ready, true);
    await assert.rejects(readFile(marker, "utf8"), { code: "ENOENT" });

    const full = await manager.listAgents();
    assert.deepEqual(
      withPi,
      full.map(({ agent, enabled, ready }) => ({ agent, enabled, ready })),
    );
    assert.match(await readFile(marker, "utf8"), /called/);
  } finally {
    service.disposeAll();
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("system ACP commands use each agent's launch arguments; binary agents need no Node", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-system-catalog-"));
  const bin = join(root, "bin");
  const manager = createAcpAgentManager({
    directory: join(root, "settings"),
    env: { PATH: bin, HOME: root },
  });
  try {
    await mkdir(bin);
    for (const { command } of ACP_AGENT_CATALOG) {
      await writeFile(join(bin, command), "#!/bin/sh\necho 1.0.0\n", { mode: 0o755 });
    }
    await writeFile(join(bin, "pi"), "#!/bin/sh\necho 1.0.0\n", { mode: 0o755 });
    const info = await manager.listAgents();
    for (const definition of ACP_AGENT_CATALOG) {
      const launch = await manager.resolveLaunch(definition.id);
      assert.equal(launch.command, join(bin, definition.command));
      assert.deepEqual(launch.args, [
        ...definition.args,
        ...(definition.id === "antigravity" && process.platform === "linux" ? ["--uid="] : []),
      ]);
      assert.equal(info.find(({ agent }) => agent === definition.id)?.source, "system");
    }
    await rm(join(bin, "pi"));
    await assert.rejects(manager.resolveLaunch("pi"), /Pi is not installed/);
    assert.match(
      await readFile(join(root, ".gemini", "antigravity-acp", "settings.json"), "utf8"),
      /oauth-personal/,
    );
    await manager.updateAgent({
      agent: "antigravity",
      env: {
        AGY_AUTH_METHOD: "oauth-business",
        GOOGLE_CLOUD_PROJECT: "sample-project",
        GOOGLE_CLOUD_LOCATION: "us-central1",
      },
    });
    const antigravity = await manager.resolveLaunch("antigravity");
    assert.equal(antigravity.env.GEMINI_API_KEY, undefined);
    const authFile = JSON.parse(
      await readFile(join(root, ".gemini", "antigravity-acp", "settings.json"), "utf8"),
    );
    assert.equal(authFile.auth.type, "oauth-business");
    assert.deepEqual(authFile.gcp, { project: "sample-project", location: "us-central1" });
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent SDK 管理隔离托管安装、识别已有适配器并在重启后阻止禁用的连接", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-manager-"));
  const bin = join(root, "system-bin");
  const managerRoot = join(root, "managed");
  const events: string[] = [];
  try {
    await mkdir(bin);
    for (const cmd of ["node", "npm", "codex", "claude", "codex-acp"]) {
      await writeFile(join(bin, cmd), `#!/bin/sh\necho '${cmd} 1.0.0'\n`, { mode: 0o755 });
    }
    const env = { ...process.env, PATH: bin };
    const makeManager = () =>
      createAcpAgentManager({
        directory: managerRoot,
        env,
        runPackageCommand: async (_agent, action) => {
          if (action === "uninstall")
            await rm(join(managerRoot, "codex", "npm"), { recursive: true, force: true });
        },
      });
    const manager = makeManager();
    const initial = await manager.listAgents();
    assert.equal(initial[1]?.source, "system");
    assert.equal(initial[1]?.ready, true);
    assert.equal(initial[0]?.source, "missing");
    assert.equal(initial[1]?.nativePath, join(bin, "codex"));
    assert.equal(initial[0]?.nativePath, join(bin, "claude"));

    await Promise.all([
      manager.updateAgent({ agent: "codex", enabled: false }),
      manager.updateAgent({ agent: "codex", env: { TEST_AGENT: "yes" } }),
    ]);
    const saved = (await manager.listAgents())[1]!;
    assert.equal(saved.enabled, false);
    assert.equal(saved.env.TEST_AGENT, "yes");
    const restarted = makeManager();
    await assert.rejects(restarted.resolveLaunch("codex"), /disabled/);
    await assert.rejects(
      restarted.updateAgent({ agent: "codex", enabled: true, env: { PATH: "x" } }),
      /Invalid input/,
    );
    await restarted.updateAgent({ agent: "codex", enabled: true, env: { TEST_AGENT: "yes" } });

    const packageDir = join(
      managerRoot,
      "codex",
      "npm",
      "lib",
      "node_modules",
      "@agentclientprotocol",
      "codex-acp",
    );
    await mkdir(join(packageDir, "bin"), { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@agentclientprotocol/codex-acp",
        version: "1.10.0",
        bin: { "codex-acp": "bin/cli.js" },
      }),
    );
    await writeFile(join(packageDir, "bin", "cli.js"), "// fake entry\n");
    // npm 在 POSIX 下安装到 prefix/lib/node_modules；管理状态从包元数据读取而非会话数量。
    const managed = (await restarted.listAgents())[1]!;
    assert.equal(managed.source, "managed");
    assert.equal(managed.installedVersion, "1.10.0");
    const launch = await restarted.resolveLaunch("codex");
    assert.equal(launch.command, join(bin, "node"));
    assert.equal(launch.args[0], join(packageDir, "bin", "cli.js"));
    assert.equal(launch.env.TEST_AGENT, "yes");
    const subscription = restarted.onAgentOperation((event) => events.push(event.phase));
    await restarted.manageAgent({
      agent: "codex",
      action: "uninstall",
      operationId: "00000000-0000-4000-8000-000000000001",
    });
    subscription.dispose();
    // 卸载仅影响 ZCode 的 prefix；系统自装适配器仍可启动。
    assert.equal((await restarted.listAgents())[1]?.source, "system");
    assert.deepEqual(events, ["started", "completed"]);
    assert.match(await readFile(join(managerRoot, "codex.json"), "utf8"), /TEST_AGENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Host 新建和重连采用同一启用设置；已有连接保留到重连", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-launch-policy-"));
  const bin = join(root, "bin");
  const target = { workspacePath: root };
  const calls: string[] = [];
  try {
    await mkdir(bin);
    await writeFile(join(bin, "codex-acp"), "#!/bin/sh\necho '1.0.0'\n", { mode: 0o755 });
    const manager = createAcpAgentManager({
      directory: join(root, "settings"),
      env: { PATH: bin },
    });
    const connect = async ({ launch }: { launch?: { command: string } }) => {
      calls.push(launch?.command ?? "missing");
      return {
        sessionId: "native-session",
        configOptions: [],
        modeState: null,
        async setConfigOption() {
          return [];
        },
        async setMode() {},
        async prompt() {},
        async cancel() {},
        close() {},
      };
    };
    const service = createAcpService({
      directory: join(root, "sessions"),
      agentManager: manager,
      connect,
    });
    await manager.updateAgent({ agent: "codex", enabled: false });
    await assert.rejects(service.create({ ...target, agent: "codex" }), /disabled/);
    assert.deepEqual(calls, []);
    await manager.updateAgent({ agent: "codex", enabled: true });
    const session = await service.create({ ...target, agent: "codex" });
    assert.deepEqual(calls, [join(bin, "codex-acp")]);
    await manager.updateAgent({ agent: "codex", enabled: false });
    await service.refresh({ ...target, id: session.id });
    assert.equal(calls.length, 1);
    const restarted = createAcpService({
      directory: join(root, "sessions"),
      agentManager: manager,
      connect,
    });
    await assert.rejects(restarted.refresh({ ...target, id: session.id }), /disabled/);
    await assert.rejects(restarted.create({ ...target, agent: "codex" }), /disabled/);
    assert.equal(calls.length, 1);
    restarted.disposeAll();
    service.disposeAll();
    manager.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Host 重连读取各 Agent 单独保存的环境变量，清除后不再注入旧值", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-env-isolation-"));
  const bin = join(root, "bin");
  try {
    await mkdir(bin);
    for (const command of ["qoder", "deepseek-acp"]) {
      await writeFile(join(bin, command), "#!/bin/sh\necho 1.0.0\n", { mode: 0o755 });
    }
    const options = { directory: join(root, "settings"), env: { PATH: bin } };
    const manager = createAcpAgentManager(options);
    await manager.updateAgent({ agent: "qoder", env: { QODER_PERSONAL_ACCESS_TOKEN: "fake-pat" } });
    await manager.updateAgent({
      agent: "deepseek",
      env: { DEEPSEEK_BASE_URL: "https://example.invalid" },
    });
    const qoder = await manager.resolveLaunch("qoder");
    const deepseek = await manager.resolveLaunch("deepseek");
    assert.equal(qoder.env.QODER_PERSONAL_ACCESS_TOKEN, "fake-pat");
    assert.equal(qoder.env.DEEPSEEK_BASE_URL, undefined);
    assert.equal(deepseek.env.DEEPSEEK_BASE_URL, "https://example.invalid");
    assert.equal(deepseek.env.QODER_PERSONAL_ACCESS_TOKEN, undefined);
    manager.dispose();

    const restarted = createAcpAgentManager(options);
    try {
      assert.equal(
        (await restarted.resolveLaunch("qoder")).env.QODER_PERSONAL_ACCESS_TOKEN,
        "fake-pat",
      );
      await restarted.updateAgent({ agent: "qoder", env: {} });
      assert.equal(
        (await restarted.resolveLaunch("qoder")).env.QODER_PERSONAL_ACCESS_TOKEN,
        undefined,
      );
      assert.equal(
        (await restarted.resolveLaunch("deepseek")).env.DEEPSEEK_BASE_URL,
        "https://example.invalid",
      );
    } finally {
      restarted.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("失败安装不伪造版本，同一 Host 的包操作串行且事件按操作 ID 归属", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-operations-"));
  let release: (() => void) | undefined;
  const seen: string[] = [];
  const manager = createAcpAgentManager({
    directory: root,
    env: { PATH: "" },
    runPackageCommand: async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      throw new Error("package manager failed");
    },
  });
  try {
    const listener = manager.onAgentOperation((event) =>
      seen.push(`${event.operationId}:${event.phase}`),
    );
    const first = manager.manageAgent({
      agent: "codex",
      action: "install",
      operationId: "00000000-0000-4000-8000-000000000002",
    });
    for (let attempt = 0; !release && attempt < 100; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(release);
    await assert.rejects(
      manager.manageAgent({
        agent: "claude",
        action: "install",
        operationId: "00000000-0000-4000-8000-000000000003",
      }),
      /already running/,
    );
    release?.();
    await assert.rejects(first, /package manager failed/);
    assert.equal((await manager.listAgents())[1]?.installedVersion, null);
    assert.deepEqual(seen, [
      "00000000-0000-4000-8000-000000000002:started",
      "00000000-0000-4000-8000-000000000002:log",
      "00000000-0000-4000-8000-000000000002:failed",
    ]);
    listener.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("RPC 动态订阅在包操作前生效，只推送匹配操作 ID 的进度", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-acp-dynamic-operation-"));
  const manager = createAcpAgentManager({
    directory: join(root, "settings"),
    env: { PATH: "" },
    runPackageCommand: async () => {
      throw new Error("simulated package failure");
    },
  });
  const service = createAcpService({
    directory: join(root, "sessions"),
    agentManager: manager,
  });
  const channel = ProxyChannel.fromService(service);
  const client = ProxyChannel.toService<IAcpService>({
    call: (name, args) => channel.call(undefined, name, args),
    listen: (name, arg) => channel.listen(undefined, name, arg),
  });
  const id = "00000000-0000-4000-8000-000000000004";
  const phases: string[] = [];
  const matching = client.onDynamicAgentOperation(id)((event) => phases.push(event.phase));
  const other = client.onDynamicAgentOperation("00000000-0000-4000-8000-000000000005")((event) =>
    phases.push(`other:${event.phase}`),
  );
  try {
    await assert.rejects(
      client.manageAgent({ agent: "codex", action: "install", operationId: id }),
      /simulated package failure/,
    );
    assert.deepEqual(phases, ["started", "log", "failed"]);
  } finally {
    matching.dispose();
    other.dispose();
    service.disposeAll();
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
