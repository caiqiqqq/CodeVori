import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export async function extractNativeAsset(
  archive,
  member,
  { platform = process.platform, systemRoot = process.env.SystemRoot, execute = executeFile } = {},
) {
  const paths = platform === "win32" ? path.win32 : path;
  // 原因：Git Bash 的 GNU tar 会把 C: 当作远端主机，且不支持官方 NSIS 归档。
  // Windows 明确使用系统自带的 bsdtar，并从归档目录传入文件名，避免盘符解析。
  const command =
    platform === "win32"
      ? path.win32.join(systemRoot || "C:\\Windows", "System32", "tar.exe")
      : "tar";
  await execute(command, ["-xf", paths.basename(archive), member], {
    cwd: paths.dirname(archive),
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}
