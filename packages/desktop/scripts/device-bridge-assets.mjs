import { access, open, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

export function deviceBridgeAsset(desktopRoot, target) {
  const { os, arch } = target;
  if (!["darwin", "win32", "linux"].includes(os) || !["x64", "arm64"].includes(arch)) {
    throw new Error(`Unsupported device bridge target: ${os}-${arch}`);
  }
  const name = os === "win32" ? "device-bridge.exe" : "device-bridge";
  const directory = join(desktopRoot, "bundled-tools", `${os}-${arch}`, "device-bridge");
  return {
    name,
    directory,
    binaryPath: join(directory, name),
    goos: os === "win32" ? "windows" : os,
    goarch: arch === "x64" ? "amd64" : arch,
  };
}

/** Inspect target headers without executing foreign code or requiring Go on the packaging machine. */
export async function verifyDeviceBridgeBinary(binaryPath, target) {
  deviceBridgeAsset(".", target);
  const info = await stat(binaryPath);
  if (!info.isFile() || !info.size) throw new Error("Device bridge is not a nonempty file");
  if (target.os !== "win32" && process.platform !== "win32") {
    if (!(info.mode & 0o111)) throw new Error("Device bridge is not executable");
    await access(binaryPath, constants.X_OK);
  }
  const file = await open(binaryPath, "r");
  try {
    const header = Buffer.alloc(64);
    if ((await file.read(header, 0, header.length, 0)).bytesRead < 64)
      throw new Error("Invalid device bridge header");
    let matches = false;
    if (target.os === "darwin") {
      matches =
        header.readUInt32LE(0) === 0xfeedfacf &&
        header.readUInt32LE(4) === (target.arch === "arm64" ? 0x100000c : 0x1000007);
    } else if (target.os === "linux") {
      matches =
        header.subarray(0, 6).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1])) &&
        header.readUInt16LE(18) === (target.arch === "arm64" ? 183 : 62);
    } else if (header.toString("ascii", 0, 2) === "MZ") {
      const pe = Buffer.alloc(6);
      const offset = header.readUInt32LE(0x3c);
      if (offset >= 64 && offset + 6 <= info.size) {
        await file.read(pe, 0, pe.length, offset);
        matches =
          pe.toString("ascii", 0, 4) === "PE\0\0" &&
          pe.readUInt16LE(4) === (target.arch === "arm64" ? 0xaa64 : 0x8664);
      }
    }
    if (!matches)
      throw new Error(`Device bridge target mismatch: expected ${target.os}-${target.arch}`);
  } finally {
    await file.close();
  }
}

export async function verifyPackagedDeviceBridge(resourcesPath, target) {
  const { name } = deviceBridgeAsset(".", target);
  await verifyDeviceBridgeBinary(join(resourcesPath, "device-bridge", name), target);
}
