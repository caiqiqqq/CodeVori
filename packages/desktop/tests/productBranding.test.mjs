import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import * as identity from "../scripts/desktop-product-identity.mjs";
import {
  DEV_ELECTRON_APP_NAME,
  DEV_ELECTRON_APP_BUNDLE_ID,
  patchDevElectronInfoPlist,
  resolveDevElectronAppBundlePath,
} from "../scripts/devElectronAppBundle.mjs";

test("public brand entrypoint is typed for Agent consumers without allowJs", async () => {
  const require = createRequire(import.meta.url);
  const profile = await mkdtemp(join(tmpdir(), "codevori-brand-types-"));
  try {
    const brand = resolve(import.meta.dirname, "../../shared/src/product-brand.mjs");
    const entry = join(profile, "consumer.mts");
    await writeFile(
      entry,
      `import {PRODUCT_NAME,PRODUCT_MARK_VIEW_BOX,PRODUCT_MARK_PATH} from ${JSON.stringify(brand)};\nconst brand: string = PRODUCT_NAME;\nconst geometry: readonly string[] = [PRODUCT_MARK_VIEW_BOX,PRODUCT_MARK_PATH];\n`,
    );
    await promisify(execFile)(
      process.execPath,
      [
        require.resolve("typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--module",
        "nodenext",
        "--target",
        "es2024",
        "--skipLibCheck",
        entry,
      ],
      { timeout: 30_000 },
    );
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("renaming preserves Windows/Linux identities and isolates macOS from ZCode", () => {
  for (const [flavor, productName, appId, linuxExecutableName] of [
    ["production", "CodeVori", "dev.zcode.app", "zcode"],
    ["preview", "CodeVori Preview", "dev.zcode.app.preview", "zcode-preview"],
  ]) {
    const product = identity.desktopProductIdentities[flavor];
    assert.equal(product.productName, productName);
    assert.equal(product.appId, appId);
    assert.equal(product.macAppId, appId.replace("zcode", "codevori"));
    assert.notEqual(product.macAppId, appId);
    assert.equal(product.linuxExecutableName, linuxExecutableName);
    assert.equal(identity.resolveWindowsAppUserModelIdForFlavor(flavor), appId);
  }
});

test("packaging selects the target platform identity for both product flavors", async () => {
  const run = promisify(execFile);
  const configUrl = new URL("../electron-builder.config.js", import.meta.url).href;
  for (const [flavor, ZCODE_ENV] of [
    ["production", "production"],
    ["preview", "test"],
  ]) {
    for (const platform of ["darwin", "win32", "linux"]) {
      const { stdout } = await run(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `import config from ${JSON.stringify(configUrl)}; process.stdout.write(JSON.stringify({appId:config.appId,productName:config.productName}));`,
        ],
        {
          env: {
            ...process.env,
            ZCODE_ENV,
            ZCODE_PREVIEW_IDENTITY: "0",
            ZCODE_TARGET_OS: platform,
            ZCODE_TARGET_ARCH: "arm64",
            ZCODE_ENABLE_MAC_SIGN: "0",
          },
          timeout: 30_000,
        },
      );
      const product = identity.desktopProductIdentities[flavor];
      assert.deepEqual(JSON.parse(stdout), {
        appId: platform === "darwin" ? product.macAppId : product.appId,
        productName: product.productName,
      });
    }
  }
});

test("backend and Preview identity remain independent after renaming", () => {
  assert.equal(
    identity.resolveDesktopProductIdentity({ ZCODE_ENV: "production" }).productName,
    "CodeVori",
  );
  for (const env of [
    { ZCODE_ENV: "test" },
    { ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1" },
    {},
  ]) {
    assert.equal(identity.resolveDesktopProductIdentity(env).productName, "CodeVori Preview");
  }
  assert.equal(identity.resolveDesktopArtifactSuffix({ ZCODE_ENV: "production" }), "");
  assert.equal(identity.resolveDesktopArtifactSuffix({ ZCODE_ENV: "test" }), "_TEST");
});

test("runtime names preserve every existing userData directory", () => {
  for (const [isPackaged, flavor, applicationName, userDataDirectoryName] of [
    [false, "production", "CodeVori Dev", "ZCode Dev"],
    [false, "preview", "CodeVori Dev", "ZCode Dev"],
    [true, "production", "CodeVori", "ZCode"],
    [true, "preview", "CodeVori Preview", "ZCode Preview"],
  ]) {
    assert.deepEqual(identity.resolveDesktopRuntimeIdentity({ isPackaged, flavor }), {
      applicationName,
      userDataDirectoryName,
    });
  }
});

test("explicit runtime names still isolate test profiles and ignore blank overrides", () => {
  assert.deepEqual(
    identity.resolveDesktopRuntimeIdentity({
      isPackaged: false,
      flavor: "production",
      applicationName: "  isolated-profile  ",
    }),
    { applicationName: "isolated-profile", userDataDirectoryName: "isolated-profile" },
  );
  assert.deepEqual(
    identity.resolveDesktopRuntimeIdentity({
      isPackaged: true,
      flavor: "preview",
      applicationName: "  ",
    }),
    { applicationName: "CodeVori Preview", userDataDirectoryName: "ZCode Preview" },
  );
});

test("macOS Dev bundle displays CodeVori with an isolated bundleId and existing deep links", () => {
  const plist = `<plist><dict>
    <key>CFBundleDisplayName</key><string>Electron</string>
    <key>CFBundleIdentifier</key><string>com.github.Electron</string>
    <key>CFBundleName</key><string>Electron</string>
  </dict></plist>`;
  const patched = patchDevElectronInfoPlist(plist);
  assert.equal(DEV_ELECTRON_APP_NAME, "CodeVori Dev");
  assert.equal(DEV_ELECTRON_APP_BUNDLE_ID, "dev.codevori.app.development");
  assert.match(patched, /CFBundleIdentifier<\/key>\s*<string>dev.codevori.app.development/);
  assert.equal(
    new Set([
      DEV_ELECTRON_APP_BUNDLE_ID,
      ...Object.values(identity.desktopProductIdentities).map((product) => product.macAppId),
    ]).size,
    3,
  );
  assert.match(patched, /CFBundleDisplayName<\/key>\s*<string>CodeVori Dev/);
  assert.match(patched, /CFBundleName<\/key>\s*<string>CodeVori Dev/);
  assert.match(patched, /<string>zcode<\/string>/);
  assert.equal(patchDevElectronInfoPlist(patched), patched);
  assert.equal(
    resolveDevElectronAppBundlePath({
      runtimeRoot: "/runtime",
      electronVersion: "41",
      arch: "arm64",
    }),
    "/runtime/41-arm64/CodeVori Dev.app",
  );
});
