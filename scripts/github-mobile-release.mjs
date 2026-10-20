import { appendFile, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectReleaseFiles,
  mobileReleaseTargets,
  publishAssets,
  validateSource,
} from "./github-release.mjs";

const root = resolve(import.meta.dirname, "..");
const directory = resolve(root, "dist-release/mobile");

export function mobileArtifactSource(target) {
  switch (target) {
    case "android-arm64-test":
      return "apps/mobile/android/app/build/outputs/apk/release/app-release.apk";
    case "ios-simulator-arm64":
      return "apps/mobile/build/CodeVori.app.zip";
    default:
      throw new Error(`Unsupported mobile target: ${target}`);
  }
}

export function assertMobileConfig(config, version) {
  if (
    config.name !== "CodeVori" ||
    config.version !== version ||
    config.ios?.bundleIdentifier !== "ai.zcode.lanmobile" ||
    config.android?.package !== "ai.zcode.lanmobile"
  ) {
    throw new Error("Mobile native configuration does not match the product/version");
  }
  return config;
}

async function validateMobileConfig() {
  const { version } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const config = JSON.parse(
    await readFile(resolve(root, "apps/mobile/build/expo-config.json"), "utf8"),
  );
  return assertMobileConfig(config, version);
}

async function main() {
  const context = await validateSource({ allowUntagged: true });
  switch (process.argv[2]) {
    case "validate":
      if (process.env.GITHUB_OUTPUT)
        await appendFile(
          process.env.GITHUB_OUTPUT,
          `version=${context.version}\ncommit=${context.commit}\n`,
        );
      break;
    case "config":
      await validateMobileConfig();
      break;
    case "collect": {
      await validateMobileConfig();
      const target = process.env.MOBILE_TARGET;
      await collectReleaseFiles(directory, context, target, [
        resolve(root, mobileArtifactSource(target)),
      ]);
      // manifest 只记录构建来源与校验值，不携带用户配置、日志和原生工程。
      if ((await readdir(directory)).length !== 2) throw new Error("Unexpected mobile build files");
      break;
    }
    case "publish":
      await publishAssets(context, {
        directory,
        targets: mobileReleaseTargets,
        checksumName: "SHA256SUMS-mobile",
        updateNotes: false,
      });
      break;
    default:
      throw new Error(
        "Usage: node scripts/github-mobile-release.mjs validate|config|collect|publish",
      );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
