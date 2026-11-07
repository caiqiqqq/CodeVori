import { copyFile, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join } from "node:path";
import { CliError, localError } from "./site-client.mjs";
const BINDING_FILE = ".codevori-site.json";
const LEGACY_BINDING_FILE = ".zcode-site.json";
async function prepareBinding(cwd) {
  try {
    await copyFile(join(cwd, LEGACY_BINDING_FILE), join(cwd, BINDING_FILE), constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EEXIST") throw error;
  }
}

export async function readBinding(cwd) {
  await prepareBinding(cwd);
  let text;
  try {
    text = await readFile(join(cwd, BINDING_FILE), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return undefined;
    throw err;
  }
  try {
    const b = JSON.parse(text);
    if (typeof b.siteId === "string" && b.siteId) return b;
  } catch {
    // 落到下面统一报错
  }
  throw localError(
    "INVALID_BINDING",
    `${BINDING_FILE} is not valid`,
    `Fix or delete ${BINDING_FILE}, or pass --site <id>.`,
  );
}

export async function writeBinding(cwd, site) {
  await prepareBinding(cwd);
  await writeFile(
    join(cwd, BINDING_FILE),
    `${JSON.stringify({ siteId: site.id, domainLabel: site.domainLabel }, null, 2)}\n`,
  );
}

export async function allSites(client) {
  const items = [];
  let cursor;
  do {
    const page = await client.listSites(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

export function candidates(sites) {
  return sites.map((s) => ({ id: s.id, name: s.name, url: s.url, status: s.status }));
}

// resolveSite 的规则：--site > 绑定文件 > 账户下没有站点时（只限 deploy）新建；已有站点时报错并给出候选，不按名字匹配，也不自动新建。
export async function resolveSite(ctx, { allowCreate }) {
  const { client, cwd, opts } = ctx;
  if (opts.site) return { site: await client.getSite(opts.site), bound: false };
  const binding = await readBinding(cwd);
  if (binding) return { site: await client.getSite(binding.siteId), bound: true };
  if (allowCreate && opts.new)
    return {
      site: await client.createSite(siteName(ctx), opts.prefix),
      bound: false,
      created: true,
    };
  const sites = await allSites(client);
  if (allowCreate && sites.length === 0)
    return {
      site: await client.createSite(siteName(ctx), opts.prefix),
      bound: false,
      created: true,
    };
  throw new CliError(
    "SITE_NOT_SELECTED",
    sites.length ? "This project is not linked to a site" : "You have no sites yet",
    allowCreate
      ? "Ask the user which site to update, then retry with --site <id>, or with --new to create a new site."
      : "Pass --site <id>, or deploy first.",
    1,
    { candidates: candidates(sites) },
  );
}

export function siteName(ctx) {
  return (ctx.opts.name ?? basename(ctx.cwd)).trim() || "site";
}

// normalizePrefix 与服务端 site.NormalizePrefix 同一规则（技术方案 5.4），只用来提前告诉 Agent 实际会得到的前缀；
// 发给服务端的仍是原值，以服务端规范化的结果为准。
export function normalizePrefix(prefix) {
  let s = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > 30) s = s.slice(0, 30).replace(/-+$/, "");
  return s.length < 4 ? "site" : s;
}

// --prefix 只在本次新建站点时生效；不合规时提示规范化结果，但不拦截，交给服务端兜底。
// 前缀（没有 --prefix 时是名称）没有通过服务端机审时，服务端换成 site，按返回的 domainLabel 提示（契约 0.15.0）。
export function prefixNotice(opts, created, site) {
  if (!created)
    return opts.prefix === undefined
      ? undefined
      : "--prefix is ignored: the site already exists and its domain never changes.";
  const expected = normalizePrefix(opts.prefix ?? site.name);
  if (expected !== "site" && !site.domainLabel.startsWith(`${expected}-`))
    return `The domain prefix ${JSON.stringify(expected)} did not pass content review, so the server used "site": the domain is ${site.url} and never changes.`;
  if (opts.prefix === undefined) return undefined;
  const normalized = expected;
  if (normalized === opts.prefix) return undefined;
  return normalized === "site"
    ? `--prefix ${JSON.stringify(opts.prefix)} has fewer than 4 usable [a-z0-9-] characters; the server falls back to "site".`
    : `--prefix ${JSON.stringify(opts.prefix)} is normalized to ${JSON.stringify(normalized)}.`;
}

// ---------- deploy ----------
