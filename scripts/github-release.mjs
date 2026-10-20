import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const assetsDirectory = resolve(root, "dist-release");
export const releaseTargets = ["mac-arm64", "mac-x64", "win-x64", "linux-x64"];
export const mobileReleaseTargets = ["android-arm64-test", "ios-simulator-arm64"];
const extensions = {
  mac: ["dmg", "zip"],
  win: ["exe"],
  linux: ["AppImage", "deb", "rpm", "pkg.tar.zst"],
};

export function releaseVersion(tag, version) {
  if (
    !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(
      tag ?? "",
    )
  ) {
    throw new Error("Release tag must be a version such as v0.0.1");
  }
  if (tag.slice(1) !== version) throw new Error("Release tag does not match package.json version");
  return version;
}

export function artifactNames(version, target) {
  if (target === "android-arm64-test") return [`CodeVori-${version}-android-arm64-test.apk`];
  if (target === "ios-simulator-arm64") return [`CodeVori-${version}-ios-simulator-arm64.app.zip`];
  if (!releaseTargets.includes(target)) throw new Error(`Unsupported release target: ${target}`);
  const [os, arch] = target.split("-");
  // electron-builder 会按 Linux 包格式替换架构名称；必须与真实打包结果一致，
  // 否则安装包已构建成功却在收集阶段因找不到 x64 文件而失败。
  const linuxArchitectures = { AppImage: "x86_64", deb: "amd64", rpm: "x86_64" };
  return extensions[os].map((extension) => {
    const artifactArch = os === "linux" ? linuxArchitectures[extension] || arch : arch;
    return `CodeVori-${version}-${os}-${artifactArch}.${extension}`;
  });
}

export async function fileHash(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function validateSource({ allowUntagged = false } = {}) {
  const tag = process.env.RELEASE_TAG || null;
  const { version } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  releaseVersion(allowUntagged && !tag ? `v${version}` : tag, version);
  const git = async (...args) => (await exec("git", args, { cwd: root })).stdout.trim();
  const commit = await git("rev-parse", "HEAD");
  if (tag && (await git("rev-parse", `refs/tags/${tag}^{commit}`)) !== commit) {
    throw new Error("Checkout does not match the release tag");
  }
  return { tag, version, commit };
}

async function collectAssets(context) {
  const target = `${process.env.ZCODE_TARGET_OS}-${process.env.ZCODE_TARGET_ARCH}`;
  const names = artifactNames(context.version, target);
  const metadata = JSON.parse(
    await readFile(resolve(root, "packages/desktop/out/metadata/build-meta.json"), "utf8"),
  );
  if (
    metadata.appVersion !== context.version ||
    metadata.buildCommitId !== context.commit.slice(0, 8)
  ) {
    throw new Error("Packaged metadata does not match the release source");
  }
  await collectReleaseFiles(
    assetsDirectory,
    context,
    target,
    names.map((name) => resolve(root, "packages/desktop/dist", name)),
  );
}

export async function collectReleaseFiles(directory, context, target, sources) {
  const names = artifactNames(context.version, target);
  if (sources.length !== names.length) throw new Error("Unexpected installer count");
  await mkdir(directory, { recursive: true });
  const files = [];
  for (const [index, name] of names.entries()) {
    const destination = resolve(directory, name);
    if (!(await stat(sources[index])).size) throw new Error(`Empty installer: ${name}`);
    await copyFile(sources[index], destination);
    files.push({ name, sha256: await fileHash(destination) });
  }
  await writeFile(
    resolve(directory, `build-${target}.json`),
    `${JSON.stringify({ ...context, target, files }, null, 2)}\n`,
  );
}

export async function verifyAssets(directory, context, targets = releaseTargets) {
  const files = [];
  for (const target of targets) {
    const manifest = JSON.parse(await readFile(resolve(directory, `build-${target}.json`), "utf8"));
    if (
      manifest.tag !== context.tag ||
      manifest.commit !== context.commit ||
      manifest.version !== context.version ||
      manifest.target !== target
    ) {
      throw new Error(`Artifact source mismatch: ${target}`);
    }
    const expected = artifactNames(context.version, target);
    // 只接受安装包白名单，防止下载后的清单夹带路径、日志或其他构建文件。
    if (
      !Array.isArray(manifest.files) ||
      manifest.files.length !== expected.length ||
      expected.some((name) => manifest.files.filter((file) => file.name === name).length !== 1)
    ) {
      throw new Error(`Unexpected installer manifest: ${target}`);
    }
    for (const file of manifest.files) {
      if (!(await stat(resolve(directory, file.name))).size)
        throw new Error(`Empty installer: ${file.name}`);
      if ((await fileHash(resolve(directory, file.name))) !== file.sha256) {
        throw new Error(`Artifact checksum mismatch: ${file.name}`);
      }
      files.push(file);
    }
  }
  const expectedFiles = new Set([
    ...files.map((file) => file.name),
    ...targets.map((target) => `build-${target}.json`),
  ]);
  if ((await readdir(directory)).some((name) => !expectedFiles.has(name))) {
    throw new Error("Unexpected files in release assets");
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function publishAssets(
  context,
  {
    directory = assetsDirectory,
    targets = releaseTargets,
    checksumName = "SHA256SUMS",
    updateNotes = true,
  } = {},
) {
  if (!context.tag) throw new Error("Publishing requires a release tag");
  const files = await verifyAssets(directory, context, targets);
  const gh = (...args) => exec("gh", args, { cwd: root, maxBuffer: 1024 * 1024 });
  // 再核对远端标签，避免构建期间标签被移动后仍向同名 Release 上传旧源码产物。
  const { stdout } = await gh(
    "api",
    `repos/${process.env.GITHUB_REPOSITORY}/git/ref/tags/${context.tag}`,
  );
  let object = JSON.parse(stdout).object;
  if (object.type === "tag")
    object = JSON.parse(
      (await gh("api", `repos/${process.env.GITHUB_REPOSITORY}/git/tags/${object.sha}`)).stdout,
    ).object;
  if (object.type !== "commit" || object.sha !== context.commit)
    throw new Error("Remote release tag changed during build");
  await writeFile(
    resolve(directory, checksumName),
    files.map((file) => `${file.sha256}  ${file.name}\n`).join(""),
  );
  await gh(
    "release",
    "upload",
    context.tag,
    ...files.map((file) => resolve(directory, file.name)),
    resolve(directory, checksumName),
    "--repo",
    process.env.GITHUB_REPOSITORY,
    "--clobber",
  );
  if (!updateNotes) return;
  const notes = `CodeVori ${context.tag}\n\nCodeVori 是基于 [ZCode](https://github.com/zai-org/ZCode) 二次开发的 AI 编程工作台，部分功能参考 [Codeg](https://github.com/xintaofei/codeg) 项目。本项目独立维护，保留原作者署名、Apache-2.0 许可证及第三方版权声明。\n\n安装包由 GitHub Actions 从本版本标签构建，源码与安装包版本均为 ${context.version}。提供 macOS Apple Silicon / Intel、Windows x64、Linux x64 安装包，文件校验值见 SHA256SUMS。\n\nmacOS 使用 ad-hoc 本地签名，未经 Apple 公证；Windows 安装包未使用发布证书签名。\n\n源码提交：${context.commit}\n\n[问题反馈](https://github.com/caiqiqqq/CodeVori/issues)\n`;
  const notesPath = resolve(assetsDirectory, "release-notes.md");
  await writeFile(notesPath, notes);
  await gh(
    "release",
    "edit",
    context.tag,
    "--repo",
    process.env.GITHUB_REPOSITORY,
    "--notes-file",
    notesPath,
  );
}

async function main() {
  const context = await validateSource();
  switch (process.argv[2]) {
    case "validate":
      if (process.env.GITHUB_OUTPUT)
        await appendFile(
          process.env.GITHUB_OUTPUT,
          `tag=${context.tag}\nversion=${context.version}\ncommit=${context.commit}\n`,
        );
      break;
    case "collect":
      await collectAssets(context);
      break;
    case "publish":
      await publishAssets(context);
      break;
    default:
      throw new Error("Usage: node scripts/github-release.mjs validate|collect|publish");
  }
  console.log(`Release ${process.argv[2]} succeeded: ${context.tag} (${context.commit})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
