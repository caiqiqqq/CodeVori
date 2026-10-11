/** 域名选择规则由所有网络出口复用，避免浏览器、Host 与工具分流结果不同。 */
export function normalizeProxyOnlyDomains(value: string | undefined): string | undefined {
  const input = value?.trim();
  if (!input) return undefined;
  const tokens = input.split(/,|\r?\n/);
  if (tokens.length > 64) throw new Error("Invalid proxy domains: at most 64 rules");
  const rules = tokens.map((token) => {
    const raw = token.trim().toLowerCase().replace(/\.$/, "");
    const wildcard = raw.startsWith("*.");
    const domain = wildcard ? raw.slice(2) : raw;
    if (!domain || /[\s:/?#@\\*[\]%]/.test(domain))
      throw new Error("Invalid proxy domain: use a hostname or *.hostname");
    const hostname = new URL(`http://${domain}`).hostname;
    if (
      hostname.length > 253 ||
      hostname.split(".").some((label) => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label))
    )
      throw new Error("Invalid proxy domain: malformed hostname");
    return `${wildcard ? "*." : ""}${hostname}`;
  });
  return [...new Set(rules)].join(",");
}

export function matchesProxyOnlyDomains(hostname: string, domains: string | undefined): boolean {
  const rules = normalizeProxyOnlyDomains(domains);
  if (!rules) return true;
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return rules
    .split(",")
    .some((rule) => (rule.startsWith("*.") ? host.endsWith(rule.slice(1)) : host === rule));
}

export interface ProxyBypassRule {
  host: string;
  port?: string;
}

export function parseProxyBypassRules(value: string | undefined): ProxyBypassRule[] {
  return (value ?? "").split(/[\s,]+/).flatMap((raw) => {
    if (!raw) return [];
    if (raw === "*") return [{ host: "*" }];
    try {
      const url = new URL(
        raw.includes("://") ? raw : `http://${raw.replace(/^\*\./, "").replace(/^\./, "")}`,
      );
      return [
        {
          host: url.hostname
            .toLowerCase()
            .replace(/^\[|\]$/g, "")
            .replace(/\.$/, ""),
          port: raw.match(/:(\d+)(?:\/.*)?$/)?.[1] || url.port || undefined,
        },
      ];
    } catch {
      return [];
    }
  });
}

export function matchesProxyBypass(url: URL, rules: ProxyBypassRule[]): boolean {
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return rules.some(
    (rule) =>
      rule.host === "*" ||
      ((!rule.port || rule.port === port) &&
        (host === rule.host || host.endsWith(`.${rule.host}`))),
  );
}
