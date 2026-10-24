import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assertRemoteReleaseSource, fileHash, validateSource } from "./github-release.mjs";
import { validateClientRelease } from "./publish-device-node.mjs";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "dist-device-node");
const marker = "device-node-manifest.json";
const checksumName = "SHA256SUMS-device-node";
const exec = promisify(execFile);

function assertSource(manifest, context) {
  if (manifest.source !== context.commit || manifest.dirty !== false)
    throw new Error("Client source mismatch or dirty build");
}

export async function collectNodeAssets(directory, destination, context) {
  const manifest = await validateClientRelease(directory);
  assertSource(manifest, context);
  await mkdir(destination, { recursive: true });
  for (const { name } of manifest.files)
    await copyFile(join(directory, name), join(destination, name));
  await copyFile(join(directory, "LICENSE.txt"), join(destination, "CodeVoriNode-LICENSE.txt"));
  await copyFile(join(directory, "manifest.json"), join(destination, marker));
  const files = await verifyNodeAssets(destination, context);
  await writeFile(
    join(destination, checksumName),
    files.map((file) => `${file.sha256}  ${file.name}\n`).join(""),
  );
}

export async function verifyNodeAssets(directory, context) {
  // 复用手工发布器的六平台校验，清单文件名通过显式参数传递，避免临时复制引入脏文件。
  const manifest = await validateClientRelease(directory, marker);
  assertSource(manifest, context);
  const names = [...manifest.files.map(({ name }) => name), "CodeVoriNode-LICENSE.txt", marker];
  if ((await readdir(directory)).some((name) => ![...names, checksumName].includes(name)))
    throw new Error("Unexpected files in client release");
  const files = [];
  for (const name of names) {
    const size = (await stat(join(directory, name))).size;
    if (!size) throw new Error(`Empty client asset: ${name}`);
    files.push({ name, size, sha256: await fileHash(join(directory, name)) });
  }
  const sums = await readFile(join(directory, checksumName), "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (sums !== null && sums !== files.map((f) => `${f.sha256}  ${f.name}\n`).join(""))
    throw new Error("Client checksum table integrity mismatch");
  return files;
}

export async function uploadNodeAssets(context, directory, files, existing, gh) {
  const sums = {
    name: checksumName,
    size: (await stat(join(directory, checksumName))).size,
    sha256: await fileHash(join(directory, checksumName)),
  };
  const selected = [...files, sums];
  // 客户端版本目录不可变；重跑只补缺失资产，不能 --clobber 让清单与已下载文件分叉。
  for (const file of selected) {
    const matches = existing.filter((asset) => asset.name === file.name);
    if (
      matches.length > 1 ||
      matches.some((a) => a.size !== file.size || a.digest !== `sha256:${file.sha256}`)
    )
      throw new Error(`Immutable client release conflict: ${file.name}`);
  }
  const missing = selected.filter((f) => !existing.some((a) => a.name === f.name));
  const payload = missing.filter((f) => f.name !== marker);
  if (payload.length)
    await gh(
      "release",
      "upload",
      context.tag,
      ...payload.map((f) => join(directory, f.name)),
      "--repo",
      process.env.GITHUB_REPOSITORY,
    );
  // 清单最后到达，服务器只在整个白名单齐全且校验通过后发布。
  if (missing.some((f) => f.name === marker))
    await gh(
      "release",
      "upload",
      context.tag,
      join(directory, marker),
      "--repo",
      process.env.GITHUB_REPOSITORY,
    );
}

async function main() {
  const context = await validateSource();
  switch (process.argv[2]) {
    case "collect": {
      const { version } = JSON.parse(
        await readFile(join(root, "scripts/device-node-version.json"), "utf8"),
      );
      await collectNodeAssets(join(root, "output/device-node/clients", version), output, context);
      break;
    }
    case "verify":
    case "publish": {
      const files = await verifyNodeAssets(output, context);
      // 发布必须有校验表；collect 内首次校验允许文件尚未创建。
      await stat(join(output, checksumName));
      if (process.argv[2] === "verify") break;
      const gh = (...args) => exec("gh", args, { cwd: root, maxBuffer: 2_000_000 });
      await assertRemoteReleaseSource(context, gh);
      const release = JSON.parse(
        (await gh("api", `repos/${process.env.GITHUB_REPOSITORY}/releases/tags/${context.tag}`))
          .stdout,
      );
      await uploadNodeAssets(context, output, files, release.assets, gh);
      break;
    }
    default:
      throw new Error("Use collect|verify|publish");
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
