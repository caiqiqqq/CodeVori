import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactNames,
  assertRemoteReleaseSource,
  mobileReleaseTargets,
  releaseTargets,
  validateSource,
} from "./github-release.mjs";
import {
  findReleaseByTag,
  github,
  hasReleaseAssets,
  readReleaseAsset,
} from "./github-release-remote.mjs";
import { executionNodeTargets } from "./package-execution-node.mjs";

export async function releaseBuildComplete(context, distribution, gh = github) {
  if (!["desktop", "mobile"].includes(distribution))
    throw new Error("Unknown release distribution");
  await assertRemoteReleaseSource(context, gh);
  const release = await findReleaseByTag(context.tag, gh);
  const targets = distribution === "mobile" ? mobileReleaseTargets : releaseTargets;
  const names = targets.flatMap((target) => artifactNames(context.version, target));
  const checksum = distribution === "mobile" ? "SHA256SUMS-mobile" : "SHA256SUMS";
  if (!(await hasReleaseAssets(release, names, checksum, gh))) return false;
  if (distribution === "mobile") return true;
  const clientNames = executionNodeTargets.map(
    ({ os, arch }) => `CodeVoriNode-${os}-${arch}${os === "win32" ? ".exe" : ""}`,
  );
  const marker = "device-node-manifest.json";
  if (
    !(await hasReleaseAssets(
      release,
      [...clientNames, "CodeVoriNode-LICENSE.txt", marker],
      "SHA256SUMS-device-node",
      gh,
    ))
  )
    return false;
  const manifest = JSON.parse(
    await readReleaseAsset(
      release.assets.find((asset) => asset.name === marker),
      gh,
    ),
  );
  if (manifest.source !== context.commit || manifest.dirty !== false)
    throw new Error("Remote client source mismatch");
  return true;
}

export async function skipCompletedRelease(context, distribution, eventName, gh = github) {
  // 原因：草稿构建完成后公开会再触发 release 事件；只有资产与校验表齐全才跳过。
  // 手动 dispatch 仍允许明确重建，普通 PR 和未指定标签的移动构建不访问 Release。
  return eventName === "release" && (await releaseBuildComplete(context, distribution, gh));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const context = await validateSource({ allowUntagged: true });
    const skip = await skipCompletedRelease(
      context,
      process.argv[2],
      process.env.GITHUB_EVENT_NAME,
    );
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `skip=${skip}\n`);
    console.log(
      skip ? "Verified release assets already complete; skipping rebuild" : "Build required",
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
