import { build } from "esbuild";
import { execFile } from "node:child_process";
import { appendFile, chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getTargetPlatform } from "../../desktop/scripts/target-platform.mjs";

const root = resolve(import.meta.dirname, "..");
const runtimeRoot = dirname(fileURLToPath(import.meta.resolve("@zcode/zcode-cua")));
const target = getTargetPlatform();
await mkdir(join(root, "dist"), { recursive: true });
await build({
  entryPoints: [join(root, "src", "mcp-server.mjs")],
  outfile: join(root, "dist", "mcp", "server.js"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  legalComments: "inline",
  banner: {
    js: 'import { createRequire as createCuaRequire } from "node:module"; const require = createCuaRequire(import.meta.url);',
  },
});
const vendorRoot = join(runtimeRoot, "vendor", "open-zcode-computer-use");
for (const name of ["LICENSE", "NOTICE", "ZCODE-CHANGES.md"]) {
  await copyFile(join(vendorRoot, name), join(root, "dist", name));
}
await appendFile(
  join(root, "dist/NOTICE"),
  "\nCodeVori 0.7.0 native adapter: dist/native/ax_native.node (when present) is imported from the proprietary ZCode distribution. Its license is separate from the MIT sources above; runtime.json records provenance. Redistribution requires rights from its original owner.\n",
);
if (["darwin", "win32"].includes(target.os)) {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [
    join(runtimeRoot, "scripts", "build-native.mjs"),
  ]);
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.warn(stderr.trim());
  await rm(join(root, "dist", "native"), { recursive: true, force: true });
  await mkdir(join(root, "dist", "native"), { recursive: true });
  for (const name of target.os === "darwin" && target.arch === "x64"
    ? ["OpenZCodeNative"]
    : [
        "ax_native.node",
        "helper.mjs",
        "runtime.json",
        ...(target.os === "darwin" ? ["cocoa-runloop.node"] : []),
      ]) {
    await copyFile(
      join(runtimeRoot, "native-bin", target.key, name),
      join(root, "dist", "native", name),
    );
  }
  if (target.os === "darwin" && target.arch === "x64")
    await chmod(join(root, "dist/native/OpenZCodeNative"), 0o755);
}
console.log(`[open-computer-use] prepared plugin for ${target.key}`);
