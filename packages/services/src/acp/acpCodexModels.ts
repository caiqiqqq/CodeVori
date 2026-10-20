import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname } from "node:path";
import type { AcpCodexModel } from "@zcode/shared";

async function runNode(
  node: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(node, args, { env, windowsHide: true });
    let stdout = "";
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("读取 Codex 官方模型目录超时。"));
    }, 15000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > maxBytes) {
        child.kill();
        finish(new Error("Codex 官方模型目录超过大小限制。"));
      }
    });
    child.stderr.resume();
    child.once("error", () => finish(new Error("无法启动目标 Host 上的 Codex CLI。")));
    child.once("close", (code) => {
      if (code !== 0) finish(new Error("目标 Host 的 Codex CLI 无法读取官方模型目录。"));
      else finish();
    });
  });
}

/** Resolve from the launched adapter's node_modules, not an unrelated codex on PATH. */
export async function listCodexOfficialModels(
  adapterPath: string,
  nodePath: string,
  env: NodeJS.ProcessEnv,
): Promise<AcpCodexModel[]> {
  const packagePath = dirname(await realpath(adapterPath));
  const resolution = await runNode(
    nodePath,
    [
      "-e",
      "process.stdout.write(require.resolve('@openai/codex/bin/codex.js',{paths:[process.argv[1]]}))",
      packagePath,
    ],
    env,
    4096,
  );
  if (!resolution.trim()) throw new Error("ACP 适配器没有可用的 Codex CLI。");
  const raw = await runNode(
    nodePath,
    [resolution.trim(), "debug", "models", "--bundled"],
    env,
    4 * 1024 * 1024,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Codex 官方模型目录格式无效。");
  }
  const models =
    parsed && typeof parsed === "object" && "models" in parsed ? parsed.models : undefined;
  if (!Array.isArray(models)) throw new Error("Codex 官方模型目录格式无效。");
  const visible = models
    .filter(
      (model): model is Record<string, unknown> =>
        model &&
        typeof model === "object" &&
        model.visibility === "list" &&
        typeof model.slug === "string" &&
        Boolean(model.slug),
    )
    .map((model) => ({
      slug: model.slug as string,
      name: typeof model.display_name === "string" ? model.display_name : (model.slug as string),
    }));
  if (!visible.length) throw new Error("目标 Host 的 Codex CLI 未提供可选官方模型。");
  return visible;
}
