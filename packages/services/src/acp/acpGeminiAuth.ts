import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { ACP_GEMINI_AUTH_MODES, type AcpGeminiAuthMode } from "@zcode/shared";

const credentialKeys = [
  "GEMINI_API_KEY",
  "GOOGLE_GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GEMINI_BASE_URL",
  "GEMINI_BASE_URL",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT_ID",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_APPLICATION_CREDENTIALS",
] as const;

const allowed: Record<AcpGeminiAuthMode, readonly string[]> = {
  custom: ["GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL"],
  login_google: [],
  gemini_api_key: ["GEMINI_API_KEY"],
  vertex_adc: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"],
  vertex_service_account: [
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ],
  vertex_api_key: ["GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"],
  model_provider: [],
};

export function geminiAuthMode(settings: Record<string, string>): AcpGeminiAuthMode | null {
  const value = settings.ZCODE_GEMINI_AUTH_MODE?.trim();
  if (!value) return null;
  if (!ACP_GEMINI_AUTH_MODES.includes(value as AcpGeminiAuthMode))
    throw new Error("未知的 Gemini 认证方式");
  return value as AcpGeminiAuthMode;
}

/** The selected mode owns credentials; unrelated env and model selection stay untouched. */
export function normalizeGeminiCredentials(
  settings: Record<string, string>,
): Record<string, string> {
  const mode = geminiAuthMode(settings);
  if (!mode) return settings;
  const next = { ...settings };
  // 修复原因：原始 KEY=value 可以绕过表单；保存时清除冲突凭据，避免重连意外使用旧账户。
  for (const key of credentialKeys) if (!allowed[mode].includes(key)) delete next[key];
  for (const key of ["GOOGLE_GENAI_USE_GCA", "GOOGLE_GENAI_USE_VERTEXAI"]) delete next[key];
  // 修复原因：供应商的凭据和模型只有一个所有者，不能残留另一份旧值或在切换方式后继续绑定。
  if (mode === "model_provider") delete next.GEMINI_MODEL;
  else delete next.ZCODE_GEMINI_PROVIDER_ID;
  return next;
}

/** Explicit mode does not inherit credentials from the Host's process or another agent. */
export function applyGeminiCredentialPolicy(
  env: NodeJS.ProcessEnv,
  settings: Record<string, string>,
): AcpGeminiAuthMode | null {
  const mode = geminiAuthMode(settings);
  if (!mode) return null;
  const normalized = normalizeGeminiCredentials(settings);
  // 修复原因：Gemini CLI 会从原生配置与进程环境双重选择认证，旧 Key/Vertex 标志会覆盖面板选项。
  for (const key of [
    ...credentialKeys,
    "GOOGLE_GENAI_USE_GCA",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "ZCODE_GEMINI_AUTH_MODE",
    "ZCODE_GEMINI_PROVIDER_ID",
  ])
    delete env[key];
  for (const key of allowed[mode]) if (normalized[key]?.trim()) env[key] = normalized[key];
  if (mode.startsWith("vertex_")) env.GOOGLE_GENAI_USE_VERTEXAI = "true";
  if (mode === "login_google") env.GOOGLE_GENAI_USE_GCA = "true";
  return mode;
}

/** Gemini CLI uses GEMINI_CLI_HOME/.gemini/settings.json (or os.homedir()). */
export async function projectGeminiNativeAuth(
  env: NodeJS.ProcessEnv,
  mode: AcpGeminiAuthMode | null,
): Promise<void> {
  if (!mode) return;
  const home = env.GEMINI_CLI_HOME || env.HOME || env.USERPROFILE || homedir();
  if (!isAbsolute(home)) throw new Error("Gemini CLI 主目录必须是绝对路径");
  const path = join(home, ".gemini", "settings.json");
  let root: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    root = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Gemini 原生 settings.json 无法读取或解析，请先修复该文件");
  }
  const security = root.security ?? {};
  if (!security || typeof security !== "object" || Array.isArray(security))
    throw new Error("Gemini 原生 settings.json 的 security 配置无效");
  const auth = (security as Record<string, unknown>).auth ?? {};
  if (!auth || typeof auth !== "object" || Array.isArray(auth))
    throw new Error("Gemini 原生 settings.json 的 auth 配置无效");
  const selectedType =
    mode === "custom" || mode === "model_provider"
      ? "gateway"
      : mode === "login_google"
        ? "oauth-personal"
        : mode === "gemini_api_key"
          ? "gemini-api-key"
          : "vertex-ai";
  if ((auth as Record<string, unknown>).selectedType === selectedType) return;
  const next = { ...root, security: { ...security, auth: { ...auth, selectedType } } };
  await mkdir(join(home, ".gemini"), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
