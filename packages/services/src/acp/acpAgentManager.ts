/* oxlint-disable eslint(max-lines) -- ACP Host owns package resolution, settings updates and launch readiness as one policy. */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { satisfies } from "semver";
import { Emitter, type Event } from "@zcode/rpc";
import {
  ACP_AGENT_CATALOG,
  acpAgentDefinition,
  acpAgentListOptionsSchema,
  acpAgentManagementSchema,
  acpAgentUpdateSchema,
  compareAcpAdapterVersions,
  type AcpAgent,
  type AcpAgentAvailability,
  type AcpAgentInfo,
  type AcpAgentListOptions,
  type AcpAgentManagement,
  type AcpAgentOperationEvent,
  type AcpAgentUpdate,
  type AcpCodexConfig,
  type AcpCodexConfigUpdate,
  type AcpCodexModel,
  type AcpGeminiProviders,
  type AcpGeminiProvidersUpdate,
} from "@zcode/shared";
import { getZCodeDataRootDir } from "../paths.js";
import {
  applyAntigravityCredentialPolicy,
  ensureAntigravityAuthFile,
} from "./acpAntigravityAuth.js";
import { installAcpBinary, managedAcpBinary } from "./acpBinaryInstaller.js";
import { readCodexNativeConfig, updateCodexNativeConfig } from "./acpCodexConfig.js";
import { listCodexOfficialModels } from "./acpCodexModels.js";
import {
  applyGeminiCredentialPolicy,
  geminiAuthMode,
  normalizeGeminiCredentials,
  projectGeminiNativeAuth,
} from "./acpGeminiAuth.js";
import { createGeminiProviderStore } from "./acpGeminiProviders.js";
import { createAcpReleaseRegistry } from "./acpReleaseRegistry.js";
import { ACP_NPM_REGISTRY, createAcpNodeRuntime } from "./acpNodeRuntime.js";

/** Offline release defaults. Remote checks replace only version/distribution metadata on this Host. */
const catalog = {
  claude: {
    kind: "npm",
    nativeCommand: "claude",
    packageName: "@agentclientprotocol/claude-agent-acp",
    version: "0.75.1",
  },
  codex: {
    kind: "npm",
    nativeCommand: "codex",
    packageName: "@agentclientprotocol/codex-acp",
    version: "1.10.0",
  },
  gemini: { kind: "npm", nativeCommand: "", packageName: "@google/gemini-cli", version: "0.59.0" },
  openclaw: { kind: "npm", nativeCommand: "", packageName: "openclaw", version: "2026.9.3" },
  opencode: {
    kind: "binary",
    nativeCommand: "",
    packageName: "",
    version: "1.18.30",
    urls: {
      "darwin-arm64":
        "https://github.com/anomalyco/opencode/releases/download/v1.18.30/opencode-darwin-arm64.zip",
      "darwin-x64":
        "https://github.com/anomalyco/opencode/releases/download/v1.18.30/opencode-darwin-x64.zip",
      "linux-arm64":
        "https://github.com/anomalyco/opencode/releases/download/v1.18.30/opencode-linux-arm64.tar.gz",
      "linux-x64":
        "https://github.com/anomalyco/opencode/releases/download/v1.18.30/opencode-linux-x64.tar.gz",
      "win32-arm64":
        "https://github.com/anomalyco/opencode/releases/download/v1.18.30/opencode-windows-arm64.zip",
      "win32-x64":
        "https://github.com/anomalyco/opencode/releases/download/v1.18.30/opencode-windows-x64.zip",
    },
  },
  cline: { kind: "npm", nativeCommand: "", packageName: "cline", version: "3.0.61" },
  hermes: { kind: "npm", nativeCommand: "", packageName: "hermes-agent", version: "0.21.1" },
  codebuddy: {
    kind: "npm",
    nativeCommand: "",
    packageName: "@tencent-ai/codebuddy-code",
    version: "2.149.0",
  },
  "kimi-code": {
    kind: "npm",
    nativeCommand: "",
    packageName: "@moonshot-ai/kimi-code",
    version: "0.42.0",
  },
  pi: { kind: "npm", nativeCommand: "pi", packageName: "pi-acp", version: "0.0.33" },
  grok: { kind: "npm", nativeCommand: "", packageName: "@xai-official/grok", version: "1.0.25" },
  cursor: {
    kind: "binary",
    nativeCommand: "",
    packageName: "",
    version: "2026.09.02-c22c1a3",
    urls: {
      "darwin-arm64":
        "https://downloads.cursor.com/lab/2026.09.02-c22c1a3/darwin/arm64/agent-cli-package.tar.gz",
      "darwin-x64":
        "https://downloads.cursor.com/lab/2026.09.02-c22c1a3/darwin/x64/agent-cli-package.tar.gz",
      "linux-arm64":
        "https://downloads.cursor.com/lab/2026.09.02-c22c1a3/linux/arm64/agent-cli-package.tar.gz",
      "linux-x64":
        "https://downloads.cursor.com/lab/2026.09.02-c22c1a3/linux/x64/agent-cli-package.tar.gz",
      "win32-arm64":
        "https://downloads.cursor.com/lab/2026.09.02-c22c1a3/windows/arm64/agent-cli-package.zip",
      "win32-x64":
        "https://downloads.cursor.com/lab/2026.09.02-c22c1a3/windows/x64/agent-cli-package.zip",
    },
    entry:
      process.platform === "win32" ? "dist-package/cursor-agent.cmd" : "dist-package/cursor-agent",
  },
  deepseek: { kind: "npm", nativeCommand: "", packageName: "deepseek-acp", version: "0.9.0" },
  qoder: { kind: "npm", nativeCommand: "", packageName: "@qoder-ai/qodercli", version: "1.1.49" },
  antigravity: {
    kind: "binary",
    nativeCommand: "",
    packageName: "",
    version: "1.1.1",
    urls: {
      "darwin-arm64":
        "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-agy_acp_server_1.1.1-darwin-arm64.zip",
      "linux-arm64":
        "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-agy_acp_server_1.1.1-linux-arm64.zip",
      "linux-x64":
        "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-agy_acp_server_1.1.1-linux-x86_64.zip",
      "win32-arm64":
        "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-agy_acp_server_1.1.1-windows-arm64.zip",
      "win32-x64":
        "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-agy_acp_server_1.1.1-windows-x86_64.zip",
    },
    entry: process.platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par",
    sibling: process.platform === "win32" ? "localharness_external.exe" : "localharness_external",
  },
} as const satisfies Record<
  AcpAgent,
  {
    kind: "npm" | "binary";
    nativeCommand: string;
    packageName: string;
    version: string;
    urls?: Record<string, string>;
    entry?: string;
    sibling?: string;
  }
>;

function platformUrl(agent: AcpAgent): string | null {
  const meta = catalog[agent];
  return "urls" in meta
    ? ((meta.urls as Record<string, string>)[`${process.platform}-${process.arch}`] ?? null)
    : null;
}

type Action = AcpAgentManagement["action"];
type Settings = { enabled: boolean; env: Record<string, string> };
export type AcpAgentLaunch = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  shell?: boolean;
};

export interface AcpAgentManager {
  listAgents(options?: AcpAgentListOptions): Promise<AcpAgentInfo[]>;
  listAvailableAgents(): Promise<AcpAgentAvailability[]>;
  updateAgent(input: AcpAgentUpdate): Promise<AcpAgentInfo>;
  readCodexConfig(): Promise<AcpCodexConfig>;
  updateCodexConfig(input: AcpCodexConfigUpdate): Promise<AcpCodexConfig>;
  listCodexModels(): Promise<AcpCodexModel[]>;
  listGeminiProviders(): Promise<AcpGeminiProviders>;
  updateGeminiProviders(input: AcpGeminiProvidersUpdate): Promise<AcpGeminiProviders>;
  manageAgent(input: AcpAgentManagement): Promise<AcpAgentInfo>;
  resolveLaunch(agent: AcpAgent): Promise<AcpAgentLaunch>;
  /** Read native usage history without availability probes or process startup. */
  resolveCodexHome?(): Promise<string>;
  onAgentOperation: Event<AcpAgentOperationEvent>;
  dispose(): void;
}

export async function findCommand(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  if (isAbsolute(command)) {
    try {
      await access(command, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }
  const extensions =
    process.platform === "win32"
      ? ["", ...(env.PATHEXT?.split(";").filter(Boolean) ?? [".EXE", ".CMD", ".BAT"])]
      : [""];
  const paths = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const directory of paths) {
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      try {
        await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        /* Try the next directory. */
      }
    }
  }
  return null;
}

async function probeVersion(
  command: string | null,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  if (!command) return null;
  return new Promise((finish) => {
    const child = spawn(
      process.platform === "win32" && /\.(cmd|bat)$/i.test(command)
        ? command.replace(/\.(cmd|bat)$/i, "")
        : command,
      ["--version"],
      { env, windowsHide: true, shell: process.platform === "win32" },
    );
    let output = "";
    let done = false;
    const complete = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      finish(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      complete(null);
    }, 4000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString().slice(0, 256);
    });
    child.stderr.resume();
    child.once("error", () => complete(null));
    child.once("close", (code) => {
      const version = output.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0];
      complete(code === 0 ? (version ?? null) : null);
    });
  });
}

async function managedPackage(
  prefix: string,
  agent: AcpAgent,
): Promise<{
  version: string;
  script: string;
} | null> {
  const meta = catalog[agent];
  if (meta.kind !== "npm") return null;
  const packageDir = join(
    prefix,
    ...(process.platform === "win32" ? [] : ["lib"]),
    "node_modules",
    meta.packageName,
  );
  try {
    const raw = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")) as {
      name?: string;
      version?: string;
      bin?: string | Record<string, string>;
    };
    const entry =
      typeof raw.bin === "string" ? raw.bin : raw.bin?.[acpAgentDefinition(agent).command];
    if (
      raw.name !== meta.packageName ||
      !/^\d+\.\d+\.\d+/.test(raw.version ?? "") ||
      !entry ||
      isAbsolute(entry)
    )
      return null;
    const script = resolve(packageDir, entry);
    // npm metadata is untrusted here: never execute a bin outside its package directory.
    const within = relative(packageDir, script);
    if (within === ".." || within.startsWith(`..${sep}`)) return null;
    await access(script);
    return { version: raw.version!, script };
  } catch {
    return null;
  }
}

async function npmInstallAttempt(
  prefix: string,
  agent: AcpAgent,
  env: NodeJS.ProcessEnv,
  targetVersion: string,
  runtime?: { node: string; npm: string } | null,
): Promise<void> {
  const meta = catalog[agent];
  if (meta.kind !== "npm") throw new Error("Not an npm ACP release");
  const staging = `${prefix}.${randomUUID()}.tmp`;
  const backup = `${prefix}.${randomUUID()}.backup`;
  const installEnv = { ...env };
  // npm 在不同平台会读取大小写变体，旧环境不能悄悄覆盖本软件的镜像和 staging。
  for (const key of Object.keys(installEnv)) {
    if (
      ["npm_config_registry", "npm_config_prefix", "npm_config_disturl"].includes(key.toLowerCase())
    )
      delete installEnv[key];
  }
  await mkdir(staging, { recursive: true });
  try {
    await new Promise<void>((finish, reject) => {
      // 包名来自内置目录，版本已通过发行校验；prefix 通过环境变量传入，避免 Windows 命令插值。
      const child = spawn(
        runtime?.node ?? "npm",
        [
          ...(runtime ? [runtime.npm] : []),
          "install",
          "-g",
          "--no-audit",
          "--no-fund",
          "--include=optional",
          `${meta.packageName}@${targetVersion}`,
        ],
        {
          env: {
            ...installEnv,
            npm_config_prefix: staging,
            npm_config_registry: ACP_NPM_REGISTRY,
            npm_config_disturl: "https://npmmirror.com/mirrors/node",
          },
          windowsHide: true,
          shell: !runtime && process.platform === "win32",
          stdio: "ignore",
        },
      );
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? finish()
          : reject(
              new Error(
                `npm exited with code ${code}；已使用国内 npm 镜像，第三方安装脚本仍可能需要访问 GitHub 或额外的本机工具。`,
              ),
            ),
      );
    });
    const installed = await managedPackage(staging, agent);
    if (!installed)
      throw new Error("ACP adapter installation did not produce a launchable package");
    if (installed.version !== targetVersion)
      throw new Error("ACP adapter installation returned a different target version");
    let previous = false;
    try {
      await rename(prefix, backup);
      previous = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(staging, prefix);
    } catch (error) {
      if (previous) await rename(backup, prefix);
      throw error;
    }
    if (previous) await rm(backup, { recursive: true, force: true });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** The target Host is the sole owner of ACP package and settings operations. */
export function createAcpAgentManager(
  options: {
    directory?: string;
    env?: NodeJS.ProcessEnv;
    runPackageCommand?: (agent: AcpAgent, action: Action) => Promise<void>;
    fetchMetadata?: (url: string) => Promise<unknown>;
    now?: () => number;
  } = {},
): AcpAgentManager {
  const directory = options.directory ?? join(getZCodeDataRootDir(), "acp-agents");
  const env = options.env ?? process.env;
  const nodeRuntime = createAcpNodeRuntime(join(directory, "runtime"), env);
  const geminiProviders = createGeminiProviderStore(directory);
  const emitter = new Emitter<AcpAgentOperationEvent>();
  let busy = false;
  const updates = new Map<AcpAgent, Promise<AcpAgentInfo>>();
  let codexUpdate: Promise<AcpCodexConfig> | undefined;
  const settingsFile = (agent: AcpAgent) => join(directory, `${agent}.json`);
  const prefix = (agent: AcpAgent) => join(directory, agent, "npm");
  const binaryDir = (agent: AcpAgent) => join(directory, agent, "binary");
  const binaryRelease = (agent: AcpAgent) => {
    const meta = catalog[agent];
    if (meta.kind !== "binary") return null;
    return {
      version: meta.version,
      entry:
        "entry" in meta
          ? meta.entry
          : process.platform === "win32"
            ? `${acpAgentDefinition(agent).command}.exe`
            : acpAgentDefinition(agent).command,
      ...("sibling" in meta ? { sibling: meta.sibling } : {}),
    };
  };
  const releases = createAcpReleaseRegistry(
    ACP_AGENT_CATALOG.map(({ id, args }) => {
      const meta = catalog[id];
      const binary = binaryRelease(id);
      return {
        agent: id,
        kind: meta.kind,
        packageName: meta.packageName,
        version: meta.version,
        args: [
          ...args,
          ...(id === "antigravity" && process.platform === "linux" ? ["--uid="] : []),
        ],
        platformSupported: meta.kind === "npm" || Boolean(platformUrl(id)),
        ...(binary
          ? {
              binary: {
                url: platformUrl(id) ?? "",
                entry: binary.entry,
                ...(binary.sibling ? { sibling: binary.sibling } : {}),
              },
            }
          : {}),
      };
    }),
    options,
  );
  const managedFor = async (agent: AcpAgent) => {
    const release = binaryRelease(agent);
    return release
      ? managedAcpBinary(binaryDir(agent), release)
      : managedPackage(prefix(agent), agent);
  };

  const codexHome = async () => {
    const settings = await readSettings("codex");
    const configured = settings.env.CODEX_HOME?.trim() || env.CODEX_HOME?.trim();
    const userHome = env.HOME || env.USERPROFILE || homedir();
    if (!configured) return join(userHome, ".codex");
    if (configured === "~") return userHome;
    if (configured.startsWith("~/")) return join(userHome, configured.slice(2));
    if (!isAbsolute(configured)) throw new Error("CODEX_HOME 必须为绝对路径。");
    return configured;
  };

  const readSettings = async (agent: AcpAgent): Promise<Settings> => {
    try {
      const raw = JSON.parse(await readFile(settingsFile(agent), "utf8"));
      const parsed = acpAgentUpdateSchema.parse({ agent, ...raw });
      const savedEnv = { ...parsed.env };
      // 修复原因：旧版保存的 latest 标志在控件移除后不可继续暗中改变安装行为或传给 Agent。
      delete savedEnv.ZCODE_ADAPTER_CHANNEL;
      return { enabled: parsed.enabled ?? true, env: savedEnv };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: true, env: {} };
      throw error;
    }
  };

  const availability = async (agent: AcpAgent) => {
    const runtime = await nodeRuntime.read();
    const launchEnv = runtime?.env ?? env;
    const meta = catalog[agent];
    const definition = acpAgentDefinition(agent);
    const settings = await readSettings(agent);
    // 与启动解析使用同一托管包校验和 PATH 探测；菜单不需要等待任何 --version 进程。
    const [managed, systemPath, nativePath, nodePath] = await Promise.all([
      managedFor(agent),
      findCommand(definition.command, launchEnv),
      meta.nativeCommand
        ? findCommand(
            agent === "pi"
              ? settings.env.PI_ACP_PI_COMMAND?.trim() || meta.nativeCommand
              : meta.nativeCommand,
            launchEnv,
          )
        : Promise.resolve(null),
      runtime ? Promise.resolve(runtime.node) : findCommand("node", launchEnv),
    ]);
    const source: AcpAgentInfo["source"] =
      managed && (meta.kind === "binary" || nodePath)
        ? "managed"
        : systemPath
          ? "system"
          : "missing";
    const ready = source !== "missing" && (agent !== "pi" || Boolean(nativePath));
    return {
      settings,
      managed,
      systemPath,
      nativePath,
      nodePath,
      source,
      ready,
      runtime,
      launchEnv,
    };
  };

  const status = async (
    agent: AcpAgent,
    versions?: { node: string | null; npm: string | null },
  ): Promise<AcpAgentInfo> => {
    const meta = catalog[agent];
    const definition = acpAgentDefinition(agent);
    const release = binaryRelease(agent);
    const {
      settings,
      managed,
      systemPath,
      nativePath,
      nodePath,
      source,
      ready,
      runtime,
      launchEnv,
    } = await availability(agent);
    const npmPath = await findCommand("npm", launchEnv);
    const [nodeVersion, npmVersion, systemVersion] = await Promise.all([
      versions ? versions.node : probeVersion(nodePath, launchEnv),
      versions ? versions.npm : probeVersion(npmPath, launchEnv),
      managed && (release || nodePath)
        ? Promise.resolve(null)
        : probeVersion(systemPath, launchEnv),
    ]);
    const nodeVersionRange = releases.target(agent).nodeVersionRange ?? null;
    return {
      agent,
      command: definition.command,
      args: [
        ...definition.args,
        ...(agent === "antigravity" && process.platform === "linux" ? ["--uid="] : []),
      ],
      distribution: meta.kind,
      platformSupported: releases.target(agent).platformSupported,
      nativeCommand: meta.nativeCommand,
      packageName: meta.packageName,
      registryVersion: releases.target(agent).version,
      updateCheck: releases.check(agent),
      enabled: settings.enabled,
      env: settings.env,
      source,
      ready,
      managedVersion: managed?.version ?? null,
      installedVersion: source === "managed" ? managed!.version : systemVersion,
      executablePath: source === "managed" ? managed!.script : systemPath,
      nativePath,
      nodeVersion,
      npmVersion,
      nodeVersionRange,
      nodeInstallSupported: nodeRuntime.supported(),
      nodeRuntimeSource: runtime ? "managed" : nodePath ? "system" : "missing",
      nodeVersionCompatible:
        meta.kind === "binary"
          ? null
          : !nodeVersion
            ? false
            : nodeVersionRange
              ? satisfies(nodeVersion, nodeVersionRange)
              : null,
    };
  };

  return {
    onAgentOperation: emitter.event,
    listGeminiProviders: geminiProviders.list,
    updateGeminiProviders: geminiProviders.update,
    async readCodexConfig() {
      if (codexUpdate) await codexUpdate.catch(() => {});
      return readCodexNativeConfig(await codexHome());
    },
    async updateCodexConfig(input) {
      const previous = codexUpdate;
      const task = (async () => {
        if (previous) await previous.catch(() => {});
        return updateCodexNativeConfig(await codexHome(), input);
      })();
      codexUpdate = task;
      try {
        return await task;
      } finally {
        if (codexUpdate === task) codexUpdate = undefined;
      }
    },
    async listCodexModels() {
      const { managed, systemPath, nodePath, source, launchEnv } = await availability("codex");
      const executable = source === "managed" ? managed?.script : systemPath;
      if (!nodePath || !executable)
        throw new Error("请先在目标 Host 安装 Codex ACP 适配器和 Node.js。");
      return listCodexOfficialModels(executable, nodePath, {
        ...launchEnv,
        ...(await readSettings("codex")).env,
      });
    },
    async listAvailableAgents() {
      return Promise.all(
        ACP_AGENT_CATALOG.map(async ({ id }) => {
          const { settings, ready } = await availability(id);
          return { agent: id, enabled: settings.enabled, ready };
        }),
      );
    },
    async listAgents(input) {
      const query = acpAgentListOptionsSchema.parse(input ?? {});
      if (query.checkUpdates) await releases.refresh(query.force);
      const runtime = await nodeRuntime.read();
      const launchEnv = runtime?.env ?? env;
      const [nodePath, npmPath] = await Promise.all([
        runtime ? Promise.resolve(runtime.node) : findCommand("node", launchEnv),
        findCommand("npm", launchEnv),
      ]);
      const [node, npm] = await Promise.all([
        probeVersion(nodePath, launchEnv),
        probeVersion(npmPath, launchEnv),
      ]);
      return Promise.all(ACP_AGENT_CATALOG.map(({ id }) => status(id, { node, npm })));
    },
    async updateAgent(input) {
      const parsed = acpAgentUpdateSchema.parse(input);
      // 修复原因：并发保存开关和环境变量时必须读取前一次提交，避免后一次覆盖另一字段。
      const previousUpdate = updates.get(parsed.agent);
      const task = (async () => {
        if (previousUpdate) await previousUpdate.catch(() => {});
        const previous = await readSettings(parsed.agent);
        const next = {
          enabled: parsed.enabled ?? previous.enabled,
          env: parsed.env
            ? parsed.agent === "gemini"
              ? normalizeGeminiCredentials(parsed.env)
              : parsed.env
            : previous.env,
        };
        delete next.env.ZCODE_ADAPTER_CHANNEL;
        if (
          parsed.agent === "gemini" &&
          parsed.env &&
          geminiAuthMode(next.env) === "model_provider"
        )
          await geminiProviders.resolve(next.env);
        await mkdir(directory, { recursive: true });
        const temporary = `${settingsFile(parsed.agent)}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
          await rename(temporary, settingsFile(parsed.agent));
        } finally {
          await rm(temporary, { force: true });
        }
        return status(parsed.agent);
      })();
      updates.set(parsed.agent, task);
      try {
        return await task;
      } finally {
        if (updates.get(parsed.agent) === task) updates.delete(parsed.agent);
      }
    },
    async manageAgent(input) {
      const { agent, action, operationId, expectedVersion } = acpAgentManagementSchema.parse(input);
      if (busy) throw new Error("ACP package operation already running");
      busy = true;
      // 修复原因：检查可能与安装并发，admission 时绑定完整目标，不能在下载期间换版本或 URL。
      const target = releases.target(agent);
      const emit = (phase: AcpAgentOperationEvent["phase"], message: string) =>
        emitter.fire({ operationId, agent, phase, message });
      emit("started", `${action}: ${acpAgentDefinition(agent).command}`);
      try {
        if (action === "install-runtime") {
          if (catalog[agent].kind !== "npm") throw new Error("此智能体不需要 Node.js 运行环境");
          if (!nodeRuntime.supported()) throw new Error("当前平台不支持一键安装 Node.js");
          if (expectedVersion && expectedVersion !== target.version)
            throw new Error("ACP 发行目标已变化，请刷新后重试。");
          const npmTarget = await releases.resolveNpmTarget(agent, target);
          await nodeRuntime.install(npmTarget.nodeVersionRange ?? ">=20", (message) =>
            emit("log", message),
          );
          const result = await status(agent);
          emit("completed", "目标 Host 的 Node.js / npm 已就绪");
          return result;
        }
        const runtime = await nodeRuntime.read();
        const operationEnv = runtime?.env ?? env;
        const installed = await managedFor(agent);
        const meta = catalog[agent];
        if (action === "uninstall") {
          if (!installed) throw new Error("No managed ACP adapter to uninstall");
          if (options.runPackageCommand) await options.runPackageCommand(agent, action);
          else
            await rm(meta.kind === "binary" ? binaryDir(agent) : prefix(agent), {
              recursive: true,
              force: true,
            });
        } else {
          if (expectedVersion && expectedVersion !== target.version)
            throw new Error("ACP 发行目标已变化，请重新检查更新后再安装。");
          const current = await status(agent);
          if (compareAcpAdapterVersions(current.installedVersion, target.version) === 1)
            throw new Error("当前 ACP 适配器高于目标版本，拒绝降级。");
          if (!options.runPackageCommand && meta.kind === "npm") {
            const [node, npm] = await Promise.all([
              runtime ? Promise.resolve(runtime.node) : findCommand("node", operationEnv),
              findCommand("npm", operationEnv),
            ]);
            if (!node || !npm)
              throw new Error("Node.js and npm are required to install ACP adapters");
            const npmTarget = await releases.resolveNpmTarget(agent, target);
            const nodeVersion = await probeVersion(node, operationEnv);
            // 修复原因：命令存在不代表版本兼容；OpenClaw 会在 preinstall 拒绝旧 Node，须提前说明要求。
            if (
              !nodeVersion ||
              (npmTarget.nodeVersionRange && !satisfies(nodeVersion, npmTarget.nodeVersionRange))
            )
              throw new Error(
                `Node.js 当前版本 ${nodeVersion ?? "未知"}，目标版本要求 ${npmTarget.nodeVersionRange ?? "可识别的 Node.js 版本"}。请在目标 Host 一键安装兼容运行环境后重试。`,
              );
          }
          const url = target.binary?.url;
          if (meta.kind === "binary" && (!url || !target.platformSupported))
            throw new Error("No managed ACP release for this platform");
          if (options.runPackageCommand) {
            emit(
              "log",
              `Installing ${meta.kind === "npm" ? meta.packageName : acpAgentDefinition(agent).command}@${target.version}`,
            );
            await options.runPackageCommand(agent, action);
          } else if (meta.kind === "npm") {
            emit("log", `Installing ${meta.packageName}@${target.version}`);
            await npmInstallAttempt(prefix(agent), agent, operationEnv, target.version, runtime);
          } else {
            emit("log", `Installing ${acpAgentDefinition(agent).command}@${target.version}`);
            await installAcpBinary(binaryDir(agent), url!, {
              ...target.binary!,
              version: target.version,
            });
          }
          if (!(await managedFor(agent)))
            throw new Error("ACP adapter installation did not produce a launchable package");
        }
        const result = await status(agent);
        emit("completed", `${acpAgentDefinition(agent).command}: ${result.source}`);
        return result;
      } catch (error) {
        emit("failed", error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        busy = false;
      }
    },
    resolveCodexHome: codexHome,
    async resolveLaunch(agent) {
      const definition = acpAgentDefinition(agent);
      // 修复原因：status 会为 Node/npm/适配器运行 --version，Qoder 未登录提示因此晚约一秒；
      // 启动只需要和菜单共用的可启动性检查，设置页仍通过 status 获取完整版本诊断。
      const {
        settings,
        managed,
        systemPath,
        nativePath,
        nodePath,
        source,
        ready,
        launchEnv: runtimeEnv,
      } = await availability(agent);
      if (!settings.enabled) throw new Error(`${definition.command} is disabled in Agent settings`);
      const launchEnv: NodeJS.ProcessEnv = {
        ...runtimeEnv,
        ...(agent === "pi" ? { PI_ACP_ENABLE_EMBEDDED_CONTEXT: "true" } : {}),
        ...settings.env,
      };
      delete launchEnv.ZCODE_ADAPTER_CHANNEL;
      if (agent === "codex") {
        const native = await readCodexNativeConfig(await codexHome());
        // 修复原因：旧环境变量可能覆盖 Codex 原生订阅认证、API URL 和默认模型；
        // Codeg 将原生配置投影到启动环境，新连接也必须以当前原生文件为准。
        if (native.authMode === "subscription" || native.managedProvider) {
          for (const key of ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"])
            delete launchEnv[key];
        }
        if (native.authMode === "custom") {
          if (native.apiKey) launchEnv.OPENAI_API_KEY = native.apiKey;
          if (native.apiUrl) launchEnv.OPENAI_BASE_URL = native.apiUrl;
          if (native.model) launchEnv.OPENAI_MODEL = native.model;
        }
      }
      if (agent === "pi" && !nativePath)
        throw new Error("Pi is not installed: install pi or set PI_ACP_PI_COMMAND");
      const executablePath = source === "managed" ? managed?.script : systemPath;
      if (!ready || !executablePath)
        throw new Error(`${definition.command} is not installed on this Host`);
      if (agent === "gemini") {
        if (source === "managed" && !nodePath)
          throw new Error("Node.js is required to run the managed ACP adapter");
        const mode = applyGeminiCredentialPolicy(launchEnv, settings.env);
        if (mode === "model_provider") {
          const provider = await geminiProviders.resolve(settings.env);
          // 修复原因：每次新连接读取供应商最新值，空模型也必须清除旧环境中的模型。
          launchEnv.GEMINI_API_KEY = provider.apiKey;
          launchEnv.GOOGLE_GEMINI_BASE_URL = provider.apiUrl;
          delete launchEnv.GEMINI_MODEL;
          if (provider.model) launchEnv.GEMINI_MODEL = provider.model;
        }
        await projectGeminiNativeAuth(launchEnv, mode);
      }
      if (agent === "antigravity") {
        applyAntigravityCredentialPolicy(launchEnv, settings.env);
        await ensureAntigravityAuthFile(launchEnv, settings.env);
      }
      const args = [
        ...definition.args,
        ...(agent === "antigravity" && process.platform === "linux" ? ["--uid="] : []),
      ];
      if (source === "managed") {
        if (catalog[agent].kind === "binary")
          return {
            command: executablePath,
            args,
            env: launchEnv,
            shell: process.platform === "win32" && executablePath.endsWith(".cmd"),
          };
        if (!nodePath) throw new Error("Node.js is required to run the managed ACP adapter");
        return { command: nodePath, args: [executablePath, ...args], env: launchEnv };
      }
      // Windows shims require cmd.exe; pass only a static command name, never a path from settings.
      return {
        command: process.platform === "win32" ? definition.command : executablePath,
        args,
        env: launchEnv,
        shell: process.platform === "win32",
      };
    },
    dispose() {
      emitter.dispose();
    },
  };
}
