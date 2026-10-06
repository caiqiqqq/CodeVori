import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createDevElectronLaunch({
  platform = process.platform,
  executablePath,
  appPath,
  cwd,
  rendererUrl,
  env = process.env,
}) {
  const useLaunchServices = platform === "darwin" && Boolean(appPath);
  return {
    command: useLaunchServices ? "/usr/bin/open" : executablePath,
    // 直接 spawn Electron 会继承编辑器的 TCC responsibility，必须通过 LaunchServices 重建主体。
    // LaunchServices 不继承父进程的管道描述符，重定向到 /dev/stdout 会导致 -10810；沿用应用文件日志。
    args: useLaunchServices
      ? ["-n", "-W", "-a", appPath, "--env", `ELECTRON_RENDERER_URL=${rendererUrl}`, "--args", cwd]
      : ["."],
    env: { ...env, ELECTRON_RENDERER_URL: rendererUrl },
    executablePath,
    useLaunchServices,
  };
}

export async function readDevElectronApplicationAsns(executablePath, run = execFileAsync) {
  const { stdout } = await run("/usr/bin/lsappinfo", ["find", "-execpath", executablePath], {
    encoding: "utf8",
    timeout: 2000,
  });
  return new Set(stdout.match(/ASN:0x[\da-f]+-0x[\da-f]+/gi) ?? []);
}

export function findDevElectronProcesses(output, rootPid) {
  const rows = output.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]) }] : [];
  });
  const selected = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (selected.has(row.ppid) && !selected.has(row.pid)) {
        selected.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => selected.has(row.pid));
}

export async function signalDevElectronApplication({
  executablePath,
  existingAsns,
  ownedAsns,
  signal,
  run = execFileAsync,
  kill = process.kill.bind(process),
}) {
  const current = await readDevElectronApplicationAsns(executablePath, run);
  // ASN 是本次 LaunchServices 实例身份；进程改标题或 PID 重用都不能把其他实例纳入清理。
  const owned = ownedAsns ?? new Set([...current].filter((asn) => !existingAsns.has(asn)));
  for (const asn of owned) {
    if (!current.has(asn)) continue;
    const { stdout: info } = await run(
      "/usr/bin/lsappinfo",
      ["info", "-only", "pid,executablepath", `${asn}:`],
      {
        encoding: "utf8",
        timeout: 2000,
      },
    );
    const path = info.match(/executable path=("(?:[^"\\]|\\.)*")/)?.[1];
    const pid = Number(info.match(/\bpid\s*=\s*(\d+)/)?.[1]);
    if (!path || JSON.parse(path) !== executablePath || !Number.isInteger(pid) || pid <= 1)
      continue;
    const { stdout } = await run("/bin/ps", ["-axo", "pid=,ppid=,pgid="], {
      encoding: "utf8",
      timeout: 2000,
    });
    const processes = findDevElectronProcesses(stdout, pid);
    const root = processes.find((row) => row.pid === pid);
    if (!root) continue;
    try {
      if (root.pgid === pid) kill(-pid, signal);
      else for (const row of processes.reverse()) kill(row.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  return owned;
}
