import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import {
  acpCodexConfigUpdateSchema,
  type AcpCodexConfig,
  type AcpCodexConfigUpdate,
} from "@zcode/shared";

type NativeFiles = { config: string; auth: string };
const ZCODE_PROVIDER = "zcode";

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function readNativeFiles(home: string): Promise<NativeFiles> {
  const [config, auth] = await Promise.all([
    readOptional(join(home, "config.toml")),
    readOptional(join(home, "auth.json")),
  ]);
  return { config, auth };
}

function version(files: NativeFiles): string {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

function parseNative(files: NativeFiles) {
  let config: Record<string, unknown>;
  let auth: Record<string, unknown>;
  try {
    config = files.config ? parse(files.config) : {};
  } catch {
    throw new Error("Codex config.toml 格式无效，请先在 Codex 中修复；原文件未被覆盖。");
  }
  try {
    const parsed: unknown = files.auth ? JSON.parse(files.auth) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    auth = parsed as Record<string, unknown>;
  } catch {
    throw new Error("Codex auth.json 格式无效，请先在 Codex 中修复；原文件未被覆盖。");
  }
  return { config, auth };
}

function project(files: NativeFiles): AcpCodexConfig {
  const { config, auth } = parseNative(files);
  const providers = config.model_providers;
  const selectedProvider = typeof config.model_provider === "string" ? config.model_provider : "";
  const provider =
    providers && typeof providers === "object" && !Array.isArray(providers)
      ? (providers as Record<string, unknown>)[selectedProvider]
      : undefined;
  const apiUrl =
    provider && typeof provider === "object" && !Array.isArray(provider)
      ? (provider as Record<string, unknown>).base_url
      : undefined;
  const tokens = auth.tokens;
  return {
    version: version(files),
    authMode: auth.auth_mode === "chatgpt" && !selectedProvider ? "subscription" : "custom",
    managedProvider: selectedProvider === ZCODE_PROVIDER,
    hasSubscriptionCredentials: Boolean(
      tokens &&
      typeof tokens === "object" &&
      !Array.isArray(tokens) &&
      (typeof (tokens as Record<string, unknown>).access_token === "string" ||
        typeof (tokens as Record<string, unknown>).id_token === "string"),
    ),
    apiUrl: typeof apiUrl === "string" ? apiUrl : "",
    apiKey: typeof auth.OPENAI_API_KEY === "string" ? auth.OPENAI_API_KEY : "",
    model: typeof config.model === "string" ? config.model : "",
  };
}

/** Root assignment stops at the first TOML table, leaving all other sections intact. */
function patchRoot(text: string, key: string, value: string | null): string {
  const lines = text ? text.replace(/\r\n/g, "\n").split("\n") : [];
  const end = lines.findIndex((line) => /^\s*\[/.test(line));
  const rootEnd = end < 0 ? lines.length : end;
  const match = new RegExp(`^\\s*${key}\\s*=`);
  const index = lines.slice(0, rootEnd).findIndex((line) => match.test(line));
  if (index >= 0) {
    if (value === null) lines.splice(index, 1);
    else lines[index] = `${key} = ${JSON.stringify(value)}`;
  } else if (value !== null) {
    lines.splice(rootEnd, 0, `${key} = ${JSON.stringify(value)}`);
  }
  return lines.join("\n").replace(/\n*$/, "\n");
}

/** Only the dedicated provider table is editable; foreign provider tables survive unchanged. */
function patchProvider(text: string, baseUrl: string): string {
  const lines = text.trimEnd().split("\n");
  const start = lines.findIndex((line) => /^\s*\[model_providers\.zcode\]\s*(?:#.*)?$/.test(line));
  const fields = [
    ["name", "ZCode"],
    ["base_url", baseUrl],
    ["wire_api", "responses"],
  ] as const;
  if (start < 0) {
    const parsed = parse(text);
    const providers = parsed.model_providers as Record<string, unknown> | undefined;
    if (providers && Object.hasOwn(providers, ZCODE_PROVIDER))
      throw new Error("Codex 的 zcode provider 使用了不支持的 TOML 写法；原文件未被覆盖。");
    return `${text.trimEnd()}\n\n[model_providers.zcode]\n${fields.map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join("\n")}\nrequires_openai_auth = true\n`.replace(
      /^\n+/,
      "",
    );
  }
  const next = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
  const end = next < 0 ? lines.length : next;
  const section = lines.slice(start + 1, end);
  for (const [key, value] of fields) {
    const index = section.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
    if (index < 0) section.push(`${key} = ${JSON.stringify(value)}`);
    else section[index] = `${key} = ${JSON.stringify(value)}`;
  }
  for (const key of ["requires_openai_auth", "env_key"]) {
    const index = section.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
    if (index >= 0) section.splice(index, 1);
  }
  section.push("requires_openai_auth = true");
  lines.splice(start + 1, end - start - 1, ...section);
  return lines.join("\n").replace(/\n*$/, "\n");
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(join(path, ".."), { recursive: true });
  try {
    await writeFile(temporary, contents, { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readCodexNativeConfig(home: string): Promise<AcpCodexConfig> {
  return project(await readNativeFiles(home));
}

export async function updateCodexNativeConfig(
  home: string,
  input: AcpCodexConfigUpdate,
): Promise<AcpCodexConfig> {
  const update = acpCodexConfigUpdateSchema.parse(input);
  const original = await readNativeFiles(home);
  if (version(original) !== update.expectedVersion)
    throw new Error("Codex 原生配置已变更，请刷新后重试；未覆盖新配置。");
  const { auth } = parseNative(original);
  const nextAuth = { ...auth };
  let nextConfig = patchRoot(original.config, "model", update.model.trim() || null);
  if (update.authMode === "subscription") {
    nextConfig = patchRoot(nextConfig, "model_provider", null);
    nextAuth.auth_mode = "chatgpt";
    nextAuth.OPENAI_API_KEY = null;
  } else {
    const url = new URL(update.apiUrl.trim());
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("API URL 必须使用 HTTP 或 HTTPS。");
    nextConfig = patchProvider(
      patchRoot(nextConfig, "model_provider", ZCODE_PROVIDER),
      update.apiUrl.trim(),
    );
    nextAuth.auth_mode = "apikey";
    if (update.apiKey.trim()) nextAuth.OPENAI_API_KEY = update.apiKey.trim();
    else delete nextAuth.OPENAI_API_KEY;
  }
  const updated = { config: nextConfig, auth: `${JSON.stringify(nextAuth, null, 2)}\n` };
  parseNative(updated);
  // 修复原因：Codex CLI 或另一个窗口可能在表单打开后更新凭据；旧版本不能覆盖新文件。
  if (version(await readNativeFiles(home)) !== update.expectedVersion)
    throw new Error("Codex 原生配置已变更，请刷新后重试；未覆盖新配置。");
  if (updated.config !== original.config)
    await atomicWrite(join(home, "config.toml"), updated.config);
  if (updated.auth !== original.auth) await atomicWrite(join(home, "auth.json"), updated.auth);
  return readCodexNativeConfig(home);
}
