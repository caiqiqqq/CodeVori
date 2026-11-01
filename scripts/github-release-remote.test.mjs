import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { artifactNames, mobileReleaseTargets, releaseTargets } from "./github-release.mjs";
import { findReleaseByTag } from "./github-release-remote.mjs";
import { releaseBuildComplete, skipCompletedRelease } from "./github-release-status.mjs";
import { executionNodeTargets } from "./package-execution-node.mjs";

process.env.GITHUB_REPOSITORY = "owner/repo";
const context = { tag: "v0.0.12", version: "0.0.12", commit: "a".repeat(40) };
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function remoteFixture() {
  const release = { id: 9, tag_name: context.tag, draft: false, assets: [] };
  const contents = new Map();
  const calls = [];
  const add = (name, content = name) => {
    const asset = {
      id: release.assets.length + 1,
      name,
      state: "uploaded",
      size: Buffer.byteLength(content),
      digest: digest(content),
    };
    contents.set(asset.id, content);
    release.assets.push(asset);
    return asset;
  };
  const group = (names, checksum) => {
    const files = names.map((name) => add(name));
    add(checksum, files.map((file) => `${file.digest.slice(7)}  ${file.name}\n`).join(""));
  };
  group(
    releaseTargets.flatMap((target) => artifactNames(context.version, target)),
    "SHA256SUMS",
  );
  group(
    mobileReleaseTargets.flatMap((target) => artifactNames(context.version, target)),
    "SHA256SUMS-mobile",
  );
  const clients = executionNodeTargets.map(
    ({ os, arch }) => `CodeVoriNode-${os}-${arch}${os === "win32" ? ".exe" : ""}`,
  );
  const files = [...clients, "CodeVoriNode-LICENSE.txt"].map((name) => add(name));
  files.push(
    add("device-node-manifest.json", JSON.stringify({ source: context.commit, dirty: false })),
  );
  add(
    "SHA256SUMS-device-node",
    files.map((file) => `${file.digest.slice(7)}  ${file.name}\n`).join(""),
  );
  const gh = async (...args) => {
    calls.push(args);
    const endpoint = args[1];
    if (endpoint === `repos/owner/repo/git/ref/tags/${context.tag}`)
      return { stdout: JSON.stringify({ object: { type: "commit", sha: context.commit } }) };
    if (endpoint === "repos/owner/repo/releases?per_page=100&page=1")
      return { stdout: JSON.stringify([{ id: release.id, tag_name: context.tag }]) };
    if (endpoint === "repos/owner/repo/releases/9") return { stdout: JSON.stringify(release) };
    const assetId = /^repos\/owner\/repo\/releases\/assets\/(\d+)$/.exec(endpoint)?.[1];
    if (assetId && contents.has(Number(assetId))) return { stdout: contents.get(Number(assetId)) };
    throw new Error(`Unexpected GitHub operation: ${args.join(" ")}`);
  };
  return { release, contents, gh, calls };
}

test("release lookup paginates and reads the matching draft by ID", async () => {
  const calls = [];
  const release = { id: 112, tag_name: context.tag, draft: true, assets: [] };
  const gh = async (...args) => {
    calls.push(args);
    if (args[1].endsWith("page=1"))
      return {
        stdout: JSON.stringify(
          Array.from({ length: 100 }, (_, id) => ({ id, tag_name: `v1.0.${id}` })),
        ),
      };
    if (args[1].endsWith("page=2")) return { stdout: JSON.stringify([release]) };
    if (args[1].endsWith("/112")) return { stdout: JSON.stringify(release) };
    throw new Error("Tag endpoint must not be used for drafts");
  };
  assert.deepEqual(await findReleaseByTag(context.tag, gh), release);
  assert.equal(calls.length, 3);
  await assert.rejects(
    findReleaseByTag(context.tag, async () => ({ stdout: "[]" })),
    /not found/,
  );
  await assert.rejects(
    findReleaseByTag(context.tag, async (...args) => ({
      stdout: JSON.stringify(
        args[1].includes("?") ? [release] : { ...release, tag_name: "v0.0.13" },
      ),
    })),
    /tag changed/,
  );
});

test("published events skip complete desktop/client and mobile assets without uploading", async () => {
  const { gh, calls } = remoteFixture();
  for (const distribution of ["desktop", "mobile"])
    assert.equal(await skipCompletedRelease(context, distribution, "release", gh), true);
  assert.ok(calls.every((args) => args[0] === "api" && !args.includes("--method")));
});

test("manual rebuilds and untagged/PR builds do not query or skip releases", async () => {
  const gh = async () => {
    throw new Error("Unexpected network operation");
  };
  for (const event of ["workflow_dispatch", "pull_request", undefined])
    assert.equal(await skipCompletedRelease({ ...context, tag: null }, "mobile", event, gh), false);
});

test("incomplete assets build normally, independently for desktop and mobile", async () => {
  const { release, gh } = remoteFixture();
  release.assets = release.assets.filter((asset) => asset.name !== "CodeVoriNode-win32-x64.exe");
  assert.equal(await releaseBuildComplete(context, "desktop", gh), false);
  assert.equal(await releaseBuildComplete(context, "mobile", gh), true);
  release.assets = release.assets.filter((asset) => asset.name !== "SHA256SUMS-mobile");
  assert.equal(await releaseBuildComplete(context, "mobile", gh), false);
});

test("tampered hashes and client sources cannot be mistaken for completed releases", async () => {
  const { release, contents, gh } = remoteFixture();
  const asset = release.assets.find((file) => file.name.endsWith(".apk"));
  asset.digest = digest("wrong bytes");
  await assert.rejects(releaseBuildComplete(context, "mobile", gh), /integrity mismatch/);
  const marker = release.assets.find((file) => file.name === "device-node-manifest.json");
  const bad = JSON.stringify({ source: "b".repeat(40), dirty: false });
  contents.set(marker.id, bad);
  marker.digest = digest(bad);
  const table = release.assets.find((file) => file.name === "SHA256SUMS-device-node");
  const text = contents
    .get(table.id)
    .replace(
      /^[a-f0-9]{64}  device-node-manifest.json$/m,
      `${marker.digest.slice(7)}  device-node-manifest.json`,
    );
  contents.set(table.id, text);
  table.digest = digest(text);
  await assert.rejects(releaseBuildComplete(context, "desktop", gh), /source mismatch/);
});

test("moved source tags and modified checksum downloads fail before skipping builds", async () => {
  const { contents, release, gh } = remoteFixture();
  const moved = async (...args) =>
    args[1].includes("git/ref/tags/")
      ? { stdout: JSON.stringify({ object: { type: "commit", sha: "b".repeat(40) } }) }
      : gh(...args);
  await assert.rejects(releaseBuildComplete(context, "desktop", moved), /tag changed/);
  const sums = release.assets.find((asset) => asset.name === "SHA256SUMS-mobile");
  contents.set(sums.id, "corrupted checksum response");
  await assert.rejects(releaseBuildComplete(context, "mobile", gh), /checksum mismatch/);
});

test("both workflows gate expensive builds on verified completion and checks include regressions", async () => {
  for (const name of ["release", "mobile"]) {
    const yaml = await readFile(
      new URL(`../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    );
    assert.match(yaml, /skip: \$\{\{ steps.existing.outputs.skip \}\}/);
    assert.match(yaml, /if: needs.prepare.outputs.skip != 'true'/);
    assert.match(yaml, /github-release-status\.mjs (desktop|mobile)/);
  }
  const checks = await readFile(
    new URL("../.github/workflows/checks.yml", import.meta.url),
    "utf8",
  );
  assert.match(checks, /github-release-remote\.test\.mjs/);
  assert.match(checks, /electronBuilderRetry\.test\.mjs/);
});
