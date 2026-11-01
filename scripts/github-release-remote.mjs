import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const github = (...args) => exec("gh", args, { maxBuffer: 2_000_000 });
const repository = () => {
  const value = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(value ?? "")) throw new Error("Invalid GITHUB_REPOSITORY");
  return value;
};

export async function findReleaseByTag(tag, gh = github) {
  // 原因：GitHub 按标签查询草稿会返回 404；列表 API 包含有权限访问的草稿。
  // 逐页匹配真实 tag_name，后续按 ID 读取，不能把最新 Release 当成本次目标。
  for (let page = 1; ; page += 1) {
    const releases = JSON.parse(
      (await gh("api", `repos/${repository()}/releases?per_page=100&page=${page}`)).stdout,
    );
    const matches = releases.filter((release) => release.tag_name === tag);
    if (matches.length > 1) throw new Error(`Duplicate release tag: ${tag}`);
    if (matches.length === 1) {
      const release = JSON.parse(
        (await gh("api", `repos/${repository()}/releases/${matches[0].id}`)).stdout,
      );
      if (release.tag_name !== tag) throw new Error("Release tag changed during lookup");
      return release;
    }
    if (releases.length < 100) throw new Error(`Release not found: ${tag}`);
  }
}

export async function readReleaseAsset(asset, gh = github) {
  const { stdout } = await gh(
    "api",
    `repos/${repository()}/releases/assets/${asset.id}`,
    "-H",
    "Accept: application/octet-stream",
  );
  if (asset.digest !== `sha256:${createHash("sha256").update(stdout).digest("hex")}`)
    throw new Error(`Remote asset checksum mismatch: ${asset.name}`);
  return stdout;
}

export async function hasReleaseAssets(release, names, checksumName, gh = github) {
  const assets = new Map();
  for (const asset of release.assets) {
    if (assets.has(asset.name)) throw new Error(`Duplicate remote asset: ${asset.name}`);
    assets.set(asset.name, asset);
  }
  const selected = [...names, checksumName];
  if (selected.some((name) => !assets.has(name))) return false;
  const table = (await readReleaseAsset(assets.get(checksumName), gh)).trim().split(/\r?\n/);
  const hashes = new Map();
  for (const line of table) {
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    if (!match || hashes.has(match[2])) throw new Error(`Invalid checksum table: ${checksumName}`);
    hashes.set(match[2], match[1]);
  }
  if (hashes.size !== names.length || names.some((name) => !hashes.has(name)))
    throw new Error(`Unexpected checksum entries: ${checksumName}`);
  for (const name of names) {
    const asset = assets.get(name);
    if (
      asset.state !== "uploaded" ||
      asset.size <= 0 ||
      asset.digest !== `sha256:${hashes.get(name)}`
    )
      throw new Error(`Remote asset integrity mismatch: ${name}`);
  }
  return true;
}
