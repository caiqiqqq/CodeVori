import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { executionNodeTargets, executionNodeZip } from "./package-execution-node.mjs";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
export function deviceNodeBuildPlan(version, output = join(root, "output/device-node")) {
  // Go 构建在模块目录执行；先转绝对路径，避免相对 --output 写入模块后读取失败。
  return {
    clients: resolve(output, "clients", version),
    services: resolve(output, "service", version),
    clientTargets: executionNodeTargets,
    serviceTargets: [
      { os: "linux", arch: "x64" },
      { os: "linux", arch: "arm64" },
    ],
  };
}
export function validateBuildServiceUrl(serviceUrl, local = false) {
  const parsed = new URL(serviceUrl);
  const loopback =
    parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    (local ? !loopback : parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    /\s/.test(serviceUrl)
  )
    throw new Error("Use HTTPS for releases or explicit --local with a loopback HTTP URL");
  return parsed.toString().replace(/\/$/, "");
}
export function deviceNodeReleaseManifest({
  version,
  source,
  dirty,
  serviceUrl,
  assetsBaseUrl,
  files,
}) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("Invalid independent client version");
  return {
    version,
    source,
    dirty,
    serviceUrl,
    files: files.map((file) => ({ ...file, url: `${assetsBaseUrl}/${version}/${file.name}` })),
  };
}
export async function buildDeviceNodes({
  clients = true,
  services = true,
  local = false,
  output,
  serviceUrl: configuredUrl,
} = {}) {
  const version = JSON.parse(
    await readFile(join(root, "scripts/device-node-version.json"), "utf8"),
  ).version;
  const plan = deviceNodeBuildPlan(
    version,
    output ?? join(root, local ? "output/device-node-local" : "output/device-node"),
  );
  const serviceUrl = validateBuildServiceUrl(
    configuredUrl ??
      process.env.CODEVORI_NODE_SERVICE_URL ??
      (local ? "http://127.0.0.1:18081" : "https://aimodetest.cn/device-node"),
    local,
  );
  const assetsBaseUrl = validateBuildServiceUrl(
    process.env.CODEVORI_NODE_ASSETS_BASE_URL ??
      (local ? "http://127.0.0.1:18081/clients" : "https://aimodetest.cn/codevori-node/clients"),
    local,
  );
  const source = (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  const dirty = Boolean(
    (await exec("git", ["status", "--porcelain"], { cwd: root })).stdout.trim(),
  );
  const go = process.env.GO_BINARY || "go";
  const build = async (target, command, destination) => {
    await mkdir(resolve(destination, ".."), { recursive: true });
    const flags = ["-s", "-w"];
    if (command === "codevori-node") {
      flags.push(`-X=zcode.local/device-bridge/internal/nodeapp.ServiceURL=${serviceUrl}`);
      flags.push(`-X=zcode.local/device-bridge/internal/nodeapp.Version=${version}`);
      flags.push(
        `-X=zcode.local/device-bridge/internal/nodeapp.UpdateManifestURL=${assetsBaseUrl}/latest.json`,
      );
    }
    if (target.os === "win32") flags.push("-H=windowsgui");
    await exec(
      go,
      // 来源由 manifest 记录；避免主程序提交变化写进 Go VCS 信息，导致同版客户端负载漂移。
      [
        "build",
        "-trimpath",
        "-buildvcs=false",
        `-ldflags=${flags.join(" ")}`,
        "-o",
        destination,
        `./cmd/${command}`,
      ],
      {
        cwd: join(root, "apps/device-bridge"),
        maxBuffer: 4_000_000,
        env: {
          ...process.env,
          CGO_ENABLED: "0",
          GOOS: target.os === "win32" ? "windows" : target.os,
          GOARCH: target.arch === "x64" ? "amd64" : "arm64",
        },
      },
    );
  };
  if (clients) {
    await mkdir(plan.clients, { recursive: true });
    const files = [];
    for (const target of plan.clientTargets) {
      const name = `CodeVoriNode-${target.os}-${target.arch}${target.os === "win32" ? ".exe" : ""}`;
      await build(target, "codevori-node", join(plan.clients, name));
      const bytes = await readFile(join(plan.clients, name));
      files.push({
        platform: `${target.os}-${target.arch}`,
        name,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      process.stdout.write(`client ${name}: ${bytes.length} bytes\n`);
    }
    await writeFile(
      join(plan.clients, "manifest.json"),
      JSON.stringify(
        deviceNodeReleaseManifest({ version, source, dirty, serviceUrl, assetsBaseUrl, files }),
        null,
        2,
      ) + "\n",
    );
    await writeFile(join(plan.clients, "LICENSE.txt"), await readFile(join(root, "LICENSE")));
  }
  if (services) {
    await mkdir(plan.services, { recursive: true });
    for (const target of plan.serviceTargets) {
      const name = `codevori-pairing-${target.os}-${target.arch}`;
      await build(target, "codevori-pairing", join(plan.services, name));
      const binary = await readFile(join(plan.services, name));
      // Explicit service allowlist: never include client binaries, archives or the clients directory.
      const archive = executionNodeZip([
        { name: "codevori-pairing", data: binary, executable: true },
        { name: "LICENSE.txt", data: await readFile(join(root, "LICENSE")) },
        {
          name: "manifest.json",
          data: Buffer.from(
            JSON.stringify({
              version,
              source,
              dirty,
              target,
              sha256: createHash("sha256").update(binary).digest("hex"),
            }),
          ),
        },
      ]);
      await writeFile(join(plan.services, `${name}.zip`), archive);
      process.stdout.write(`service ${name}.zip: ${archive.length} bytes\n`);
    }
  }
  return plan;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDeviceNodes({
    clients: !process.argv.includes("--service-only"),
    services: !process.argv.includes("--clients-only"),
    local: process.argv.includes("--local"),
    output: process.argv.find((arg) => arg.startsWith("--output="))?.slice(9),
  });
}
