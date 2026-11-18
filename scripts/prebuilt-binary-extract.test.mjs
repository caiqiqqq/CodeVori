import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { extractPrebuiltArchive, resolveTarExtractionCommand } from "./prebuilt-binary-extract.mjs";

test("Windows tar reads a cached archive on another drive without passing its drive colon", () => {
  const command = resolveTarExtractionCommand({
    archivePath: "D:\\repo\\node_modules\\.cache\\npm-11.6.0.tgz",
    extractDir: "C:\\Users\\runner\\AppData\\Local\\Temp\\extract",
    cwd: "C:\\Users\\runner\\AppData\\Local\\Temp",
    platform: "win32",
  });

  assert.equal(command.cwd, "D:\\repo\\node_modules\\.cache");
  assert.deepEqual(command.args, [
    "-xzf",
    "npm-11.6.0.tgz",
    "-C",
    "C:/Users/runner/AppData/Local/Temp/extract",
  ]);
});

test(
  "tar extracts an archive outside the caller's working directory",
  { skip: process.platform === "win32" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "codevori-tar-extract-"));
    try {
      const source = join(root, "source");
      const cache = join(root, "cache");
      const work = join(root, "work");
      mkdirSync(source);
      mkdirSync(cache);
      mkdirSync(work);
      writeFileSync(join(source, "example.txt"), "archive contents");
      const archivePath = join(cache, "example.tgz");
      execFileSync("tar", ["-czf", archivePath, "-C", source, "example.txt"]);

      const extractDir = join(work, "extract");
      extractPrebuiltArchive({ archivePath, archiveExt: "tgz", extractDir, cwd: work });
      assert.equal(existsSync(join(extractDir, "example.txt")), true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  },
);
