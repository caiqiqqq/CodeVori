import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executionNodeTargets } from "./package-execution-node.mjs";
import { deviceNodeReleaseManifest } from "./package-device-node.mjs";
import { fileHash } from "./github-release.mjs";
import {
  collectNodeAssets,
  verifyNodeAssets,
  uploadNodeAssets,
} from "./github-device-node-release.mjs";

const context = { tag: "v0.0.5", commit: "a".repeat(40) };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "node-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = [];
  for (const { os, arch } of executionNodeTargets) {
    const name = `CodeVoriNode-${os}-${arch}${os === "win32" ? ".exe" : ""}`;
    await writeFile(join(directory, name), name);
    files.push({
      platform: `${os}-${arch}`,
      name,
      bytes: Buffer.byteLength(name),
      sha256: await fileHash(join(directory, name)),
    });
  }
  const manifest = deviceNodeReleaseManifest({
    version: "0.0.7",
    source: context.commit,
    dirty: false,
    serviceUrl: "https://aimodetest.cn/device-node",
    assetsBaseUrl: "https://aimodetest.cn/codevori-node/clients",
    files,
  });
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(directory, "LICENSE.txt"), "license fixture");
  return { directory, manifest, output: join(directory, "collected") };
}

test("collect six clients independently of desktop version and verify their source", async (t) => {
  const { directory, output } = await fixture(t);
  await collectNodeAssets(directory, output, context);
  const files = await verifyNodeAssets(output, context);
  assert.equal(files.length, 8);
  const manifest = JSON.parse(await readFile(join(output, "device-node-manifest.json")));
  assert.equal(manifest.version, "0.0.7");
  assert.equal(manifest.source, context.commit);
  await assert.rejects(verifyNodeAssets(output, { ...context, commit: "b".repeat(40) }), /source/);
  await writeFile(join(output, files[0].name), "corrupt");
  await assert.rejects(verifyNodeAssets(output, context), /integrity/);
});

test("dirty, missing platform, path traversal and unexpected build files are rejected", async (t) => {
  const { directory, output, manifest } = await fixture(t);
  manifest.dirty = true;
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(collectNodeAssets(directory, output, context), /source/);
  manifest.dirty = false;
  const originalName = manifest.files[0].name;
  manifest.files[0].name = "../escape";
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(collectNodeAssets(directory, output, context), /Invalid/);
  manifest.files[0].name = originalName;
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  await collectNodeAssets(directory, output, context);
  await writeFile(join(output, "private.log"), "must never publish");
  await assert.rejects(verifyNodeAssets(output, context), /Unexpected/);
  manifest.files.pop();
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(collectNodeAssets(directory, output, context), /Missing/);
});

test("publication uploads completion manifest last and refuses immutable conflicts", async (t) => {
  const { directory, output } = await fixture(t);
  await collectNodeAssets(directory, output, context);
  const files = await verifyNodeAssets(output, context);
  const calls = [];
  const gh = async (...args) => {
    calls.push(args);
    return { stdout: "" };
  };
  await uploadNodeAssets(context, output, files, [], gh);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][3], join(output, "device-node-manifest.json"));
  assert.ok(!calls.flat().includes("--clobber"));
  calls.length = 0;
  await assert.rejects(
    uploadNodeAssets(context, output, files, [], async (...args) => {
      calls.push(args);
      throw new Error("interrupted payload upload");
    }),
    /interrupted/,
  );
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes(join(output, "device-node-manifest.json")));
  const existing = files.map((f) => ({ ...f, digest: `sha256:${f.sha256}` }));
  const sums = await readFile(join(output, "SHA256SUMS-device-node"));
  existing.push({
    name: "SHA256SUMS-device-node",
    size: sums.length,
    digest: `sha256:${await fileHash(join(output, "SHA256SUMS-device-node"))}`,
  });
  calls.length = 0;
  await uploadNodeAssets(context, output, files, existing, gh);
  assert.equal(calls.length, 0);
  existing[0].digest = `sha256:${"0".repeat(64)}`;
  await assert.rejects(uploadNodeAssets(context, output, files, existing, gh), /Immutable/);
  assert.equal(calls.length, 0);
});

test("workflow gates publication on desktop and client builds and verifies before upload", async () => {
  const yaml = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(yaml, /needs: \[prepare, build, build-device-node\]/);
  assert.match(yaml, /package-device-node\.mjs --clients-only/);
  assert.match(yaml, /github-device-node-release\.mjs verify[\s\S]*github-release\.mjs publish/);
  assert.match(yaml, /github-device-node-release\.mjs publish/);
});
