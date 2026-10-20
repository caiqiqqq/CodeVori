import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { getTargetPlatform } from "../../desktop/scripts/target-platform.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const nativeRoot = join(root, "vendor", "open-zcode-computer-use", "native");
const target = getTargetPlatform();

if (target.os !== "darwin") {
  console.log(`[open-computer-use] native is unavailable for ${target.key}; skipping Swift`);
  process.exit(0);
}
if (process.platform !== "darwin") throw new Error("macOS 电脑控制只能在 macOS 上构建。");
if (target.arch !== "arm64" && target.arch !== "x64") throw new Error("不支持的 macOS 架构。");

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".swift")) files.push(path);
  }
  return files;
}

const hash = createHash("sha256").update(target.key);
for (const path of [
  join(nativeRoot, "Package.swift"),
  ...(await sourceFiles(join(nativeRoot, "Sources"))),
].sort()) {
  hash.update(path.slice(nativeRoot.length)).update(await readFile(path));
}
const sourceHash = hash.digest("hex");
const outputDirectory = join(root, "native-bin", target.key);
const executable = join(outputDirectory, "OpenZCodeNative");
const markerPath = join(outputDirectory, "build.json");
try {
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  await access(executable);
  if (marker.sourceHash === sourceHash) {
    console.log(`[open-computer-use] native is current for ${target.key}`);
    process.exit(0);
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const triple = `${target.arch === "x64" ? "x86_64" : "arm64"}-apple-macosx14.0`;
const args = [
  "build",
  "-c",
  "release",
  "--product",
  "OpenZCodeNative",
  "--triple",
  triple,
  "--package-path",
  nativeRoot,
];
try {
  const built = await execFileAsync("swift", args, { maxBuffer: 16 * 1024 * 1024 });
  if (built.stdout.trim()) console.log(built.stdout.trim());
  if (built.stderr.trim()) console.warn(built.stderr.trim());
} catch (error) {
  throw new Error(
    `电脑控制原生构建失败，请检查 Xcode Command Line Tools。\n${error.stderr ?? error.message}`,
    { cause: error },
  );
}
const { stdout } = await execFileAsync("swift", [...args, "--show-bin-path"]);
await mkdir(outputDirectory, { recursive: true });
await copyFile(join(stdout.trim(), "OpenZCodeNative"), executable);
await chmod(executable, 0o755);
await writeFile(markerPath, `${JSON.stringify({ sourceHash, target: target.key })}\n`);
console.log(`[open-computer-use] built native for ${target.key}`);
