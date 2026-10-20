import type { PrivateGitAccount } from "../repo/versionControlRepo.js";

export function matchingGitAccounts(
  accounts: PrivateGitAccount[],
  remoteUrl: string,
): PrivateGitAccount[] {
  let remote: URL;
  let username: string;
  try {
    remote = new URL(remoteUrl);
    username = decodeURIComponent(remote.username);
  } catch {
    return [];
  }
  if (!["http:", "https:"].includes(remote.protocol) || remote.password) return [];
  return accounts
    .filter((account) => {
      const server = new URL(account.serverUrl);
      const basePath = server.pathname.replace(/\/$/, "");
      return (
        server.protocol === remote.protocol &&
        server.host === remote.host &&
        (!username || username === account.username) &&
        (!basePath || remote.pathname === basePath || remote.pathname.startsWith(`${basePath}/`))
      );
    })
    .sort(
      (a, b) =>
        new URL(b.serverUrl).pathname.length - new URL(a.serverUrl).pathname.length ||
        Number(b.isDefault) - Number(a.isDefault),
    );
}

// Git 的 credential 协议传入目标 URL；helper 只向匹配服务器返回凭据，不写磁盘或 argv。
const HELPER_SOURCE = `
if (process.argv[1] === 'get') {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    try {
      const fields = Object.fromEntries(input.trim().split('\\n').map(line => {
        const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
      }));
      const remote = new URL(fields.protocol + '://' + fields.host + '/' + (fields.path || ''));
      const accounts = JSON.parse(process.env.ZCODE_GIT_CREDENTIALS || '[]');
      const account = accounts.find(a => {
        const server = new URL(a.serverUrl);
        const base = server.pathname.replace(/\\/$/, '');
        return server.protocol === remote.protocol && server.host === remote.host &&
          (!fields.username || fields.username === a.username) &&
          (!base || remote.pathname === base || remote.pathname.startsWith(base + '/'));
      });
      if (account) process.stdout.write('username=' + account.username + '\\npassword=' + account.secret + '\\n\\n');
    } catch { process.exitCode = 1; }
  });
}`;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function createGitCredentialEnv(
  accounts: PrivateGitAccount[],
  remoteUrls: string[],
  existingEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const selected = remoteUrls.flatMap((url) => matchingGitAccounts(accounts, url));
  const unique = [...new Map(selected.map((account) => [account.id, account])).values()].sort(
    (a, b) =>
      new URL(b.serverUrl).pathname.length - new URL(a.serverUrl).pathname.length ||
      Number(b.isDefault) - Number(a.isDefault),
  );
  if (!unique.length) return {};
  const count = Number(existingEnv.GIT_CONFIG_COUNT ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid Git config environment");
  const helper = `!${shellQuote(process.execPath.replace(/\\/g, "/"))} -e ${shellQuote(HELPER_SOURCE)}`;
  // 多个 pushurl 可能包含未配置账号的服务器；只能覆盖匹配 URL 的 helper，保留其他认证。
  const matchedUrls = [
    ...new Set(remoteUrls.filter((url) => matchingGitAccounts(accounts, url).length)),
  ];
  const configuration: Array<[string, string]> = matchedUrls.flatMap((url) => [
    [`credential.${url}.helper`, ""],
    [`credential.${url}.helper`, helper],
    [`credential.${url}.useHttpPath`, "true"],
    [`http.${url}.followRedirects`, "false"],
  ]);
  return {
    ...Object.fromEntries(
      configuration.flatMap(([key, value], index) => [
        [`GIT_CONFIG_KEY_${count + index}`, key],
        [`GIT_CONFIG_VALUE_${count + index}`, value],
      ]),
    ),
    GIT_CONFIG_COUNT: String(count + configuration.length),
    GIT_TERMINAL_PROMPT: "0",
    ELECTRON_RUN_AS_NODE: "1",
    ZCODE_GIT_CREDENTIALS: JSON.stringify(unique),
  };
}
