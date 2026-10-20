import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  patchDevElectronInfoPlist,
  prepareDevElectronAppBundle,
} from "../scripts/devElectronAppBundle.mjs";

const plist = `<plist><dict>
  <key>CFBundleDisplayName</key><string>Electron</string>
  <key>CFBundleIdentifier</key><string>com.github.Electron</string>
  <key>CFBundleName</key><string>Electron</string>
  <key>CFBundleIconFile</key><string>electron.icns</string>
</dict></plist>`;

test("Dev bundle declares its own product icon and isolated identity with the existing protocol", () => {
  const patched = patchDevElectronInfoPlist(plist);
  assert.match(patched, /CFBundleIconFile<\/key>\s*<string>codevori.icns<\/string>/);
  assert.match(patched, /<string>dev.codevori.app.development<\/string>/);
  assert.match(patched, /<string>zcode<\/string>/);
  assert.equal(patchDevElectronInfoPlist(patched), patched);
});

test("cached Dev bundles with the ZCode identity are replaced before launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "codevori-dev-identity-"));
  try {
    const source = join(root, "Electron.app");
    await mkdir(join(source, "Contents", "MacOS"), { recursive: true });
    await writeFile(join(source, "Contents", "Info.plist"), plist);
    await writeFile(join(source, "Contents", "MacOS", "Electron"), "synthetic executable");
    const productIconPath = join(root, "product.icns");
    await writeFile(productIconPath, "product icon");
    const options = {
      electronAppPath: source,
      runtimeRoot: join(root, "runtime"),
      electronVersion: "fixture",
      arch: "arm64",
      productIconPath,
    };
    const prepared = await prepareDevElectronAppBundle(options);
    const infoPath = join(prepared.appPath, "Contents", "Info.plist");
    await writeFile(
      infoPath,
      (await readFile(infoPath, "utf8")).replace(
        "dev.codevori.app.development",
        "dev.zcode.app.development",
      ),
    );
    const marker = join(prepared.appPath, "old-identity-marker");
    await writeFile(marker, "old cached bundle");
    await prepareDevElectronAppBundle(options);
    assert.match(
      await readFile(infoPath, "utf8"),
      /<string>dev.codevori.app.development<\/string>/,
    );
    await assert.rejects(readFile(marker), { code: "ENOENT" });
    assert.equal(await readFile(join(source, "Contents", "Info.plist"), "utf8"), plist);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cached Dev bundles refresh changed icons without recopying Electron or touching its source", async () => {
  const root = await mkdtemp(join(tmpdir(), "codevori-dev-icon-"));
  try {
    const source = join(root, "Electron.app");
    await mkdir(join(source, "Contents", "MacOS"), { recursive: true });
    await writeFile(join(source, "Contents", "Info.plist"), plist);
    await writeFile(join(source, "Contents", "MacOS", "Electron"), "synthetic executable");
    const productIconPath = join(root, "product.icns");
    const options = {
      electronAppPath: source,
      runtimeRoot: join(root, "runtime"),
      electronVersion: "fixture",
      arch: "arm64",
      productIconPath,
    };
    await assert.rejects(prepareDevElectronAppBundle(options), { code: "ENOENT" });
    await writeFile(productIconPath, "first product icon");
    const prepared = await prepareDevElectronAppBundle(options);
    const installed = join(prepared.appPath, "Contents", "Resources", "codevori.icns");
    assert.equal(await readFile(installed, "utf8"), "first product icon");
    const marker = join(prepared.appPath, "cached-runtime-marker");
    await writeFile(marker, "preserve cached runtime");
    const firstWrite = (await stat(installed)).mtimeMs;
    await prepareDevElectronAppBundle(options);
    assert.equal((await stat(installed)).mtimeMs, firstWrite);
    await writeFile(productIconPath, "updated product icon");
    await prepareDevElectronAppBundle(options);
    assert.equal(await readFile(installed, "utf8"), "updated product icon");
    assert.equal(await readFile(marker, "utf8"), "preserve cached runtime");
    assert.equal(await readFile(join(source, "Contents", "Info.plist"), "utf8"), plist);
    await assert.rejects(readFile(join(source, "Contents", "Resources", "codevori.icns")), {
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
