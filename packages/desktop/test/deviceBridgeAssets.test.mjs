import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  deviceBridgeAsset,
  verifyDeviceBridgeBinary,
  verifyPackagedDeviceBridge,
} from "../scripts/device-bridge-assets.mjs";

function executable(os, arch) {
  const header = Buffer.alloc(512);
  if (os === "darwin") {
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(arch === "arm64" ? 0x100000c : 0x1000007, 4);
  } else if (os === "linux") {
    header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    header.writeUInt16LE(arch === "arm64" ? 183 : 62, 18);
  } else {
    header.write("MZ");
    header.writeUInt32LE(128, 0x3c);
    header.write("PE\0\0", 128);
    header.writeUInt16LE(arch === "arm64" ? 0xaa64 : 0x8664, 132);
  }
  return header;
}

test("electron-builder includes the target component and rejects an incomplete package before signing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bridge-builder-"));
  const previousOs = process.env.ZCODE_TARGET_OS;
  const previousArch = process.env.ZCODE_TARGET_ARCH;
  try {
    for (const os of ["darwin", "win32", "linux"]) {
      for (const arch of ["x64", "arm64"]) {
        process.env.ZCODE_TARGET_OS = os;
        process.env.ZCODE_TARGET_ARCH = arch;
        const { default: config } = await import(
          `../electron-builder.config.js?bridge-test=${os}-${arch}`
        );
        const resource = config.extraResources.find((entry) =>
          entry.to.startsWith("device-bridge/"),
        );
        const asset = deviceBridgeAsset(resolve(import.meta.dirname, ".."), { os, arch });
        assert.deepEqual(resource, { from: asset.binaryPath, to: `device-bridge/${asset.name}` });
        const context = {
          appOutDir: directory,
          electronPlatformName: os,
          arch: arch === "x64" ? 1 : 3,
          packager: { appInfo: { productFilename: "Synthetic" } },
        };
        await assert.rejects(config.afterPack(context), /ENOENT.*device-bridge/);
        await assert.rejects(
          config.afterPack({ ...context, arch: arch === "x64" ? 3 : 1 }),
          /target does not match/,
        );
      }
    }
  } finally {
    if (previousOs === undefined) delete process.env.ZCODE_TARGET_OS;
    else process.env.ZCODE_TARGET_OS = previousOs;
    if (previousArch === undefined) delete process.env.ZCODE_TARGET_ARCH;
    else process.env.ZCODE_TARGET_ARCH = previousArch;
    await rm(directory, { recursive: true, force: true });
  }
});

for (const os of ["darwin", "win32", "linux"]) {
  for (const arch of ["arm64", "x64"]) {
    test(`bridge resources validate ${os}-${arch} and reject missing/wrong architecture`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "bridge-assets-"));
      try {
        const target = { os, arch, key: `${os}-${arch}` };
        const asset = deviceBridgeAsset(directory, target);
        assert.equal(asset.goos, os === "win32" ? "windows" : os);
        assert.equal(asset.goarch, arch === "x64" ? "amd64" : arch);
        assert.equal(asset.name, os === "win32" ? "device-bridge.exe" : "device-bridge");
        const packaged = join(directory, "device-bridge", asset.name);
        await assert.rejects(verifyPackagedDeviceBridge(directory, target), /ENOENT/);
        await mkdir(join(directory, "device-bridge"));
        await writeFile(packaged, executable(os, arch), { mode: 0o755 });
        await verifyPackagedDeviceBridge(directory, target);
        await writeFile(packaged, executable(os, arch === "arm64" ? "x64" : "arm64"));
        await assert.rejects(verifyDeviceBridgeBinary(packaged, target), /target mismatch/);
        await writeFile(packaged, "not a bridge executable");
        await assert.rejects(verifyDeviceBridgeBinary(packaged, target));
        if (process.platform !== "win32" && os !== "win32") {
          await writeFile(packaged, executable(os, arch));
          await chmod(packaged, 0o600);
          await assert.rejects(verifyDeviceBridgeBinary(packaged, target), /executable/);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
}
