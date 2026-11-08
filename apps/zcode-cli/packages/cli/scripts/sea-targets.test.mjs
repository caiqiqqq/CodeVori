import assert from "node:assert/strict";
import test from "node:test";
import { outputBinaryName, supportedTargets } from "./sea-targets.mjs";

test("SEA release binaries use CodeVori filenames on every target", () => {
  assert.deepEqual(
    supportedTargets.map(outputBinaryName),
    [
      "codevori-darwin-arm64",
      "codevori-darwin-x64",
      "codevori-linux-arm64",
      "codevori-linux-x64",
      "codevori-windows-arm64.exe",
      "codevori-windows-x64.exe",
    ],
  );
});
