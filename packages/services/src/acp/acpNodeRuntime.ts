import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";
import { prerelease, rcompare, satisfies, valid } from "semver";
import { z } from "zod";
import { installAcpBinary, managedAcpBinary } from "./acpBinaryInstaller.js";

export const ACP_NPM_REGISTRY = "https://registry.npmmirror.com";
const NODE_MIRROR = "https://npmmirror.com/mirrors/node";
const releasesSchema = z.array(
  z.object({
    version: z.string(),
    lts: z.union([z.string(), z.literal(false)]),
    files: z.array(z.string()),
  }),
);

export function nodeArchive(
  version: string,
  platform = process.platform as string,
  arch = process.arch as string,
) {
  if (!valid(version) || prerelease(version)) throw new Error("无效的 Node.js 稳定版本");
  if (!["darwin", "linux", "win32"].includes(platform) || !["x64", "arm64"].includes(arch))
    throw new Error("当前平台不支持一键安装 Node.js，请手动安装。");
  const windows = platform === "win32";
  const root = `node-v${version}-${windows ? "win" : platform}-${arch}`;
  return {
    file: `${root}.${windows ? "zip" : "tar.gz"}`,
    marker:
      platform === "darwin" ? `osx-${arch}-tar` : windows ? `win-${arch}-zip` : `linux-${arch}`,
    entry: `${root}/${windows ? "node.exe" : "bin/node"}`,
    npm: `${root}/${windows ? "" : "lib/"}node_modules/npm/bin/npm-cli.js`,
    root,
    windows,
  };
}

export function selectNodeRelease(
  index: unknown,
  range: string,
  platform = process.platform as string,
  arch = process.arch as string,
): string {
  const marker = nodeArchive("24.0.0", platform, arch).marker;
  const release = releasesSchema
    .parse(index)
    .filter(
      (item) =>
        valid(item.version) &&
        !prerelease(item.version) &&
        item.lts &&
        item.files.includes(marker) &&
        satisfies(item.version, range),
    )
    .sort((a, b) => rcompare(a.version, b.version))[0];
  if (!release)
    throw new Error("国内镜像中没有满足目标要求的稳定 Node.js LTS，请稍后重试或手动安装。");
  return valid(release.version)!;
}

class NodeHttpError extends Error {
  constructor(
    readonly status: number,
    stage: string,
    url: string,
  ) {
    super(`Node.js ${stage}失败：HTTP ${status}（${url}）`);
  }
}

async function getResponse(url: string, fetcher: typeof fetch, stage: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(30_000), ...init });
  } catch (cause) {
    // 原始网络错误可能带代理凭据；只显示公开下载地址和安全类别，保留 cause 供诊断。
    const reason =
      cause instanceof Error && cause.name === "TimeoutError" ? "请求超时" : "网络请求失败";
    throw new Error(`Node.js ${stage}失败：${reason}（${url}）`, { cause });
  }
  if (!response.ok) throw new NodeHttpError(response.status, stage, url);
  return response;
}

export async function nodeChecksum(
  version: string,
  file: string,
  fetcher: typeof fetch,
  log: (message: string) => void,
): Promise<string> {
  let url = `${NODE_MIRROR}/v${version}/SHASUMS256.txt`;
  const stage = `${version} 校验文件请求`;
  let response: Response;
  try {
    response = await getResponse(url, fetcher, stage);
  } catch (error) {
    // 镜像可能已有 Windows zip 却缺少校验清单；仅 404 读取官方同版本清单，不能跳过哈希校验。
    if (!(error instanceof NodeHttpError) || error.status !== 404) throw error;
    log(`Node.js ${version} 镜像校验文件返回 HTTP 404，正在获取官方同版本校验文件…`);
    url = `https://nodejs.org/dist/v${version}/SHASUMS256.txt`;
    response = await getResponse(url, fetcher, stage);
  }
  const sha256 = (await response.text())
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === file)?.[0];
  if (!sha256 || !/^[a-f\d]{64}$/i.test(sha256))
    throw new Error(`Node.js ${version} 校验文件缺少 ${file} 的有效 SHA-256（${url}）`);
  return sha256;
}

async function versionOf(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args, "--version"], {
      env: { ...env, NODE_OPTIONS: "" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Node.js / npm 校验超时"));
    }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(0, 256);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const version = valid(output.trim());
      if (code === 0 && version) resolve(version);
      else reject(new Error("下载的 Node.js / npm 无法在目标 Host 运行"));
    });
  });
}

/** 目标 Host 唯一运行环境入口；读路径不联网、不启动版本探测进程。 */
export function createAcpNodeRuntime(
  directory: string,
  baseEnv: NodeJS.ProcessEnv,
  fetcher?: typeof fetch,
) {
  const pointer = join(directory, "active.json");
  const environment = (root: string, version: string) => {
    const archive = nodeArchive(version);
    const node = join(root, archive.entry);
    const npm = join(root, archive.npm);
    const bin = join(root, archive.root, archive.windows ? "" : "bin");
    return { node, npm, env: { ...baseEnv, PATH: `${bin}${delimiter}${baseEnv.PATH ?? ""}` } };
  };
  const read = async () => {
    try {
      const version = z
        .string()
        .regex(/^\d+\.\d+\.\d+$/)
        .parse(JSON.parse(await readFile(pointer, "utf8")));
      const root = join(directory, "versions", version);
      const archive = nodeArchive(version);
      const managed = await managedAcpBinary(root, {
        version,
        entry: archive.entry,
        sibling: archive.npm,
      });
      if (!managed || managed.version !== version) return null;
      const result = environment(root, version);
      await access(result.npm, constants.R_OK);
      return result;
    } catch {
      return null;
    }
  };
  return {
    read,
    supported: () =>
      ["darwin", "linux", "win32"].includes(process.platform) &&
      ["x64", "arm64"].includes(process.arch),
    async install(range: string, log: (message: string) => void) {
      log("正在从国内镜像选择兼容的 Node.js LTS…");
      const version = selectNodeRelease(
        await (
          await getResponse(`${NODE_MIRROR}/index.json`, fetcher ?? fetch, "版本索引请求")
        ).json(),
        range,
      );
      const archive = nodeArchive(version);
      const baseUrl = `${NODE_MIRROR}/v${version}`;
      const downloadUrl = `${baseUrl}/${archive.file}`;
      const sha256 = await nodeChecksum(version, archive.file, fetcher ?? fetch, log);
      const destination = join(directory, "versions", version);
      let lastPercent = -1;
      let lastMb = -1;
      await installAcpBinary(
        destination,
        downloadUrl,
        { version, entry: archive.entry, sibling: archive.npm, sha256 },
        {
          fetcher: (input, init) =>
            getResponse(String(input), fetcher ?? fetch, `${version} 安装包请求`, init),
          skipArchiveLinks: true,
          onProgress(bytes, total) {
            const mb = Math.floor(bytes / 1_000_000);
            const percent = total ? Math.floor((bytes / total) * 10) * 10 : -1;
            if ((total && percent > lastPercent) || (!total && mb >= lastMb + 5)) {
              lastPercent = percent;
              lastMb = mb;
              log(`正在下载 Node.js ${version}：${total ? `${percent}%` : `${mb} MB`}`);
            }
          },
          async validate(root) {
            log("正在校验 Node.js / npm…");
            const runtime = environment(root, version);
            // 归档中任意链接均不提取；仅重建官方 npm/npx 的固定相对入口。
            if (!archive.windows) {
              for (const name of ["npm", "npx"]) {
                const link = join(root, archive.root, "bin", name);
                await rm(link, { force: true });
                await symlink(
                  `../lib/node_modules/npm/bin/${name === "npm" ? "npm-cli" : "npx-cli"}.js`,
                  link,
                );
              }
            }
            const [node, npm] = await Promise.all([
              versionOf(runtime.node, [], runtime.env),
              versionOf(runtime.node, [runtime.npm], runtime.env),
            ]);
            if (node !== version || !satisfies(node, range) || !npm)
              throw new Error("下载的 Node.js / npm 版本不符合目标要求");
          },
        },
      ).catch((cause: unknown) => {
        // 通用安装器会安全归一化代理错误；在此补回本次 Node 版本、阶段和公开下载地址。
        throw new Error(
          `Node.js ${version} 安装包处理失败（${downloadUrl}）：${cause instanceof Error ? cause.message : "安装失败"}`,
          { cause },
        );
      });
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = join(directory, `active.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(version), { mode: 0o600 });
        await rename(temporary, pointer);
      } finally {
        await rm(temporary, { force: true });
      }
      log(`Node.js ${version} / npm 已安装到目标 Host 的软件专用目录。`);
    },
  };
}
