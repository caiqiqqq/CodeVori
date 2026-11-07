import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { _electron as electron } from "playwright-core";

const appPath = process.env.CODEVORI_RELEASE_APP_PATH;
const { version: expectedVersion } = JSON.parse(
  await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
);

for (const migration of ["complete", "first-launch"])
  test(
    `packaged release opens after ${migration} migration without login or upstream force-update gate`,
    { skip: !appPath, timeout: 90_000 },
    async () => {
      const profile = await mkdtemp(join(tmpdir(), "codevori-release-smoke-"));
      const home = join(profile, "home");
      await mkdir(home);
      const marker = join(home, ".codevori/.migration-from-zcode.json");
      const legacySettings = join(home, ".zcode/v2/setting.json");
      // 回归依据：必须走安装包的迁移窗口路径；显式应用名会跳过它，无法发现 ready 之后注册协议的故障。
      await mkdir(join(home, ".zcode/v2"), { recursive: true });
      const settings = JSON.stringify({ desktopChromiumHardwareAccelerationEnabled: false });
      await writeFile(legacySettings, settings);
      if (migration === "complete") {
        await mkdir(join(home, ".codevori/v2"), { recursive: true });
        await writeFile(marker, JSON.stringify({ version: 1, status: "complete" }));
        await writeFile(join(home, ".codevori/v2/setting.json"), settings);
      }
      await mkdir(join(profile, "user-data"));
      let app;
      let window;
      let stderr = "";
      const pageErrors = [];
      try {
        const env = {
          ...process.env,
          HOME: home,
          ZCODE_DATA_BASE_DIR: home,
          ZCODE_DESKTOP_HOME_DIR: home,
          ZCODE_DESKTOP_USER_DATA_DIR: join(profile, "user-data"),
          ZCODE_DESKTOP_SESSION_DATA_DIR: join(profile, "session"),
        };
        delete env.ELECTRON_RUN_AS_NODE;
        delete env.NODE_OPTIONS;
        delete env.ZCODE_DESKTOP_APPLICATION_NAME;
        app = await electron.launch({
          executablePath: resolve(appPath, "Contents/MacOS/CodeVori"),
          env,
          timeout: 30_000,
        });
        app.process().stderr?.on("data", (chunk) => {
          stderr = (stderr + chunk).slice(-12_000);
        });
        const identity = await app.evaluate(({ app }) => ({
          packaged: app.isPackaged,
          version: app.getVersion(),
          name: app.getName(),
          userData: app.getPath("userData"),
        }));
        assert.equal(identity.packaged, true);
        assert.equal(identity.version, expectedVersion);
        assert.equal(identity.name, "CodeVori");
        assert.equal(identity.userData, join(profile, "user-data"));

        // 首个窗口是短暂的迁移提示；等待真正的产品窗口和可编辑输入框。
        const deadline = Date.now() + 30_000;
        while (!window && Date.now() < deadline) {
          window = app.windows().find((page) => page.url().includes("/renderer/index.html"));
          if (!window) await sleep(50);
        }
        assert.ok(window, "main window must open after the migration window closes");
        window.on("pageerror", (error) => pageErrors.push(error.message));
        await window.getByRole("textbox").first().waitFor({ timeout: 30_000 });
        const mainWindow = await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .filter((win) => win.webContents.getURL().includes("/renderer/index.html"))
            .map((win) => ({ visible: win.isVisible(), bounds: win.getBounds() })),
        );
        assert.equal(mainWindow.length, 1);
        assert.equal(mainWindow[0].visible, true);
        assert.ok(mainWindow[0].bounds.width >= 800 && mainWindow[0].bounds.height >= 600);
        assert.equal(await window.locator('[data-testid="login-api-key-input"]').count(), 0);
        const state = await window.evaluate(() => window.zcode.getUpdateState());
        // 正式产品现已接入自有更新源；检查中暂时禁用按钮不等于禁用更新器。
        // 网络和 IPC 的确定性场景由 desktopUpdateSource.electron.test.mjs 单独验证。
        assert.notDeepEqual(state, { kind: "idle", enabled: false });
        assert.equal(await window.title(), "CodeVori");
        assert.equal(JSON.parse(await readFile(marker, "utf8")).status, "complete");
        assert.equal(await readFile(legacySettings, "utf8"), settings);
        assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
        if (process.env.CODEVORI_RELEASE_SCREENSHOT) {
          await window.screenshot({ path: process.env.CODEVORI_RELEASE_SCREENSHOT });
        }
      } catch (error) {
        console.error(stderr);
        if (window && !window.isClosed()) {
          console.error(
            JSON.stringify({
              title: await window.title(),
              url: window.url(),
              body: (await window.locator("body").innerText()).slice(0, 2_000),
              pageErrors,
            }),
          );
          if (process.env.CODEVORI_RELEASE_SCREENSHOT) {
            await window.screenshot({
              path: `${process.env.CODEVORI_RELEASE_SCREENSHOT}.failure.png`,
            });
          }
        }
        throw error;
      } finally {
        // 启动失败时迁移提示可能禁止 close；清理本测试创建的进程，避免失败用例挂住整个测试运行。
        const child = app?.process();
        if (child && child.exitCode === null && child.signalCode === null) {
          const exited = once(child, "exit");
          child.kill("SIGTERM");
          const forceExit = setTimeout(() => child.kill("SIGKILL"), 3_000);
          try {
            await exited;
          } finally {
            clearTimeout(forceExit);
          }
        }
        await rm(profile, { recursive: true, force: true });
      }
    },
  );
