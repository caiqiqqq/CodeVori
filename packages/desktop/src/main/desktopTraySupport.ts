import { execFile } from "node:child_process";

const watcherName = "org.kde.StatusNotifierWatcher";
const probes = [
  [
    "gdbus",
    [
      "call",
      "--session",
      "--dest",
      "org.freedesktop.DBus",
      "--object-path",
      "/org/freedesktop/DBus",
      "--method",
      "org.freedesktop.DBus.NameHasOwner",
      watcherName,
    ],
  ],
  [
    "busctl",
    [
      "--user",
      "call",
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "NameHasOwner",
      "s",
      watcherName,
    ],
  ],
  [
    "qdbus",
    [
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus.NameHasOwner",
      watcherName,
    ],
  ],
] as const;

export function parseStatusNotifierOwnerOutput(stdout: string): boolean | null {
  const value = stdout.trim();
  if (/^\(true,?\)$/.test(value) || /^b\s+"?true"?$/.test(value) || value === "true") return true;
  if (/^\(false,?\)$/.test(value) || /^b\s+"?false"?$/.test(value) || value === "false")
    return false;
  return null;
}

type ExecuteProbe = (command: string, args: readonly string[]) => Promise<string>;

const executeProbe: ExecuteProbe = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, [...args], { timeout: 1500, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

export async function detectLinuxTraySupport(
  execute: ExecuteProbe = executeProbe,
): Promise<boolean> {
  for (const [command, args] of probes) {
    try {
      const result = parseStatusNotifierOwnerOutput(await execute(command, args));
      if (result !== null) return result;
    } catch {
      // A missing DBus tool or unavailable session bus is not tray support.
    }
  }
  return false;
}

export function resolveCloseToTraySupported(
  platform: NodeJS.Platform,
  trayReady: boolean,
  watcherReady: boolean,
): boolean {
  if (platform === "win32") return trayReady;
  if (platform === "linux") return trayReady && watcherReady;
  return false;
}

export function shouldHideWindowToTray(input: {
  platform: NodeJS.Platform;
  enabled: boolean | undefined;
  supported: boolean | undefined;
  forceQuit?: boolean;
  explicitQuitRequested?: boolean;
}): boolean {
  return (
    (input.platform === "win32" || input.platform === "linux") &&
    input.enabled === true &&
    input.supported === true &&
    !input.forceQuit &&
    !input.explicitQuitRequested
  );
}

export function resolveCloseToTrayBootstrapValue(
  platform: NodeJS.Platform,
  stored: boolean | undefined,
  linuxMigrationInitialized: boolean | undefined,
): { value: boolean; needsMigration: boolean } {
  if (platform !== "linux") return { value: stored ?? true, needsMigration: false };
  if (linuxMigrationInitialized !== true) return { value: false, needsMigration: true };
  return { value: stored ?? false, needsMigration: false };
}
