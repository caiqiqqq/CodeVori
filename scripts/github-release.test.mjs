import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  artifactNames,
  fileHash,
  collectReleaseFiles,
  mobileReleaseTargets,
  releaseTargets,
  releaseVersion,
  verifyAssets,
  validateSource,
  publishAssets,
} from "./github-release.mjs";
import { assertMobileConfig, mobileArtifactSource } from "./github-mobile-release.mjs";

const context = { tag: "v0.0.1", version: "0.0.1", commit: "a".repeat(40) };

async function fixture(t, targets = releaseTargets) {
  const directory = await mkdtemp(join(tmpdir(), "codevori-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifests = {};
  for (const target of targets) {
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

test("mobile artifacts explicitly distinguish Android test signing and iOS simulator", () => {
  assert.deepEqual(artifactNames("0.0.1", "android-arm64-test"), [
    "CodeVori-0.0.1-android-arm64-test.apk",
  ]);
  assert.deepEqual(artifactNames("0.0.1", "ios-simulator-arm64"), [
    "CodeVori-0.0.1-ios-simulator-arm64.app.zip",
  ]);
  assert.throws(() => mobileArtifactSource("ios-ipa"), /Unsupported/);
  assert.throws(() => artifactNames("0.0.1", "android-production"), /Unsupported/);
});

test("both mobile platforms are required; desktop files are not accepted as mobile artifacts", async (t) => {
  const { directory } = await fixture(t, mobileReleaseTargets);
  assert.equal((await verifyAssets(directory, context, mobileReleaseTargets)).length, 2);
  await assert.rejects(verifyAssets(directory, context), /ENOENT/);
  await rm(join(directory, "build-ios-simulator-arm64.json"));
  await assert.rejects(verifyAssets(directory, context, mobileReleaseTargets), /ENOENT/);
});

test("mobile publication rejects mixed commits, tampering and unexpected private files", async (t) => {
  const { directory, manifests } = await fixture(t, mobileReleaseTargets);
  const { manifest, path } = manifests["android-arm64-test"];
  manifest.commit = "b".repeat(40);
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(verifyAssets(directory, context, mobileReleaseTargets), /source mismatch/);
  manifest.commit = context.commit;
  await writeFile(path, JSON.stringify(manifest));
  await writeFile(join(directory, "signing.keystore"), "must never be uploaded");
  await assert.rejects(verifyAssets(directory, context, mobileReleaseTargets), /Unexpected files/);
  await rm(join(directory, "signing.keystore"));
  await writeFile(join(directory, manifest.files[0].name), "modified");
  await assert.rejects(verifyAssets(directory, context, mobileReleaseTargets), /checksum mismatch/);
});

test("collection copies only declared artifacts and writes their exact source/hash", async (t) => {
  const { directory } = await fixture(t, []);
  const source = join(directory, "input.apk");
  await writeFile(source, "fixture apk");
  const output = join(directory, "collected");
  await collectReleaseFiles(output, context, "android-arm64-test", [source]);
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(
    await readFile(join(output, "build-android-arm64-test.json"), "utf8"),
  );
  assert.equal(manifest.commit, context.commit);
  assert.equal(manifest.files[0].sha256, await fileHash(source));
  assert.equal(manifest.files[0].name, "CodeVori-0.0.1-android-arm64-test.apk");
  await assert.rejects(collectReleaseFiles(output, context, "android-arm64-test", []), /count/);
});

test("native app configuration must match root version, product and application identifiers", () => {
  const config = {
    name: "CodeVori",
    version: "0.0.1",
    ios: { bundleIdentifier: "ai.zcode.lanmobile" },
    android: { package: "ai.zcode.lanmobile" },
  };
  assert.equal(assertMobileConfig(config, "0.0.1"), config);
  assert.throws(
    () => assertMobileConfig({ ...config, version: "0.1.0" }, "0.0.1"),
    /does not match/,
  );
  assert.throws(() => assertMobileConfig({ ...config, name: "ZCode" }, "0.0.1"), /does not match/);
  assert.throws(() => assertMobileConfig({ ...config, ios: {} }, "0.0.1"), /does not match/);
});

test("untagged mobile builds are allowed but cannot publish or weaken desktop validation", async () => {
  const previous = process.env.RELEASE_TAG;
  delete process.env.RELEASE_TAG;
  try {
    await assert.rejects(validateSource(), /Release tag/);
    const source = await validateSource({ allowUntagged: true });
    assert.equal(source.tag, null);
    assert.match(source.commit, /^[a-f0-9]{40}$/);
    await assert.rejects(publishAssets(source), /requires a release tag/);
  } finally {
    if (previous === undefined) delete process.env.RELEASE_TAG;
    else process.env.RELEASE_TAG = previous;
  }
});

test("empty mobile artifacts cannot be collected or published", async (t) => {
  const { directory } = await fixture(t, mobileReleaseTargets);
  await writeFile(join(directory, artifactNames("0.0.1", "android-arm64-test")[0]), "");
  await assert.rejects(verifyAssets(directory, context, mobileReleaseTargets), /Empty installer/);
});
