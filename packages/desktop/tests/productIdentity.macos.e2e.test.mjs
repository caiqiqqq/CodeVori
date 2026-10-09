import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { desktopProductIdentities } from "../scripts/desktop-product-identity.mjs";

const run = promisify(execFile);
async function readLaunch(marker) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      return JSON.parse(await readFile(marker, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT" || Date.now() >= deadline) throw error;
    }
    await sleep(25);
  }
}

async function launch(args, marker, expected) {
  await run("/usr/bin/open", ["-g", "-n", ...args, "--args", marker], { timeout: 5000 });
  const { pid, ...actual } = await readLaunch(marker);
  try {
    assert.deepEqual(actual, expected);
  } finally {
    process.kill(pid, "SIGTERM");
  }
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    assert.ok(Date.now() < deadline, "fixture did not quit");
    await sleep(25);
  }
}

const lsregister =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

test(
  "LaunchServices reopens CodeVori alongside ZCode by its isolated identity",
  {
    skip: process.platform !== "darwin",
    timeout: 60_000,
  },
  async () => {
    const applications = join(homedir(), "Applications");
    await mkdir(applications, { recursive: true });
    const root = await realpath(await mkdtemp(join(applications, "codevori-reopen-e2e-")));
    const registered = [];
    try {
      // 隔离身份只验证系统解析/重开路径，不注册真实产品 ID，不修改用户授权或退出用户应用。
      const namespace = `.e2e.${randomUUID()}`;
      const source = join(root, "IdentityProbe.swift");
      const executable = join(root, "IdentityProbe");
      await writeFile(
        source,
        `
import Foundation
let bundle = Bundle.main
let data = try JSONSerialization.data(withJSONObject: [
  "bundleId": bundle.bundleIdentifier ?? "",
  "bundlePath": bundle.bundleURL.path,
  "pid": ProcessInfo.processInfo.processIdentifier,
  "name": bundle.object(forInfoDictionaryKey: "CFBundleName") as? String ?? ""
])
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .atomic)
RunLoop.current.run(until: Date().addingTimeInterval(10))
`,
      );
      await run("/usr/bin/xcrun", ["swiftc", source, "-o", executable], { timeout: 30_000 });
      const apps = [];
      for (const [name, baseId] of [
        ["ZCode", desktopProductIdentities.production.appId],
        ["CodeVori", desktopProductIdentities.production.macAppId],
      ]) {
        const bundleId = `${baseId}${namespace}`;
        const appPath = join(root, `${name}.app`);
        await mkdir(join(appPath, "Contents", "MacOS"), { recursive: true });
        await copyFile(executable, join(appPath, "Contents", "MacOS", "IdentityProbe"));
        await writeFile(
          join(appPath, "Contents", "Info.plist"),
          `<?xml version="1.0"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleName</key><string>${name}</string>
<key>CFBundleExecutable</key><string>IdentityProbe</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSBackgroundOnly</key><true/>
</dict></plist>`,
        );
        const registration = await run(lsregister, ["-f", "-lint", "-v", appPath], {
          timeout: 5_000,
        });
        assert.doesNotMatch(registration.stdout + registration.stderr, /failed|error/iu);

        registered.push(appPath);
        apps.push({ bundleId, bundlePath: appPath, name });
        const marker = join(root, `initial-${name}.json`);
        await launch(["-a", appPath], marker, apps.at(-1));
      }
      assert.notEqual(apps[0].bundleId, apps[1].bundleId);
      for (const [index, app] of [apps[0], apps[1], apps[1]].entries()) {
        const marker = join(root, `launch-${index}.json`);
        // 与系统按身份重开一样交给 LaunchServices；不能用 -a 精确路径掩盖身份冲突。
        await launch(["-b", app.bundleId], marker, app);
      }
    } finally {
      for (const path of registered) await run(lsregister, ["-u", path], { timeout: 5_000 });
      await rm(root, { recursive: true, force: true });
    }
  },
);
