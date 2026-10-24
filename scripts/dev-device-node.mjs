import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildDeviceNodes,
  deviceNodeBuildPlan,
  validateBuildServiceUrl,
} from "./package-device-node.mjs";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
export const localNodeRoot = join(root, "output/device-node-local");
export const localNodeUrl = "http://127.0.0.1:18081";

export async function prepareLocalDeviceNode({ build = true, directory = localNodeRoot } = {}) {
  const version = JSON.parse(
    await readFile(join(root, "scripts/device-node-version.json"), "utf8"),
  ).version;
  const plan = deviceNodeBuildPlan(version, directory);
  if (build)
    await buildDeviceNodes({
      clients: true,
      services: false,
      local: true,
      output: directory,
      serviceUrl: localNodeUrl,
    });
  const manifest = JSON.parse(await readFile(join(plan.clients, "manifest.json"), "utf8"));
  if (validateBuildServiceUrl(manifest.serviceUrl, true) !== localNodeUrl)
    throw new Error("Local clients must be built for the configured local service");
  const service = join(directory, "service", "codevori-pairing");
  const state = join(directory, "state");
  await mkdir(join(directory, "service"), { recursive: true });
  await mkdir(state, { recursive: true, mode: 0o700 });
  if (build)
    await exec(
      process.env.GO_BINARY || "go",
      ["build", "-trimpath", "-ldflags=-s -w", "-o", service, "./cmd/codevori-pairing"],
      {
        cwd: join(root, "apps/device-bridge"),
        maxBuffer: 4_000_000,
        env: { ...process.env, CGO_ENABLED: "0" },
      },
    );
  await writeFile(join(directory, "main.env"), `CODEVORI_NODE_SERVICE_URL=${localNodeUrl}\n`, {
    mode: 0o600,
  });
  if (process.platform === "darwin") {
    const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
    await writeFile(
      join(directory, "启动本地联调.command"),
      `#!/bin/zsh\ncd ${quote(root)}\nexport PATH=${quote(dirname(process.execPath))}:"$PATH"\nexec ${quote(process.execPath)} ${quote(join(root, "scripts/dev-device-node.mjs"))} --no-build --desktop\n`,
      { mode: 0o755 },
    );
  }
  return { directory, service, state, clients: plan.clients, serviceUrl: localNodeUrl };
}

export function startLocalPairing(config, state = config.state) {
  return spawn(config.service, [], {
    cwd: config.directory,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      CODEVORI_PAIRING_LISTEN: "127.0.0.1:18081",
      CODEVORI_PAIRING_STATE_DIR: state,
      CODEVORI_NODE_SERVICE_URL: config.serviceUrl,
      CODEVORI_NODE_ASSETS_DIR: config.clients,
      CODEVORI_NODE_ASSETS_URL: "",
    },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = await prepareLocalDeviceNode({ build: !process.argv.includes("--no-build") });
  const probe = createServer();
  probe.listen(18081, "127.0.0.1");
  await once(probe, "listening");
  await new Promise((resolve) => probe.close(resolve));
  const service = startLocalPairing(config);
  const exited = once(service, "exit");
  let desktop;
  let desktopExitCode = 0;
  service.stderr.on("data", (chunk) => process.stderr.write(chunk));
  service.on("error", (error) => process.stderr.write(`Local service failed: ${error.message}\n`));
  const stop = () => {
    service.kill("SIGTERM");
    if (desktop?.pid && desktop.exitCode === null && desktop.signalCode === null) {
      if (process.platform === "win32") desktop.kill("SIGTERM");
      else {
        try {
          process.kill(-desktop.pid, "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const [code] = await once(service, "spawn").then(async () => {
    // 等服务真正监听再启动主端；端口冲突时只退出自己的子进程。
    for (let attempt = 0; attempt < 50; attempt++) {
      if (service.exitCode !== null) throw new Error("Local pairing service exited");
      if (
        await fetch(localNodeUrl + "/healthz")
          .then((r) => r.ok)
          .catch(() => false)
      )
        break;
      if (attempt === 49) {
        stop();
        throw new Error("Local pairing service did not become ready");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (process.argv.includes("--desktop")) {
      desktop = spawn(process.execPath, [join(root, "scripts/dev-desktop-env.mjs"), "production"], {
        cwd: root,
        stdio: "inherit",
        detached: process.platform !== "win32",
        env: {
          ...process.env,
          CODEVORI_NODE_SERVICE_URL: localNodeUrl,
          ZCODE_DESKTOP_APPLICATION_NAME: "CodeVori Node Local",
          ZCODE_DESKTOP_USER_DATA_DIR: join(config.directory, "main"),
          ZCODE_DATA_BASE_DIR: join(config.directory, "data"),
        },
      });
      desktop.once("error", () => {
        desktopExitCode = 1;
        stop();
      });
      desktop.once("exit", (code) => {
        desktopExitCode = code ?? 0;
        stop();
      });
    }
    process.stdout.write(
      `Local execution-node folder: ${config.directory}\nPairing: ${config.serviceUrl}\nMain environment: ${join(config.directory, "main.env")}\nCtrl+C stops this service.\n`,
    );
    return exited;
  });
  stop();
  process.exitCode = desktopExitCode || (code ?? 0);
}
