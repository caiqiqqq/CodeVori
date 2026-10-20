import { build } from "esbuild";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir } from "node:fs/promises";
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
if (target.os === "darwin") {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [
    join(runtimeRoot, "scripts", "build-native.mjs"),
  ]);
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.warn(stderr.trim());
  await mkdir(join(root, "dist", "native"), { recursive: true });
  await copyFile(
    join(runtimeRoot, "native-bin", target.key, "OpenZCodeNative"),
    join(root, "dist", "native", "OpenZCodeNative"),
  );
  await chmod(join(root, "dist", "native", "OpenZCodeNative"), 0o755);
}
console.log(`[open-computer-use] prepared plugin for ${target.key}`);
