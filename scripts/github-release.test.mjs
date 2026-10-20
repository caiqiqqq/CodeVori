import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  artifactNames,
  fileHash,
  releaseTargets,
  releaseVersion,
  verifyAssets,
} from "./github-release.mjs";

const context = { tag: "v0.0.1", version: "0.0.1", commit: "a".repeat(40) };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "codevori-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifests = {};
  for (const target of releaseTargets) {
    const files = [];
    for (const name of artifactNames(context.version, target)) {
      const path = join(directory, name);
      await writeFile(path, `installer fixture ${target}`);
      files.push({ name, sha256: await fileHash(path) });
    }
    const manifest = { ...context, target, files };
    const path = join(directory, `build-${target}.json`);
    await writeFile(path, JSON.stringify(manifest));
    manifests[target] = { manifest, path };
  }
  return { directory, manifests };
}

test("release version must match the tag, rejecting shell/ref input", () => {
  assert.equal(releaseVersion("v0.0.1", "0.0.1"), "0.0.1");
  assert.equal(releaseVersion("v1.0.0-beta.1", "1.0.0-beta.1"), "1.0.0-beta.1");
  for (const tag of ["main", "v0.0.1\nfoo", "v0.0.1;id", "../v0.0.1", "v01.0.0", undefined]) {
    assert.throws(() => releaseVersion(tag, "0.0.1"));
  }
  assert.throws(() => releaseVersion("v0.0.1", "1.0.3"), /does not match/);
});

test("all four platforms must supply installers before publication", async (t) => {
  const { directory } = await fixture(t);
  assert.equal((await verifyAssets(directory, context)).length, 9);
  await rm(join(directory, "build-win-x64.json"));
  await assert.rejects(verifyAssets(directory, context), /ENOENT/);
});

test("Linux allowlist matches electron-builder package-specific architecture names", () => {
  assert.deepEqual(artifactNames("0.0.1", "linux-x64"), [
    "CodeVori-0.0.1-linux-x86_64.AppImage",
    "CodeVori-0.0.1-linux-amd64.deb",
    "CodeVori-0.0.1-linux-x86_64.rpm",
    "CodeVori-0.0.1-linux-x64.pkg.tar.zst",
  ]);
});

test("reject artifacts from another source commit", async (t) => {
  const { directory, manifests } = await fixture(t);
  const { manifest, path } = manifests["mac-arm64"];
  manifest.commit = "b".repeat(40);
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(verifyAssets(directory, context), /source mismatch/);
});

test("reject installer tampering after collection", async (t) => {
  const { directory } = await fixture(t);
  await writeFile(join(directory, "CodeVori-0.0.1-win-x64.exe"), "changed installer");
  await assert.rejects(verifyAssets(directory, context), /checksum mismatch/);
});

test("reject path traversal and duplicate files in downloaded manifests", async (t) => {
  const { directory, manifests } = await fixture(t);
  const { manifest, path } = manifests["mac-x64"];
  manifest.files[0].name = "../private.log";
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(verifyAssets(directory, context), /Unexpected installer/);
  manifest.files = [manifest.files[1], manifest.files[1]];
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(verifyAssets(directory, context), /Unexpected installer/);
});

test("reject accidental logs and other non-release files", async (t) => {
  const { directory } = await fixture(t);
  await writeFile(join(directory, "debug.log"), "not a release asset");
  await assert.rejects(verifyAssets(directory, context), /Unexpected files/);
});
