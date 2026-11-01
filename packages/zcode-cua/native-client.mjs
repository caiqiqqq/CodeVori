import { spawn, execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { createLegacyIntelService } from "./legacy-intel-service.mjs";
import { HostClient, runNativeUtility } from "./vendor/open-zcode-computer-use/src/host-client.mjs";
import { verifyNativeAsset } from "./native-assets.mjs";

const nodeEnv = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: "1" });
export function createNativeService({ executable, assertActive = () => {} }) {
  if (process.platform === "darwin" && process.arch === "x64")
    return createLegacyIntelService({ executable, assertActive });
  const helper = join(dirname(executable), "helper.mjs");
  const host = new HostClient({
    executable,
    requestTimeoutMs: 40_000,
    spawnProcess: (_file, args, options) =>
      spawn(process.execPath, [helper, executable, ...args], {
        ...options,
        env: nodeEnv(),
        windowsHide: true,
      }),
  });
  const service = {
    stopped: false,
    async start() {
      await verifyNativeAsset(executable);
      assertActive();
      await host.start();
    },
    async callTool(name, args) {
      assertActive();
      const result = await host.call("tool.call", { session: host.session, name, args });
      if (name === "stop_computer_control" && !result.isError) service.stopped = true;
      return result;
    },
    async close() {
      await host.close();
    },
  };
  return { host, service };
}

export async function nativePermissions(executable) {
  if (process.platform === "darwin" && process.arch === "x64")
    return runNativeUtility("permissions", [], { executable });
  await verifyNativeAsset(executable);
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [join(dirname(executable), "helper.mjs"), executable, "permissions"],
    { env: nodeEnv(), windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024, encoding: "utf8" },
  );
  return JSON.parse(stdout);
}
