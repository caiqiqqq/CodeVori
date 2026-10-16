export type MobileConnection = {
  readonly origin: string;
  readonly token: string;
};

export type ConnectionParseResult =
  | { readonly ok: true; readonly connection: MobileConnection }
  | { readonly ok: false; readonly reason: string };

function isLanHttpHost(hostname: string): boolean {
  if (hostname.endsWith(".local")) return true;
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  )
    return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function normalizeOrigin(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      url.pathname !== "/"
    )
      return null;
    if (url.protocol === "http:" && !isLanHttpHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function parseConnectionInput(address: string, token: string): ConnectionParseResult {
  const url = normalizeOrigin(address);
  const normalizedToken = token.trim();
  if (!url) {
    return { ok: false, reason: "请输入有效的 HTTP 或 HTTPS Web 地址。" };
  }
  if (!normalizedToken) {
    return { ok: false, reason: "请输入桌面 Web 服务的访问 Token。" };
  }
  return { ok: true, connection: { origin: url.toString(), token: normalizedToken } };
}

/** 扫码与完整链接粘贴共用校验，避免把远控/开发链接或额外参数误当作 LAN 连接。 */
export function parsePairingLink(value: string): ConnectionParseResult {
  const invalid: ConnectionParseResult = {
    ok: false,
    reason: "请使用桌面「局域网手机访问」中的完整连接链接或二维码。",
  };
  try {
    const url = new URL(value.trim());
    const tokens = url.searchParams.getAll("token");
    if (tokens.length !== 1 || [...url.searchParams.keys()].some((key) => key !== "token"))
      return invalid;
    url.search = "";
    const parsed = parseConnectionInput(url.toString(), tokens[0]);
    return parsed.ok ? parsed : invalid;
  } catch {
    return invalid;
  }
}

export function parsePairingInput(address: string, token: string): ConnectionParseResult {
  if (!address.includes("?")) return parseConnectionInput(address, token);
  const parsed = parsePairingLink(address);
  if (parsed.ok && token.trim() && token.trim() !== parsed.connection.token) {
    return {
      ok: false,
      reason: "链接中的 Token 与输入的 Token 不一致，请清空 Token 或使用同一份凭据。",
    };
  }
  return parsed;
}

export function buildAuthenticatedUrl(connection: MobileConnection): string {
  const url = new URL(connection.origin);
  url.searchParams.set("token", connection.token);
  return url.toString();
}

export function isSameOrigin(candidate: string, origin: string): boolean {
  try {
    return new URL(candidate).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}
