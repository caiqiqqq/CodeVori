import lockfile from "proper-lockfile";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function openComputerUseStateDirectory() {
  return join(tmpdir(), `zcode-open-cua-${process.getuid?.() ?? "user"}`);
}

export async function withDesktopControlLease(run, { lockPath, onCompromised } = {}) {
  const directory = openComputerUseStateDirectory();
  if (!lockPath) await mkdir(directory, { recursive: true, mode: 0o700 });
  let release;
  try {
    release = await lockfile.lock(lockPath ?? join(directory, "desktop-control"), {
      realpath: false,
      stale: 60_000,
      update: 10_000,
      retries: 0,
      onCompromised,
    });
  } catch (error) {
    if (error.code !== "ELOCKED") throw error;
    throw Object.assign(new Error("另一个会话正在操作电脑，请等待该操作结束后重试。"), {
      code: "computer_control_busy",
      cause: error,
    });
  }
  try {
    return await run();
  } finally {
    await release();
  }
}
