import { spawn } from "node:child_process";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { getTargetPlatform } from "./target-platform.mjs";
import { deviceBridgeAsset, verifyDeviceBridgeBinary } from "./device-bridge-assets.mjs";

const desktopRoot = resolve(import.meta.dirname, "..");
const target = getTargetPlatform();
const asset = deviceBridgeAsset(desktopRoot, target);
const temporary = `${asset.binaryPath}.${randomUUID()}.tmp`;
await mkdir(asset.directory, { recursive: true });
try {
  // 每次经过 Go 增量构建，避免切分支或换架构后复用旧文件；失败时不允许旧产物冒充新构建。
  await new Promise((resolveBuild, reject) => {
    const child = spawn(
      "go",
      [
        "build",
        "-mod=readonly",
        "-trimpath",
        "-buildvcs=false",
        "-ldflags=-s -w",
        "-o",
        temporary,
        "./cmd/device-bridge",
      ],
      {
        cwd: resolve(desktopRoot, "../../apps/device-bridge"),
        env: { ...process.env, GOOS: asset.goos, GOARCH: asset.goarch, CGO_ENABLED: "0" },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolveBuild()
        : reject(new Error(`Device bridge build failed: ${signal ?? code}`)),
    );
  });
  if (target.os !== "win32") await chmod(temporary, 0o755);
  await verifyDeviceBridgeBinary(temporary, target);
  await rename(temporary, asset.binaryPath);
  console.log(`[device-bridge] ready: ${target.key}`);
} finally {
  await rm(temporary, { force: true });
}
