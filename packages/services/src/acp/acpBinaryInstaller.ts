import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import * as yauzl from "yauzl";
import { x as extractTar } from "tar";

export type AcpBinaryRelease = {
  version: string;
  entry: string;
  sibling?: string;
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
): Promise<void> {
  const staging = `${directory}.${randomUUID()}.tmp`;
  const backup = `${directory}.${randomUUID()}.backup`;
  const archive = join(staging, `download${url.endsWith(".zip") ? ".zip" : ".tar.gz"}`);
  await mkdir(staging, { recursive: true, mode: 0o700 });
  let movedOld = false;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body)
      throw new Error(`ACP download failed: HTTP ${response.status}`);
    let bytes = 0;
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          done(bytes > 750_000_000 ? new Error("ACP archive exceeds size limit") : null, chunk);
        },
      }),
      createWriteStream(archive, { mode: 0o600 }),
    );
    const extracted = join(staging, "extracted");
    await mkdir(extracted);
    if (url.endsWith(".zip")) {
      await extractZipArchive(archive, extracted);
    } else {
      await extractTar({
        file: archive,
        cwd: extracted,
        filter(path, entry) {
          safePath(extracted, path);
          if ("type" in entry && entry.type !== "File" && entry.type !== "Directory")
            throw new Error("ACP archive contains an unsupported entry type");
          return true;
        },
      });
    }
    await rm(archive, { force: true });
    for (const path of [release.entry, ...(release.sibling ? [release.sibling] : [])]) {
      await access(safePath(extracted, path));
      if (process.platform !== "win32") await chmod(safePath(extracted, path), 0o755);
      await checkedFile(extracted, path);
    }
    await writeFile(join(extracted, "release.json"), release.version, { mode: 0o600 });
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
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
