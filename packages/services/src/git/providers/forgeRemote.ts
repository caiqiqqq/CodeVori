import { createHash } from "node:crypto";
import type { ForgeProvider, ForgeRepository } from "@zcode/shared";
import type { PrivateGitAccount } from "../repo/versionControlRepo.js";

export interface ParsedForgeRemote {
  protocol: string;
  hostname: string;
  host: string;
  path: string;
  ssh: boolean;
}

export function parseForgeRemote(raw: string): ParsedForgeRemote | null {
  try {
    const scp = raw.match(/^(?:[^/@]+@)?(\[[^\]]+\]|[^/:]+):(.+)$/);
    const url = new URL(raw.includes("://") ? raw : scp ? `ssh://${scp[1]}/${scp[2]}` : raw);
    if (!["http:", "https:", "ssh:"].includes(url.protocol) || url.search || url.hash) return null;
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    const segments = path.split("/").map(decodeURIComponent);
    if (
      segments.length < 2 ||
      segments.some(
        (segment) =>
          // eslint-disable-next-line no-control-regex -- 拒绝 Git 远端路径中的控制字符，避免进入 API URL。
          !segment || [".", ".."].includes(segment) || /[\\/\u0000-\u001f]/.test(segment),
      )
    )
      return null;
    return {
      protocol: url.protocol,
      hostname: url.hostname,
      host: url.host,
      path: segments.join("/"),
      ssh: url.protocol === "ssh:",
    };
  } catch {
    return null;
  }
}

function serverBasePath(account: PrivateGitAccount): string {
  return new URL(account.serverUrl).pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map(decodeURIComponent)
    .join("/");
}

export function selectForgeAccount(
  remote: ParsedForgeRemote,
  accounts: PrivateGitAccount[],
  accountId?: string,
): PrivateGitAccount | null {
  return (
    accounts
      .filter((account) => {
        if (account.provider === "git" || (accountId && account.id !== accountId)) return false;
        const server = new URL(account.serverUrl);
        const base = serverBasePath(account);
        return (
          (remote.ssh
            ? server.hostname === remote.hostname
            : server.protocol === remote.protocol && server.host === remote.host) &&
          (!base || remote.path.startsWith(`${base}/`))
        );
      })
      .sort(
        (left, right) =>
          serverBasePath(right).length - serverBasePath(left).length ||
          Number(right.isDefault) - Number(left.isDefault),
      )[0] ?? null
  );
}

export function knownForgeProvider(remote: ParsedForgeRemote): ForgeProvider | null {
  return remote.hostname === "github.com"
    ? "github"
    : remote.hostname === "gitlab.com"
      ? "gitlab"
      : remote.hostname === "codeberg.org"
        ? "gitea"
        : null;
}

export function forgeRepository(
  remote: ParsedForgeRemote,
  account: PrivateGitAccount,
): { repository: ForgeRepository; apiBase: string } | null {
  const server = new URL(account.serverUrl);
  const base = serverBasePath(account);
  const name = base ? remote.path.slice(base.length + 1) : remote.path;
  if (
    (account.provider !== "gitlab" && name.split("/").length !== 2) ||
    name.split("/").length < 2 ||
    account.provider === "git"
  )
    return null;
  const serverUrl = account.serverUrl.replace(/\/+$/, "");
  const apiBase =
    account.provider === "github"
      ? serverUrl === "https://github.com"
        ? "https://api.github.com"
        : `${serverUrl}/api/v3`
      : `${serverUrl}/api/${account.provider === "gitlab" ? "v4" : "v1"}`;
  return {
    repository: {
      key: createHash("sha256")
        .update(JSON.stringify([account.provider, server.href, name, account.id]))
        .digest("hex"),
      name,
      url: `${serverUrl}/${name.split("/").map(encodeURIComponent).join("/")}`,
      provider: account.provider,
      accountId: account.id,
      accountUsername: account.username,
    },
    apiBase,
  };
}
