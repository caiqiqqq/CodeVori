import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  reveal: vi.fn(),
  openPath: vi.fn(async () => ""),
  open: vi.fn(),
}));
vi.mock("electron", () => ({
  shell: { showItemInFolder: calls.reveal, openPath: calls.openPath },
}));
vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], callback: (error: null) => void) => {
    calls.open(cmd, args);
    callback(null);
  },
}));
import { openPathInFileManager } from "../src/main/desktopMainIpcHelpers.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  vi.clearAllMocks();
});
const logger = { warn: vi.fn() };
it("files are selected in the file manager without launching their default app", async () => {
  const root = await mkdtemp(join(tmpdir(), "reveal-file-"));
  roots.push(root);
  const file = join(root, "report with spaces.md");
  await writeFile(file, "fixture");
  expect(await openPathInFileManager(file, logger)).toEqual({ success: true });
  expect(calls.reveal).toHaveBeenCalledWith(expect.stringContaining("report with spaces.md"));
  expect(calls.openPath).not.toHaveBeenCalled();
  expect(calls.open).not.toHaveBeenCalled();
});
it("directories open directly and missing targets return an error", async () => {
  const root = await mkdtemp(join(tmpdir(), "reveal-dir-"));
  roots.push(root);
  const directory = join(root, "folder");
  await mkdir(directory);
  expect(await openPathInFileManager(directory, logger)).toEqual({ success: true });
  expect(calls.reveal).not.toHaveBeenCalled();
  expect(calls.open.mock.calls.length + calls.openPath.mock.calls.length).toBe(1);
  expect((await openPathInFileManager(join(root, "missing"), logger)).success).toBe(false);
  expect((await openPathInFileManager("", logger)).success).toBe(false);
});
