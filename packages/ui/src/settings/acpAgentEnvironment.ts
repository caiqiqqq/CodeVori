import {
  ACP_GEMINI_AUTH_MODES,
  type AcpGeminiAuthMode,
  type AcpAgent,
  type AcpAgentInfo,
} from "@zcode/shared";

export type AcpEnvField = {
  key: string;
  label:
    | "credential"
    | "apiKey"
    | "url"
    | "model"
    | "gatewayToken"
    | "sessionKey"
    | "command"
    | "authMethod"
    | "project"
    | "location"
    | "credentialsFile";
  secret?: boolean;
  options?: readonly string[];
};

/** Codeg's effective env names; native-file and ACP session options do not become fake env fields. */
export const ACP_AGENT_ENV_FIELDS = {
  claude: [
    { key: "ANTHROPIC_AUTH_TOKEN", label: "credential", secret: true },
    { key: "ANTHROPIC_API_KEY", label: "apiKey", secret: true },
    { key: "ANTHROPIC_BASE_URL", label: "url" },
    { key: "ANTHROPIC_MODEL", label: "model" },
  ],
  codex: [],
  gemini: [
    {
      key: "ZCODE_GEMINI_AUTH_MODE",
      label: "authMethod",
      options: ACP_GEMINI_AUTH_MODES,
    },
    { key: "GEMINI_MODEL", label: "model" },
    { key: "GEMINI_API_KEY", label: "credential", secret: true },
    { key: "GOOGLE_GEMINI_BASE_URL", label: "url" },
    { key: "GOOGLE_API_KEY", label: "apiKey", secret: true },
    { key: "GOOGLE_CLOUD_PROJECT", label: "project" },
    { key: "GOOGLE_CLOUD_LOCATION", label: "location" },
    { key: "GOOGLE_APPLICATION_CREDENTIALS", label: "credentialsFile" },
  ],
  openclaw: [
    { key: "OPENCLAW_GATEWAY_URL", label: "url" },
    { key: "OPENCLAW_GATEWAY_TOKEN", label: "gatewayToken", secret: true },
    { key: "OPENCLAW_SESSION_KEY", label: "sessionKey" },
  ],
  opencode: [],
  cline: [],
  hermes: [],
  codebuddy: [
    { key: "CODEBUDDY_API_KEY", label: "credential", secret: true },
    { key: "CODEBUDDY_BASE_URL", label: "url" },
  ],
  "kimi-code": [
    { key: "KIMI_MODEL_API_KEY", label: "credential", secret: true },
    { key: "KIMI_MODEL_BASE_URL", label: "url" },
    { key: "KIMI_MODEL_NAME", label: "model" },
  ],
  pi: [{ key: "PI_ACP_PI_COMMAND", label: "command" }],
  grok: [
    { key: "XAI_API_KEY", label: "credential", secret: true },
    { key: "GROK_XAI_API_BASE_URL", label: "url" },
    { key: "GROK_DEFAULT_MODEL", label: "model" },
  ],
  cursor: [{ key: "CURSOR_API_KEY", label: "credential", secret: true }],
  deepseek: [
    { key: "DEEPSEEK_API_KEY", label: "credential", secret: true },
    { key: "DEEPSEEK_BASE_URL", label: "url" },
    { key: "DEEPSEEK_ACP_MODEL", label: "model" },
  ],
  qoder: [{ key: "QODER_PERSONAL_ACCESS_TOKEN", label: "credential", secret: true }],
  antigravity: [
    {
      key: "AGY_AUTH_METHOD",
      label: "authMethod",
      options: ["oauth-personal", "oauth-business", "gemini-api-key", "agent-platform"],
    },
    { key: "GEMINI_API_KEY", label: "credential", secret: true },
    { key: "GOOGLE_API_KEY", label: "credential", secret: true },
    { key: "GOOGLE_CLOUD_PROJECT", label: "project" },
    { key: "GOOGLE_CLOUD_LOCATION", label: "location" },
    { key: "AGY_ACP_DEFAULT_MODEL", label: "model" },
  ],
} as const satisfies Record<AcpAgent, readonly AcpEnvField[]>;

/** Read an unfinished advanced draft without losing the currently edited line. */
export function acpEnvValue(text: string, key: string): string {
  let value = "";
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trimStart().startsWith("#")) continue;
    const separator = rawLine.indexOf("=");
    if (separator > 0 && rawLine.slice(0, separator).trim() === key)
      value = rawLine.slice(separator + 1);
  }
  return value;
}

/** Patch only one env key in the shared draft; preserve comments and partial lines verbatim. */
export function patchAcpEnvText(text: string, key: string, value: string): string {
  const lines = text ? text.split(/\r?\n/) : [];
  const next: string[] = [];
  let inserted = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    const separator = trimmed.startsWith("#") ? -1 : line.indexOf("=");
    if (separator < 1 || line.slice(0, separator).trim() !== key) {
      next.push(line);
    } else if (value && !inserted) {
      next.push(`${key}=${value}`);
      inserted = true;
    }
  }
  if (value && !inserted) next.push(`${key}=${value}`);
  return next.join("\n");
}

/** Codeg infers legacy credentials for display only; opening the panel does not save a mode. */
export function inferAcpGeminiAuthMode(text: string): AcpGeminiAuthMode {
  const explicit = acpEnvValue(text, "ZCODE_GEMINI_AUTH_MODE");
  if (ACP_GEMINI_AUTH_MODES.includes(explicit as AcpGeminiAuthMode))
    return explicit as AcpGeminiAuthMode;
  if (acpEnvValue(text, "GOOGLE_GEMINI_BASE_URL").trim()) return "custom";
  if (acpEnvValue(text, "GEMINI_API_KEY").trim()) return "gemini_api_key";
  if (acpEnvValue(text, "GOOGLE_API_KEY").trim()) return "vertex_api_key";
  if (acpEnvValue(text, "GOOGLE_APPLICATION_CREDENTIALS").trim()) return "vertex_service_account";
  if (
    acpEnvValue(text, "GOOGLE_CLOUD_PROJECT").trim() ||
    acpEnvValue(text, "GOOGLE_CLOUD_LOCATION").trim()
  )
    return "vertex_adc";
  return "login_google";
}

/** Keep saved credentials aligned with the explicit auth method. */
export function normalizeAcpAgentEnvText(agent: AcpAgent, text: string): string {
  if (agent === "gemini") {
    const method = acpEnvValue(text, "ZCODE_GEMINI_AUTH_MODE");
    const allowed: Record<string, readonly string[]> = {
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
      model_provider: ["ZCODE_GEMINI_PROVIDER_ID"],
    };
    if (!Object.hasOwn(allowed, method)) return text; // Legacy Gemini retains its native auth mode.
    // 修复原因：模式切换后高级文本若保留另一种 Key，Gemini CLI 可能从环境自动选择旧认证。
    return [
      "GEMINI_API_KEY",
      "GOOGLE_GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "GOOGLE_GEMINI_BASE_URL",
      "GEMINI_BASE_URL",
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_CLOUD_PROJECT_ID",
      "GOOGLE_CLOUD_LOCATION",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GOOGLE_GENAI_USE_GCA",
      "GOOGLE_GENAI_USE_VERTEXAI",
      "ZCODE_GEMINI_PROVIDER_ID",
      ...(method === "model_provider" ? ["GEMINI_MODEL"] : []),
    ].reduce(
      (draft, key) => (allowed[method]!.includes(key) ? draft : patchAcpEnvText(draft, key, "")),
      text,
    );
  }
  if (agent !== "antigravity") return text;
  const method = acpEnvValue(text, "AGY_AUTH_METHOD");
  if (!method) return text; // Native settings.json still owns legacy/default authentication.
  const removed =
    method === "gemini-api-key"
      ? ["GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"]
      : method === "agent-platform"
        ? acpEnvValue(text, "GOOGLE_API_KEY").trim()
          ? ["GEMINI_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"]
          : ["GEMINI_API_KEY"]
        : method === "oauth-business"
          ? ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
          : method === "oauth-personal"
            ? ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"]
            : [];
  // 修复原因：认证方式变了，旧密钥若留在保存行会和新方式及启动凭据隔离规则相矛盾。
  return removed.reduce((draft, key) => patchAcpEnvText(draft, key, ""), text);
}

/** Structured Gemini edits choose the matching auth mode instead of leaving a new Key under old OAuth. */
export function patchAcpAgentFieldText(
  agent: AcpAgent,
  text: string,
  key: string,
  value: string,
): string {
  let next = patchAcpEnvText(text, key, value);
  if (
    agent === "gemini" &&
    !acpEnvValue(text, "ZCODE_GEMINI_AUTH_MODE") &&
    value &&
    (key === "GEMINI_API_KEY" || key === "GOOGLE_GEMINI_BASE_URL")
  ) {
    // 修复原因：新填 Key 若仍保留原生 OAuth selectedType，Gemini CLI 可能忽略刚保存的 Key。
    const mode =
      key === "GOOGLE_GEMINI_BASE_URL" || acpEnvValue(next, "GOOGLE_GEMINI_BASE_URL")
        ? "custom"
        : "gemini_api_key";
    next = patchAcpEnvText(next, "ZCODE_GEMINI_AUTH_MODE", mode);
  }
  return normalizeAcpAgentEnvText(agent, next);
}

/** Only the exact submitted draft can be discarded after an asynchronous Host save. */
export function clearAcpEnvDraftIfUnchanged(
  current: string | undefined,
  submitted: string,
): string | undefined {
  return current === submitted ? undefined : current;
}

/** Qoder's managed npm entry is launched through Node rather than assuming it is on PATH. */
export function acpQoderLoginCommand(
  info: Pick<AcpAgentInfo, "source" | "executablePath" | "distribution">,
): string {
  if (!info.executablePath) return "qoder login";
  const path = info.executablePath;
  const quoted = /^[A-Za-z]:[\\/]|^\\\\/.test(path)
    ? `"${path.replaceAll('"', '""')}"`
    : `'${path.replaceAll("'", "'\\''")}'`;
  return `${info.source === "managed" && info.distribution === "npm" ? "node " : ""}${quoted} login`;
}
