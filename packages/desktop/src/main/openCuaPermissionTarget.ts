import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function resolveCurrentCuaApplicationPath(
  executablePath = process.execPath,
): string | undefined {
  const macos = dirname(executablePath);
  const contents = dirname(macos);
  const appPath = dirname(contents);
  return basename(macos) === "MacOS" &&
    basename(contents) === "Contents" &&
    appPath.endsWith(".app")
    ? appPath
    : undefined;
}

/** 授权主体来自正在运行的主进程，不能使用用户配置或旧 Helper 的路径。 */
export function createCurrentCuaApplicationTarget(executablePath = process.execPath) {
  const expectedPath = resolveCurrentCuaApplicationPath(executablePath);
  async function resolveHelperIdentity(appPath: string) {
    if (!expectedPath || resolve(appPath) !== resolve(expectedPath))
      throw new Error("当前应用不是可授权的 macOS app bundle。");
    const canonicalAppPath = await realpath(expectedPath);
    const { stdout } = await execFileAsync(
      "/usr/bin/plutil",
      ["-convert", "json", "-o", "-", join(canonicalAppPath, "Contents", "Info.plist")],
      { encoding: "utf8", timeout: 5000 },
    );
    const plist = JSON.parse(stdout) as Record<string, unknown>;
    const name = plist.CFBundleExecutable;
    const bundleId = plist.CFBundleIdentifier;
    if (
      typeof name !== "string" ||
      basename(name) !== name ||
      typeof bundleId !== "string" ||
      !bundleId
    )
      throw new Error("当前应用的 bundle 身份无效。");
    const declaredExecutable = join(canonicalAppPath, "Contents", "MacOS", name);
    if ((await realpath(declaredExecutable)) !== (await realpath(executablePath)))
      throw new Error("授权应用与正在运行的进程不一致。");
    return {
      appPath: expectedPath,
      executablePath: declaredExecutable,
      bundleId,
      displayName:
        typeof plist.CFBundleDisplayName === "string"
          ? plist.CFBundleDisplayName
          : typeof plist.CFBundleName === "string"
            ? plist.CFBundleName
            : basename(expectedPath, ".app"),
    };
  }
  return {
    resolveHelperIdentity,
    async ensureHelperInstalled() {
      if (!expectedPath) throw new Error("找不到当前 macOS 应用的授权主体。");
      await resolveHelperIdentity(expectedPath);
      return expectedPath;
    },
    async verifyHelperInstalled(appPath: string) {
      await resolveHelperIdentity(appPath);
    },
  };
}
