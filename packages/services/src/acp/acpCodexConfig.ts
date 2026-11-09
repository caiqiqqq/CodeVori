/* oxlint-disable eslint(max-lines) -- Native Codex config patching keeps version checks and non-destructive TOML edits together. */
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse } from "smol-toml";
import {
  PRODUCT_NAME,
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

function selectedProvider(config: Record<string, unknown>) {
  const providers = config.model_providers;
  const name = typeof config.model_provider === "string" ? config.model_provider : "";
  const provider =
    providers && typeof providers === "object" && !Array.isArray(providers)
      ? (providers as Record<string, unknown>)[name]
      : undefined;
  return {
    name,
    table:
      provider && typeof provider === "object" && !Array.isArray(provider)
        ? (provider as Record<string, unknown>)
        : {},
  };
}

function credential(config: Record<string, unknown>, auth: Record<string, unknown>) {
  const { name, table } = selectedProvider(config);
  // CC Switch 将 Key 放在 provider 内；该凭据不能被无关的 auth.json 覆盖或迁移。
  if (typeof table.experimental_bearer_token === "string")
    return { source: "provider", value: table.experimental_bearer_token } as const;
  if (table.env_key) return { source: "external", value: "" } as const;
  if (table.requires_openai_auth === true)
    return {
      source: "auth",
      value: typeof auth.OPENAI_API_KEY === "string" ? auth.OPENAI_API_KEY : "",
    } as const;
  if (table.env_http_headers || table.http_headers)
    return { source: "external", value: "" } as const;
  if (name && table.requires_openai_auth !== true)
    return { source: "provider", value: "" } as const;
  return {
    source: "auth",
    value: typeof auth.OPENAI_API_KEY === "string" ? auth.OPENAI_API_KEY : "",
  } as const;
}

function project(files: NativeFiles): AcpCodexConfig {
  const { config, auth } = parseNative(files);
  const { name, table } = selectedProvider(config);
  const tokens = auth.tokens;
  return {
    version: version(files),
    authMode: auth.auth_mode === "chatgpt" && !name ? "subscription" : "custom",
    managedProvider: name === ZCODE_PROVIDER,
    hasSubscriptionCredentials: Boolean(
      tokens &&
      typeof tokens === "object" &&
      !Array.isArray(tokens) &&
      (typeof (tokens as Record<string, unknown>).access_token === "string" ||
        typeof (tokens as Record<string, unknown>).id_token === "string"),
    ),
    apiUrl: typeof table.base_url === "string" ? table.base_url : "",
    apiKey: credential(config, auth).value,
    model: typeof config.model === "string" ? config.model : "",
    defaultModeRequestUserInput: Boolean(
      config.features &&
      typeof config.features === "object" &&
      !Array.isArray(config.features) &&
      (config.features as Record<string, unknown>).default_mode_request_user_input === true,
    ),
  };
}

function checkedPatch(
  original: string,
  next: string,
  change: (config: Record<string, unknown>) => void,
): string {
  const expected = parseNative({ config: original, auth: "" }).config;
  change(expected);
  const actual = parseNative({ config: next, auth: "" }).config;
  // 文本定位不能误改多行字符串或其他同名字段；写盘前确认仅发生预期的结构变化。
  if (!isDeepStrictEqual(actual, expected))
    throw new Error("无法安全更新 Codex 原生配置；原文件未被覆盖。");
  return next;
}

/** Root assignment stops at the first TOML table, leaving all other sections intact. */
function patchRoot(text: string, key: string, value: string | null): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text ? text.split(/\r?\n/) : [];
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
  return checkedPatch(text, lines.join(eol).replace(/(?:\r?\n)*$/, eol), (config) => {
    if (value === null) delete config[key];
    else config[key] = value;
  });
}

/** Update the Codex feature flag without reserializing unrelated TOML or comments. */
function patchFeaturesBoolean(text: string, key: string, value: boolean | null): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text ? text.split(/\r?\n/) : [];
  const rootEnd = lines.findIndex((line) => /^\s*\[/.test(line));
  const rootLength = rootEnd < 0 ? lines.length : rootEnd;
  const sectionStart = lines.findIndex((line) => /^\s*\[\s*features\s*\]\s*(?:#.*)?$/.test(line));
  const sectionEnd =
    sectionStart < 0
      ? -1
      : (() => {
          const next = lines.findIndex(
            (line, index) => index > sectionStart && /^\s*\[/.test(line),
          );
          return next < 0 ? lines.length : next;
        })();
  const dottedKey = new RegExp(`^\\s*features\\.(?:${key}|"${key}"|'${key}')\\s*=`);
  const rootKey = lines.slice(0, rootLength).findIndex((line) => dottedKey.test(line));
  const rootFeatureLines = lines.slice(0, rootLength);
  const otherRootFeature = rootFeatureLines.some(
    (line, index) => index !== rootKey && /^\s*features\./.test(line),
  );
  let preserveEmptyTable = sectionStart >= 0 || otherRootFeature;

  if (sectionStart >= 0) {
    const keyOffset = lines
      .slice(sectionStart + 1, sectionEnd)
      .findIndex((line) => new RegExp(`^\\s*(?:${key}|"${key}"|'${key}')\\s*=`).test(line));
    if (value === null) {
      if (keyOffset < 0) return text;
      lines.splice(sectionStart + 1 + keyOffset, 1);
    } else if (keyOffset < 0) {
      let insertAt = sectionEnd;
      for (let index = sectionEnd - 1; index > sectionStart; index--) {
        if (lines[index]?.trim()) {
          insertAt = index + 1;
          break;
        }
      }
      lines.splice(insertAt, 0, `${key} = ${JSON.stringify(value)}`);
    } else {
      lines[sectionStart + 1 + keyOffset] = `${key} = ${JSON.stringify(value)}`;
    }
  } else if (rootKey >= 0) {
    if (value === null) lines.splice(rootKey, 1);
    else lines[rootKey] = `features.${key} = ${JSON.stringify(value)}`;
    preserveEmptyTable = otherRootFeature;
  } else {
    const inlineTable = rootFeatureLines.some((line) => /^\s*features\s*=/.test(line));
    if (inlineTable) throw new Error("无法安全更新 Codex features 内联表；原文件未被覆盖。");
    if (value === null) return text;
    const sibling = rootFeatureLines.reduce(
      (last, line, index) => (/^\s*features\./.test(line) ? index : last),
      -1,
    );
    if (sibling >= 0) {
      lines.splice(sibling + 1, 0, `features.${key} = ${JSON.stringify(value)}`);
      preserveEmptyTable = true;
    } else {
      const insertAt = rootEnd < 0 ? lines.length : rootEnd;
      const prefix = insertAt > 0 && lines[insertAt - 1]?.trim() ? [""] : [];
      const suffix = insertAt < lines.length && lines[insertAt]?.trim() ? [""] : [];
      lines.splice(
        insertAt,
        0,
        ...prefix,
        "[features]",
        `${key} = ${JSON.stringify(value)}`,
        ...suffix,
      );
      preserveEmptyTable = true;
    }
  }

  return checkedPatch(text, lines.join(eol).replace(/(?:\r?\n)*$/, eol), (config) => {
    const features = config.features;
    if (value === null) {
      if (!features || typeof features !== "object" || Array.isArray(features)) return;
      const table = features as Record<string, unknown>;
      delete table[key];
      if (!preserveEmptyTable && Object.keys(table).length === 0) delete config.features;
      return;
    }
    if (features === undefined) config.features = { [key]: value };
    else if (features && typeof features === "object" && !Array.isArray(features))
      (features as Record<string, unknown>)[key] = value;
    else throw new Error("Codex features 配置不是表，原文件未被覆盖。");
  });
}

/** Patch one field without serializing unrelated provider credentials or comments. */
function patchProviderField(
  text: string,
  provider: string,
  key: string,
  value: string | boolean,
): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.trimEnd().split(/\r?\n/);
  const validate = (next: string) =>
    checkedPatch(text, next, (config) => {
      const providers = (config.model_providers ??= {}) as Record<string, Record<string, unknown>>;
      const table = (providers[provider] ??= {});
      table[key] = value;
    });
  const start = lines.findIndex((line) => {
    if (!/^\s*\[(?!\[)/.test(line)) return false;
    try {
      const header = parse(`${line}\n__zcode_target = true\n`);
      const providers = header.model_providers as
        | Record<string, Record<string, unknown>>
        | undefined;
      return providers?.[provider]?.__zcode_target === true;
    } catch {
      return false;
    }
  });
  if (start < 0) {
    const parsed = parse(text);
    const providers = parsed.model_providers as Record<string, unknown> | undefined;
    if (providers && Object.hasOwn(providers, provider))
      throw new Error("Codex provider 使用了不支持的 TOML 写法；原文件未被覆盖。");
    const name = /^[\w-]+$/.test(provider) ? provider : JSON.stringify(provider);
    return validate(
      `${text.trimEnd()}${eol}${eol}[model_providers.${name}]${eol}${key} = ${JSON.stringify(value)}${eol}`.trimStart(),
    );
  }
  const next = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
  const end = next < 0 ? lines.length : next;
  const section = lines.slice(start + 1, end);
  const index = section.findIndex((line) =>
    new RegExp(`^\\s*(?:${key}|"${key}"|'${key}')\\s*=`).test(line),
  );
  if (index < 0) section.push(`${key} = ${JSON.stringify(value)}`);
  else section[index] = `${key} = ${JSON.stringify(value)}`;
  lines.splice(start + 1, end - start - 1, ...section);
  return validate(lines.join(eol).replace(/(?:\r?\n)*$/, eol));
}

/** Codex owns native credential resolution; only its explicit env dependencies survive. */
export async function applyCodexNativeEnvironment(
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const { config, auth } = parseNative(await readNativeFiles(home));
  const { name, table } = selectedProvider(config);
  // 尚无原生认证时保留已有的环境认证入口；只移除会覆盖原生默认模型的旧值。
  if (
    (!name || name === "openai") &&
    !Object.keys(table).length &&
    auth.auth_mode !== "chatgpt" &&
    !auth.OPENAI_API_KEY
  ) {
    if (typeof config.model === "string" && config.model.trim()) delete env.OPENAI_MODEL;
    return;
  }
  const referenced = new Set([
    table.env_key,
    ...Object.values(
      table.env_http_headers && typeof table.env_http_headers === "object"
        ? table.env_http_headers
        : {},
    ),
  ]);
  // 旧 OPENAI_* 覆盖会旁路当前 provider；env_key / env_http_headers 则是原生显式依赖。
  for (const key of ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"])
    if (!referenced.has(key)) delete env[key];
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
  const { config, auth } = parseNative(original);
  const before = project(original);
  const nextAuth = { ...auth };
  let authChanged = false;
  let nextConfig =
    update.model.trim() === before.model
      ? original.config
      : patchRoot(original.config, "model", update.model.trim() || null);
  if (
    update.defaultModeRequestUserInput !== undefined &&
    (update.defaultModeRequestUserInput !== before.defaultModeRequestUserInput ||
      (!update.defaultModeRequestUserInput &&
        config.features &&
        typeof config.features === "object" &&
        !Array.isArray(config.features) &&
        Object.hasOwn(config.features, "default_mode_request_user_input")))
  ) {
    nextConfig = patchFeaturesBoolean(
      nextConfig,
      "default_mode_request_user_input",
      update.defaultModeRequestUserInput ? true : null,
    );
  }
  if (update.authMode === "subscription") {
    if (before.authMode !== "subscription") {
      nextConfig = patchRoot(nextConfig, "model_provider", null);
      nextAuth.auth_mode = "chatgpt";
      nextAuth.OPENAI_API_KEY = null;
      authChanged = true;
    }
  } else {
    const url = new URL(update.apiUrl.trim());
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("API URL 必须使用 HTTP 或 HTTPS。");
    const { name } = selectedProvider(config);
    const provider = name || ZCODE_PROVIDER;
    if (!name) {
      nextConfig = patchRoot(nextConfig, "model_provider", provider);
      const providers = config.model_providers as Record<string, unknown> | undefined;
      if (!providers?.[provider]) {
        for (const [key, value] of [
          ["name", PRODUCT_NAME],
          ["wire_api", "responses"],
          ["requires_openai_auth", true],
        ] as const)
          nextConfig = patchProviderField(nextConfig, provider, key, value);
      }
    }
    // 只改模型不能触碰 provider 认证；URL 也只在用户确实修改时原位更新。
    if (!name || update.apiUrl.trim() !== before.apiUrl)
      nextConfig = patchProviderField(nextConfig, provider, "base_url", update.apiUrl.trim());
    const source = credential(
      parseNative({ config: nextConfig, auth: original.auth }).config,
      auth,
    );
    const key = update.apiKey?.trim();
    if (key !== undefined && (key !== before.apiKey || !name)) {
      if (source.source === "external")
        throw new Error("此 provider 的凭据由环境变量或 headers 管理，请在 Codex 原生配置中修改。");
      if (source.source === "provider")
        nextConfig = patchProviderField(nextConfig, provider, "experimental_bearer_token", key);
      else {
        nextAuth.auth_mode = "apikey";
        if (key) nextAuth.OPENAI_API_KEY = key;
        else delete nextAuth.OPENAI_API_KEY;
        authChanged = true;
      }
    }
    if (!name && source.source === "auth" && !(key ?? source.value))
      throw new Error("自定义接口需要 API Key；原文件未被覆盖。");
    if (!name && source.source === "auth" && nextAuth.auth_mode !== "apikey") {
      nextAuth.auth_mode = "apikey";
      authChanged = true;
    }
  }
  const updated = {
    config: nextConfig,
    auth: authChanged ? `${JSON.stringify(nextAuth, null, 2)}\n` : original.auth,
  };
  parseNative(updated);
  // 修复原因：Codex CLI 或另一个窗口可能在表单打开后更新凭据；旧版本不能覆盖新文件。
  if (version(await readNativeFiles(home)) !== update.expectedVersion)
    throw new Error("Codex 原生配置已变更，请刷新后重试；未覆盖新配置。");
  if (updated.config !== original.config)
    await atomicWrite(join(home, "config.toml"), updated.config);
  if (updated.auth !== original.auth) await atomicWrite(join(home, "auth.json"), updated.auth);
  return readCodexNativeConfig(home);
}
