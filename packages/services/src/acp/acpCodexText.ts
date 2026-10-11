import { spawn } from "node:child_process";
import { readFile, writeFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";
import type { AcpSession } from "@zcode/shared";
import type { AcpAgentLaunch } from "./acpAgentManager.js";
import { acpTextSource } from "./acpTextSource.js";
import {
  shouldSpawnInDetachedProcessGroup,
  terminateProcessTreeAndWait,
} from "../process/processTreeTerminator.js";

async function optionalFile(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/** 原生 CLI 的 read-only sandbox 不受 ACP “read-only”模式实际为 workspace-write 的影响。 */
export async function generateCodexText(input: {
  session: AcpSession;
  launch: AcpAgentLaunch;
  directory: string;
  codexHome?: string;
  prompt: string;
  signal: AbortSignal;
}) {
  const { launch, signal, directory } = input;
  // 网关专用握手不能冒充原生 CLI 认证，避免摘要悄悄使用另一套账号。
  if (launch.env.DEFAULT_AUTH_REQUEST) throw new Error("work-task.result-auth-unsupported");
  const source = acpTextSource(input.session);
  const home =
    input.codexHome ?? launch.env.CODEX_HOME ?? join(launch.env.HOME ?? homedir(), ".codex");
  const [contents, auth] = await Promise.all([
    optionalFile(join(home, "config.toml")),
    optionalFile(join(home, "auth.json")),
  ]);
  const original = contents ? parse(contents) : {};
  const overlay = launch.env.CODEX_CONFIG ? JSON.parse(launch.env.CODEX_CONFIG) : {};
  // 仅复制供应商认证字段，不能携带用户 MCP、hooks、自动目标或项目执行权限。
  const config: Record<string, unknown> = {};
  for (const key of ["model_provider", "model_providers"])
    if (overlay[key] ?? original[key]) config[key] = overlay[key] ?? original[key];
  if (launch.env.MODEL_PROVIDER) config.model_provider = launch.env.MODEL_PROVIDER;
  if (!auth && !launch.env.OPENAI_API_KEY && original.cli_auth_credentials_store === "keyring")
    throw new Error("work-task.result-auth-unsupported");
  config.model = source.modelId;
  config.approval_policy = "never";
  config.sandbox_mode = "read-only";
  config.cli_auth_credentials_store = "file";
  const reasoning = input.session.configOptions.find((option) => option.id === "reasoning_effort");
  if (reasoning?.type === "select") config.model_reasoning_effort = reasoning.currentValue;
  const fast = input.session.configOptions.find((option) => option.id === "fast_mode");
  if (fast?.currentValue === true || fast?.currentValue === "true") config.service_tier = "fast";
  await writeFile(join(directory, "config.toml"), stringify(config), { mode: 0o600 });
  if (auth) await writeFile(join(directory, "auth.json"), auth, { mode: 0o600 });
  if (signal.aborted) throw new Error("work-task.result-canceled");
  const output = join(directory, "result.txt");
  const env: NodeJS.ProcessEnv = { ...launch.env, CODEX_HOME: directory };
  // 临时原生运行不读取适配器专用配置，也不允许环境再次覆盖冻结的模型。
  delete env.CODEX_CONFIG;
  delete env.OPENAI_MODEL;
  const child = spawn(
    launch.command,
    [
      ...launch.args,
      "cli",
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--output-last-message",
      "result.txt",
      "-",
    ],
    {
      cwd: directory,
      env,
      shell: launch.shell,
      stdio: ["pipe", "ignore", "ignore"],
      detached: shouldSpawnInDetachedProcessGroup(),
      windowsHide: true,
    },
  );
  let cleanup: ReturnType<typeof terminateProcessTreeAndWait> | undefined;
  const stop = () => {
    cleanup ??= terminateProcessTreeAndWait(
      child,
      process.platform !== "win32" && child.pid ? { ownedProcessGroupId: child.pid } : {},
    );
    void cleanup.catch(() => {});
  };
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0 ? resolve() : reject(new Error("work-task.result-generation-failed")),
      );
      child.stdin.on("error", () => {});
      child.stdin.end(input.prompt);
    });
    if (signal.aborted) throw new Error("work-task.result-canceled");
    if ((await stat(output)).size > 48_000) throw new Error("work-task.result-invalid-output");
    return (await readFile(output, "utf8")).trim();
  } catch (error) {
    if (signal.aborted) throw new Error("work-task.result-canceled");
    throw error;
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
    await cleanup;
  }
}
