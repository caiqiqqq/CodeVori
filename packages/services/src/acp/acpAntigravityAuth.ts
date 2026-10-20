import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const AUTH_METHODS = ["oauth-personal", "oauth-business", "gemini-api-key", "agent-platform"];
const CREDENTIAL_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
];

/** Keep the selected authentication method and inherited credentials on the same boundary. */
export function applyAntigravityCredentialPolicy(
  env: NodeJS.ProcessEnv,
  settings: Record<string, string>,
): void {
  const method = settings.AGY_AUTH_METHOD?.trim();
  if (!method) return;
  if (!AUTH_METHODS.includes(method)) throw new Error("Unknown Antigravity authentication method");
  const accepted =
    method === "gemini-api-key"
      ? ["GEMINI_API_KEY"]
      : method === "agent-platform"
        ? ["GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"]
        : [];
  // 修复原因：切换登录方式时，继承的旧密钥不能覆盖当前设置指向另一个账户或计费目标。
  for (const key of CREDENTIAL_KEYS) {
    if (!accepted.includes(key) || !settings[key]?.trim()) delete env[key];
  }
}

/** Antigravity reads auth.type from GEMINI_HOME/antigravity-acp/settings.json, not the environment. */
export async function ensureAntigravityAuthFile(
  env: NodeJS.ProcessEnv,
  settings: Record<string, string> = {},
): Promise<void> {
  const home = env.HOME || env.USERPROFILE;
  const geminiHome = env.GEMINI_HOME
    ? env.GEMINI_HOME.startsWith("~/") && home
      ? join(home, env.GEMINI_HOME.slice(2))
      : env.GEMINI_HOME
    : home && join(home, ".gemini");
  if (!geminiHome || !isAbsolute(geminiHome))
    throw new Error("Antigravity requires an absolute GEMINI_HOME or HOME");
  const directory = join(geminiHome, "antigravity-acp");
  const path = join(directory, "settings.json");
  let root: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Antigravity settings.json must be an object");
    root = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const auth = root.auth;
  if (auth !== undefined && (!auth || typeof auth !== "object" || Array.isArray(auth)))
    throw new Error("Antigravity settings.json auth must be an object");
  const previous = (auth ?? {}) as Record<string, unknown>;
  const selected = settings.AGY_AUTH_METHOD?.trim();
  if (selected && !AUTH_METHODS.includes(selected))
    throw new Error("Unknown Antigravity authentication method");
  const method =
    selected || (typeof previous.type === "string" && previous.type.trim()) || "oauth-personal";
  const gcp =
    root.gcp && typeof root.gcp === "object" && !Array.isArray(root.gcp)
      ? (root.gcp as Record<string, unknown>)
      : {};
  const nextGcp = { ...gcp };
  if (selected === "oauth-business" || selected === "agent-platform") {
    for (const [key, field] of [
      ["GOOGLE_CLOUD_PROJECT", "project"],
      ["GOOGLE_CLOUD_LOCATION", "location"],
    ] as const) {
      if (settings[key]?.trim()) nextGcp[field] = settings[key].trim();
      else delete nextGcp[field];
    }
  }
  if (previous.type === method && JSON.stringify(gcp) === JSON.stringify(nextGcp)) return;
  // 修复原因：该 ACP 服务在缺少 auth.type 时拒绝 session/new；沿用 Codeg 的个人 OAuth 默认值。
  const next = {
    ...root,
    auth: { ...previous, type: method },
    ...(Object.keys(nextGcp).length ? { gcp: nextGcp } : { gcp: undefined }),
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
