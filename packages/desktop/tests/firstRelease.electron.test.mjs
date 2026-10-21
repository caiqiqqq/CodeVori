import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { _electron as electron } from "playwright-core";

const appPath = process.env.CODEVORI_RELEASE_APP_PATH;
const { version: expectedVersion } = JSON.parse(
  await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
);

test(
  "packaged release opens without login or upstream force-update gate",
  { skip: !appPath, timeout: 90_000 },
  async () => {
    const profile = await mkdtemp(join(tmpdir(), "codevori-release-smoke-"));
    const home = join(profile, "home");
    await mkdir(home);
    let app;
    let window;
    const pageErrors = [];
    try {
      const env = {
        ...process.env,
        ZCODE_DATA_BASE_DIR: home,
        ZCODE_DESKTOP_HOME_DIR: home,
        ZCODE_DESKTOP_USER_DATA_DIR: join(profile, "user-data"),
        ZCODE_DESKTOP_SESSION_DATA_DIR: join(profile, "session"),
      };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.NODE_OPTIONS;
      app = await electron.launch({
        executablePath: resolve(appPath, "Contents/MacOS/CodeVori"),
        env,
        timeout: 30_000,
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

      window = await app.firstWindow();
      window.on("pageerror", (error) => pageErrors.push(error.message));
      await window.getByRole("textbox").first().waitFor({ timeout: 30_000 });
      assert.equal(await window.locator('[data-testid="login-api-key-input"]').count(), 0);
      const state = await window.evaluate(() => window.zcode.getUpdateState());
      // 正式产品现已接入自有更新源；检查中暂时禁用按钮不等于禁用更新器。
      // 网络和 IPC 的确定性场景由 desktopUpdateSource.electron.test.mjs 单独验证。
      assert.notDeepEqual(state, { kind: "idle", enabled: false });
      assert.equal(await window.title(), "CodeVori");
      if (process.env.CODEVORI_RELEASE_SCREENSHOT) {
        await window.screenshot({ path: process.env.CODEVORI_RELEASE_SCREENSHOT });
      }
    } catch (error) {
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
      await app?.close();
      await rm(profile, { recursive: true, force: true });
    }
  },
);
