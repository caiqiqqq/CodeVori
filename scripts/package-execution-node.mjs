import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { crc32, deflateRawSync } from "node:zlib";
import {
  deviceBridgeAsset,
  verifyDeviceBridgeBinary,
} from "../packages/desktop/scripts/device-bridge-assets.mjs";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
export const executionNodeTargets = [
  { os: "win32", arch: "x64" },
  { os: "win32", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "darwin", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "arm64" },
];

/** A small ZIP with only explicit product files; never sweep a workspace or user's node state. */
export function executionNodeZip(files) {
  const entries = [],
    central = [];
  let offset = 0;
  for (const { name, data, executable = false } of files) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || entries.some((entry) => entry.name === name))
      throw new Error("Invalid or duplicate archive name");
    const filename = Buffer.from(name);
    const compressed = deflateRawSync(data, { level: 9 });
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12); // 1980-01-01, stable ZIP timestamp
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(0x0314, 4);
    header.copy(directory, 6, 4, 30);
    directory.writeUInt32LE(((executable ? 0o100755 : 0o100644) << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    entries.push({ name, bytes: Buffer.concat([header, filename, compressed]) });
    central.push(directory, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries.map((entry) => entry.bytes), directory, end]);
}

export async function packageExecutionNode(target, outputDirectory) {
  const asset = deviceBridgeAsset(join(root, "packages/desktop"), target);
  await exec(process.execPath, [join(root, "packages/desktop/scripts/build-device-bridge.mjs")], {
    cwd: root,
    env: { ...process.env, ZCODE_TARGET_OS: target.os, ZCODE_TARGET_ARCH: target.arch },
    maxBuffer: 4 << 20,
  });
  await verifyDeviceBridgeBinary(asset.binaryPath, target);
  const binary = await readFile(asset.binaryPath);
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const { stdout: commit } = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
  const { stdout: dirty } = await exec(
    "git",
    ["status", "--porcelain", "--", "apps/device-bridge"],
    { cwd: root },
  );
  const source = {
    version,
    commit: commit.trim(),
    dirty: Boolean(dirty.trim()),
    ...target,
    binarySha256: createHash("sha256").update(binary).digest("hex"),
    binaryBytes: binary.length,
  };
  const windows = target.os === "win32";
  const command = windows ? ".\\device-bridge.exe" : "./device-bridge";
  const state = windows
    ? '"$env:LOCALAPPDATA\\CodeVoriNode\\network"'
    : '"$HOME/.codevori-node/network"';
  const usage = `CodeVori lightweight execution node ${version} (${target.os}-${target.arch})

This archive contains the node only. No full CodeVori, Electron, Node.js, Python or model runtime is required.
This is a console build. An installer, tray UI and automatic updates are not included.

1. On the controlling CodeVori app, connect under Settings > Devices & connections.
   Copy the controller's Node ID from that page.
2. On this target computer, open ${windows ? "PowerShell" : "a terminal"} in this directory and run:
   ${command} node --state-dir ${state} --hostname codevori-node --allow-node "CONTROLLER_NODE_ID" --command-slots 2
3. On first run, follow the Tailscale login URL and join the same tailnet.
   In CodeVori, refresh devices and choose this node > Connect and check.
4. Open a new local conversation and use its node_info, command_run and desktop tools.
   Keep this process running. Ctrl+C stops it. Reuse the same state directory to keep sign-in.

Run in a logged-in user's desktop session. Commands use PowerShell on Windows and /bin/sh elsewhere.
Windows: built-in PowerShell/.NET/user32 desktop adapter; locked/UAC secure desktops are not supported.
macOS: grant Screen Recording and Accessibility permissions to the launching process. Primary display only.
Linux X11: install xdotool for input and ImageMagick (import) for screenshots, with DISPLAY set.
Linux Wayland: desktop operations are unavailable in this build; command execution still works.
The node publishes available backend tools; actual OS permissions are checked when an operation runs.
Use absolute coordinates from a fresh screenshot. Input dispatch is not proof that an application acted.
Command capacity is bounded; busy calls are rejected. A desktop workflow must have one task owner.
Do not automatically repeat commands or clicks after interruption: the outcome may be unknown.

Network TCP 8743 is restricted to explicitly allowed stable node IDs by the existing tailnet bridge.
No public physical-interface 8000 port is needed. A node's own private state must never be copied/shared.
Before production use, validate native control on the actual target OS; cross-compilation is not that evidence.
Source: ${source.commit}${source.dirty ? " (local changes present)" : ""}
`;
  const archive = executionNodeZip([
    { name: asset.name, data: binary, executable: !windows },
    { name: "USAGE.txt", data: Buffer.from(usage) },
    { name: "manifest.json", data: Buffer.from(`${JSON.stringify(source, null, 2)}\n`) },
    { name: "LICENSE.txt", data: await readFile(join(root, "LICENSE")) },
  ]);
  const file = join(outputDirectory, `CodeVoriNode-${version}-${target.os}-${target.arch}.zip`);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(file, archive);
  return { file, archiveBytes: archive.length, ...source };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(root, "output/execution-node");
  const targets = process.argv.includes("--all")
    ? executionNodeTargets
    : executionNodeTargets.filter((target) => `${target.os}-${target.arch}` === process.argv[2]);
  if (!targets.length)
    throw new Error(
      "Use --all or win32-x64/win32-arm64/darwin-x64/darwin-arm64/linux-x64/linux-arm64",
    );
  // Build one target at a time: avoid contending Go caches and mixing target preparation.
  for (const target of targets)
    process.stdout.write(`${JSON.stringify(await packageExecutionNode(target, directory))}\n`);
}
