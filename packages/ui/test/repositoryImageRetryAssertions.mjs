import assert from "node:assert/strict";
import { join } from "node:path";

export async function assertRepositoryImageRecovery({
  page,
  detail,
  image,
  draft,
  row,
  artifacts,
}) {
  const picture = detail.getByTestId("repository-image");
  const retry = () => picture.getByRole("button", { name: "重试", exact: true });
  const reopen = async (failure) => {
    await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
    await page.evaluate((code) => {
      window.__detail.imageError = code;
    }, failure);
    await row().click();
  };

  await reopen("FORGE_NETWORK");
  await picture.getByText("图片下载失败，请检查网络连接后重试。", { exact: true }).waitFor();
  await draft.fill("图片重试不能丢失评论草稿");
  await picture.getByRole("button", { name: "打开原图", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => window.__detail.calls.filter((call) => call.op === "external").at(-1).url,
    ),
    "https://forge.example.invalid/git/team/sub/project/uploads/0123456789abcdef0123456789abcdef/screenshot.png",
  );
  await page.evaluate(() => {
    window.__detail.imageError = null;
    window.__detail.delayImage = true;
  });
  await retry().click();
  await picture.getByRole("status").waitFor();
  await page.waitForFunction(() => window.__detail.pendingImages.length === 1);
  assert.equal(await retry().count(), 0, "Loading state cannot submit duplicate retries");
  assert.equal(
    await page.evaluate(
      () => window.__detail.calls.filter((call) => call.op === "image").at(-1).refresh,
    ),
    true,
  );
  await page.evaluate(() => window.__detail.pendingImages.shift()());
  await image.waitFor();
  assert.equal(await draft.inputValue(), "图片重试不能丢失评论草稿");

  for (const [error, message] of [
    ["FORGE_FORBIDDEN", "当前账号无法读取图片，请检查版本控制账号及附件访问权限。"],
    ["FORGE_AUTHENTICATION", "当前账号无法读取图片，请检查版本控制账号及附件访问权限。"],
    ["FORGE_NOT_FOUND", "未找到这张图片，请打开原图确认附件是否仍然存在。"],
    ["FORGE_RATE_LIMIT", "图片请求过于频繁，请稍后重试。"],
    ["FORGE_RESPONSE", "图片内容无法显示，可重试或在浏览器中查看原图。"],
  ]) {
    await reopen(error);
    await picture.getByText(message, { exact: true }).waitFor();
    assert.equal(await detail.getByRole("button", { name: "登录 GitLab", exact: true }).count(), 0);
  }
  await reopen("FORGE_NETWORK");
  await picture.getByRole("alert").waitFor();
  await page.evaluate(() => window.__detail.setLocale("en-US"));
  await picture
    .getByText("Image download failed. Check your connection and retry.", { exact: true })
    .waitFor();
  await picture.getByRole("button", { name: "Open original image", exact: true }).waitFor();
  await page.evaluate(() => window.__detail.setLocale("zh-CN"));

  for (const [width, theme] of [
    [1280, "zai-light"],
    [390, "zai-dark"],
  ]) {
    await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
    await page.setViewportSize({ width, height: 960 });
    await page.evaluate((value) => {
      window.__detail.imageError = null;
      window.__detail.corruptImage = true;
      window.__detail.setTheme(value);
    }, theme);
    await row().click();
    await picture
      .getByText("图片内容无法显示，可重试或在浏览器中查看原图。", { exact: true })
      .waitFor();
    assert.notEqual(
      await page.evaluate(
        () => window.__detail.calls.filter((call) => call.op === "image").at(-1).refresh,
      ),
      true,
      "A newly mounted image must use the normal cache path",
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(artifacts, `image-retry-${width}-${theme}.png`) });
    await retry().click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="repository-inline-image"]')?.naturalWidth === 800,
    );
    assert.equal(
      await page.evaluate(
        () => window.__detail.calls.filter((call) => call.op === "image").at(-1).refresh,
      ),
      true,
      "Browser decode failure must force a fresh Host read",
    );
  }
  // 切换到设置再回来只是重挂载读取，不能重复发送上一次用户操作的 refresh 标记。
  await page.evaluate(() => window.__detail.setActive(false));
  await page.getByTestId("settings-cover").waitFor();
  await page.evaluate(() => window.__detail.setActive(true));
  await image.waitFor();
  assert.notEqual(
    await page.evaluate(
      () => window.__detail.calls.filter((call) => call.op === "image").at(-1).refresh,
    ),
    true,
  );
  await page.setViewportSize({ width: 1280, height: 960 });
}
