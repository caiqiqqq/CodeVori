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
