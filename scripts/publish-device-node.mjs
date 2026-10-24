import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { executionNodeTargets } from "./package-execution-node.mjs";
import { validateBuildServiceUrl } from "./package-device-node.mjs";

const exec = promisify(execFile);
export async function validateClientRelease(directory, manifestName = "manifest.json") {
  const manifest = JSON.parse(await readFile(join(directory, manifestName), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !Array.isArray(manifest.files))
    throw new Error("Invalid client manifest");
  validateBuildServiceUrl(manifest.serviceUrl);
  const expected = new Set(executionNodeTargets.map(({ os, arch }) => `${os}-${arch}`));
  for (const file of manifest.files) {
    const name = `CodeVoriNode-${file.platform}${file.platform.startsWith("win32-") ? ".exe" : ""}`;
    if (!expected.delete(file.platform) || file.name !== name || basename(file.name) !== file.name)
      throw new Error("Invalid or duplicate client platform");
    const url = new URL(file.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith(`/${manifest.version}/${name}`)
    )
      throw new Error("Invalid client URL");
    const bytes = await readFile(join(directory, file.name));
    if (
      bytes.length !== file.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== file.sha256
    )
      throw new Error(`Client integrity check failed: ${file.platform}`);
  }
  if (expected.size) throw new Error("Missing client platforms");
  return manifest;
}

export async function publishDeviceNodes({ directory, host, socket }) {
  if (!/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+$/.test(host)) throw new Error("Use user@host");
  const manifest = await validateClientRelease(directory);
  const ssh = socket ? ["-S", socket] : [];
  const scp = socket ? ["-o", `ControlPath=${socket}`] : [];
  const stage = `/srv/codevori-node/.incoming/${manifest.version}-${randomBytes(6).toString("hex")}`;
  await exec("ssh", [...ssh, host, `mkdir -p '${stage}' /srv/codevori-node/clients`]);
  await exec(
    "scp",
    [
      ...scp,
      "--",
      join(directory, "manifest.json"),
      join(directory, "LICENSE.txt"),
      ...manifest.files.map(({ name }) => join(directory, name)),
      `${host}:${stage}/`,
    ],
    { maxBuffer: 2_000_000 },
  );
  await exec("ssh", [...ssh, host, `mkdir -p '${stage}/.publisher'`]);
  await exec("scp", [
    ...scp,
    "--",
    resolve(import.meta.dirname, "sync-device-node.py"),
    resolve(import.meta.dirname, "sync-github-releases.py"),
    `${host}:${stage}/.publisher/`,
  ]);
  // 手工上传和定时镜像共用发布锁、不可变版本校验与原子指针，避免两套写入规则。
  const remote = `python3 - '${stage}' <<'PY'
import hashlib,importlib.util,json,pathlib,shutil,sys
stage=pathlib.Path(sys.argv[1]); root=stage.parent.parent
spec=importlib.util.spec_from_file_location('node_sync',stage/'.publisher/sync-device-node.py')
publisher=importlib.util.module_from_spec(spec); spec.loader.exec_module(publisher)
m=json.loads((stage/'manifest.json').read_text())
license_hash=hashlib.sha256((stage/'LICENSE.txt').read_bytes()).hexdigest()
shutil.rmtree(stage/'.publisher')
try:
    with publisher.mirror.sync_lock(root):
        publisher.publish_clients(root,stage,m,license_hash)
finally:
    shutil.rmtree(stage,ignore_errors=True)
print('Published independent clients '+m['version']+'; verified '+str(len(m['files']))+' platforms')
PY`;
  const result = await exec("ssh", [...ssh, host, remote], { maxBuffer: 2_000_000 });
  process.stdout.write(result.stdout);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (key) =>
    process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
  const directory = option("clients"),
    host = option("host");
  if (!directory || !host)
    throw new Error(
      "Use --clients=<version-directory> --host=user@host [--socket=<ssh-control-socket>]",
    );
  await publishDeviceNodes({ directory: resolve(directory), host, socket: option("socket") });
}
