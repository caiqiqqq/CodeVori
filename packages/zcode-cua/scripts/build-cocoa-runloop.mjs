import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export async function buildCocoaRunLoop(directory) {
  if (process.platform !== "darwin") throw new Error("Build the Cocoa bridge on macOS.");
  const headers = dirname(fileURLToPath(import.meta.resolve("node-api-headers/package.json")));
  const output = join(directory, "cocoa-runloop.node");
  const run = promisify(execFile);
  await run(
    "xcrun",
    [
      "clang++",
      "-shared",
      "-undefined",
      "dynamic_lookup",
      "-std=c++17",
      "-fobjc-arc",
      "-arch",
      "arm64",
      "-mmacosx-version-min=14.0",
      "-framework",
      "Foundation",
      "-I",
      join(headers, "include"),
      fileURLToPath(new URL("../native/cocoa-runloop.mm", import.meta.url)),
      "-o",
      output,
    ],
    { timeout: 60_000 },
  );
  // 哈希包含签名：发布时在记录哈希前使用正式身份签名，主包阶段不能再次改写它。
  const identity = process.env.APPLE_SIGNING_IDENTITY || process.env.CSC_NAME;
  const releaseSign = process.env.ZCODE_ENABLE_MAC_SIGN === "1";
  if (releaseSign && !identity)
    throw new Error("Cocoa bridge signing requires APPLE_SIGNING_IDENTITY or CSC_NAME.");
  await run(
    "codesign",
    [
      "--force",
      ...(releaseSign ? ["--timestamp", "--options", "runtime"] : []),
      "--sign",
      releaseSign ? identity : "-",
      output,
    ],
    { timeout: 30_000 },
  );
}
