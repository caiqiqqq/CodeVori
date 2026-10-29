import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import * as yauzl from "yauzl";
import { x as extractTar } from "tar";
import { getNetworkErrorCodes } from "../providers/api/networkErrorClassifier.js";

export type AcpBinaryRelease = {
  version: string;
  entry: string;
  sibling?: string;
  sha256?: string;
};

function safePath(root: string, entry: string): string {
  const path = resolve(root, entry);
  const outside = relative(root, path);
  if (isAbsolute(entry) || outside === ".." || outside.startsWith(`..${sep}`) || path === root)
    throw new Error("Invalid ACP archive path");
  return path;
}

async function checkedFile(root: string, path: string): Promise<void> {
  const target = safePath(root, path);
  // 修复原因：发行归档可能含符号链接，不能把归档外的目标当成托管可执行文件。
  let parent = target;
  while (parent !== root) {
    const info = await lstat(parent);
    if (info.isSymbolicLink())
      throw new Error("ACP archive contains a symbolic link in its entry path");
    parent = resolve(parent, "..");
  }
  await access(target, process.platform === "win32" ? constants.F_OK : constants.X_OK);
}

export async function managedAcpBinary(
  directory: string,
  release: AcpBinaryRelease,
): Promise<{ script: string; version: string } | null> {
  try {
    const version = (await readFile(join(directory, "release.json"), "utf8")).trim();
    if (!/^[-\w.]+$/.test(version)) return null;
    await checkedFile(directory, release.entry);
    if (release.sibling) await checkedFile(directory, release.sibling);
    return { script: safePath(directory, release.entry), version };
  } catch {
    return null;
  }
}

async function extractZipArchive(archive: string, directory: string): Promise<void> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(
      archive,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, file) => (error ? reject(error) : resolve(file)),
    );
  });
  try {
    await new Promise<void>((resolveDone, rejectDone) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        rejectDone(error);
        zip.close();
      };
      zip.on("error", fail);
      zip.on("end", () => {
        if (!settled) {
          settled = true;
          resolveDone();
        }
      });
      zip.on("entry", (entry: yauzl.Entry) => {
        void (async () => {
          const path = safePath(directory, entry.fileName);
          const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (kind === 0o120000 || (kind !== 0 && kind !== 0o100000 && kind !== 0o040000))
            throw new Error("ACP archive contains an unsupported entry type");
          if (entry.fileName.endsWith("/")) {
            await mkdir(path, { recursive: true });
          } else {
            await mkdir(resolve(path, ".."), { recursive: true });
            const stream = await new Promise<import("node:stream").Readable>((resolve, reject) => {
              zip.openReadStream(entry, (error, input) => (error ? reject(error) : resolve(input)));
            });
            await pipeline(stream, createWriteStream(path, { mode: 0o600 }));
          }
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

/** Download to staging; publish only a complete verified tree, restoring the previous release on failure. */
export async function installAcpBinary(
  directory: string,
  url: string,
  release: AcpBinaryRelease,
  options: {
    fetcher?: typeof fetch;
    skipArchiveLinks?: boolean;
    validate?: (directory: string) => Promise<void>;
    onProgress?: (bytes: number, total: number | null) => void;
  } = {},
): Promise<void> {
  const staging = `${directory}.${randomUUID()}.tmp`;
  const backup = `${directory}.${randomUUID()}.backup`;
  const archive = join(staging, `download${url.endsWith(".zip") ? ".zip" : ".tar.gz"}`);
  await mkdir(staging, { recursive: true, mode: 0o700 });
  let movedOld = false;
  try {
    // 修复原因：裸 fetch 不读取 Host 代理/CA 设置，GitHub 二进制升级会绕过代理并建连超时。
    const response = await (options.fetcher ?? fetch)(url, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok || !response.body)
      throw new Error(`ACP download failed: HTTP ${response.status}`);
    let bytes = 0;
    const total = Number(response.headers.get("content-length")) || null;
    const hash = createHash("sha256");
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          hash.update(chunk);
          options.onProgress?.(bytes, total);
          done(bytes > 750_000_000 ? new Error("ACP archive exceeds size limit") : null, chunk);
        },
      }),
      createWriteStream(archive, { mode: 0o600 }),
    );
    // 修复原因：远端目录提供校验和时，坏归档不得替换已安装的完整版本。
    if (release.sha256 && hash.digest("hex") !== release.sha256.toLowerCase())
      throw new Error("ACP archive checksum mismatch");
    const extracted = join(staging, "extracted");
    await mkdir(extracted);
    if (url.endsWith(".zip")) {
      await extractZipArchive(archive, extracted);
    } else {
      let extractionError: Error | undefined;
      await extractTar({
        file: archive,
        cwd: extracted,
        filter(path, entry) {
          if (extractionError) return false;
          try {
            safePath(extracted, path);
            // Node 发行包的 npm 链接由运行环境安装器按已知目标重建，不信任归档链接。
            if (
              options.skipArchiveLinks &&
              "type" in entry &&
              ["SymbolicLink", "Link"].includes(entry.type)
            )
              return false;
            if ("type" in entry && entry.type !== "File" && entry.type !== "Directory")
              throw new Error("ACP archive contains an unsupported entry type");
            return true;
          } catch (error) {
            // tar 的 filter 在流回调中执行；直接 throw 会变成未捕获异常而非安装失败。
            // 拒绝后续条目，待流结束统一拒绝发布，确保旧版本与 Host 进程保持可用。
            extractionError = error instanceof Error ? error : new Error("Invalid ACP archive");
            return false;
          }
        },
      });
      if (extractionError) throw extractionError;
    }
    await rm(archive, { force: true });
    for (const path of [release.entry, ...(release.sibling ? [release.sibling] : [])]) {
      await access(safePath(extracted, path));
      if (process.platform !== "win32") await chmod(safePath(extracted, path), 0o755);
      await checkedFile(extracted, path);
    }
    await writeFile(join(extracted, "release.json"), release.version, { mode: 0o600 });
    await options.validate?.(extracted);
    try {
      await rename(directory, backup);
      movedOld = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(extracted, directory);
    } catch (error) {
      if (movedOld) await rename(backup, directory);
      movedOld = false;
      throw error;
    }
    if (movedOld) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    // 只投影已知错误码，原始 cause 可能带代理凭据或 URL，不能直接展示到安装日志。
    const reasons: Record<string, string> = {
      UND_ERR_CONNECT_TIMEOUT: "连接超时",
      ETIMEDOUT: "连接超时",
      ENOTFOUND: "域名解析失败",
      EAI_AGAIN: "域名解析暂时失败",
      ECONNREFUSED: "连接被拒绝",
      ECONNRESET: "连接被重置",
      ENETUNREACH: "网络不可达",
      EHOSTUNREACH: "目标不可达",
      UND_ERR_CONNECT_ERROR: "连接失败",
    };
    const code = getNetworkErrorCodes(error).find((code) => reasons[code]);
    if (code)
      throw new Error(
        `ACP 下载失败：${reasons[code]}（${code}）。请检查目标 Host 的网络和代理设置。`,
        { cause: error },
      );
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.message === "fetch failed")
    )
      throw new Error(
        `ACP 下载失败：${error.name === "TimeoutError" ? "请求超时" : "网络请求失败"}。请检查目标 Host 的网络和代理设置。`,
        { cause: error },
      );
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
