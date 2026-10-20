import assert from "node:assert/strict";

export async function assertRepositoryImageAuthentication({ page, detail, image, draft, row }) {
  // 旧版 GitLab 登录必须由用户显式触发；取消和失败后仍可操作详情，成功后重试当前图片。
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.evaluate(() => {
    window.__detail.needsSignIn = true;
  });
  await row().click();
  const signIn = () => detail.getByRole("button", { name: "登录 GitLab", exact: true });
  await signIn().waitFor();
  assert.equal(
    await page.evaluate(() => window.__detail.calls.filter((c) => c.op === "authenticate").length),
    0,
  );
  await page.evaluate(() => {
    window.__detail.imageSignInError = "FORGE_MEDIA_IDENTITY_CHANGED";
  });
  await detail
    .getByTestId("repository-image")
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await detail
    .getByText("GitLab 登录账号与当前版本控制账号不一致，请重新登录。", { exact: true })
    .waitFor();
  await signIn().waitFor();
  for (const failure of ["FORGE_MEDIA_AUTHENTICATION_CANCELLED", "FORGE_NETWORK"]) {
    await page.evaluate((code) => {
      window.__detail.failSignIn = code;
    }, failure);
    await signIn().click();
    await signIn().waitFor();
    assert.equal(await signIn().isEnabled(), true);
    assert.equal(await draft.isEnabled(), true);
    assert.equal(await image.count(), 0);
    if (failure === "FORGE_MEDIA_AUTHENTICATION_CANCELLED")
      assert.equal(
        await detail
          .getByText("登录未完成，请重试并使用当前版本控制账号登录。", { exact: true })
          .count(),
        0,
      );
    else
      await detail
        .getByText("登录未完成，请重试并使用当前版本控制账号登录。", { exact: true })
        .waitFor();
  }
  await page.evaluate(() => {
    window.__detail.delaySignIn = true;
  });
  await signIn().click();
  const signingIn = () => detail.getByRole("button", { name: "正在登录…", exact: true });
  await signingIn().waitFor();
  assert.equal(await signingIn().isDisabled(), true);
  assert.equal(
    await detail
      .getByTestId("repository-image")
      .getByRole("button", { name: "重试", exact: true })
      .isDisabled(),
    true,
  );
  await page.evaluate(() => window.__detail.pendingSignIns.shift()());
  await image.waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="repository-inline-image"]')?.naturalWidth === 800,
  );

  // 旧 Host 登录的迟到回包不能刷新新 Host 的图片或解除其登录按钮的 pending 状态。
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.evaluate(() => {
    window.__detail.authorizedHosts = [];
    window.__detail.delaySignIn = true;
  });
  await row().click();
  await signIn().click();
  await page.waitForFunction(() => window.__detail.pendingSignIns.length === 1);
  await page.evaluate(() => window.__detail.switchHost("A"));
  await row().waitFor();
  await page.evaluate(() => {
    window.__detail.delaySignIn = true;
  });
  await row().click();
  await signIn().click();
  await page.waitForFunction(() => window.__detail.pendingSignIns.length === 2);
  await page.evaluate(() => window.__detail.pendingSignIns.shift()());
  await signingIn().waitFor();
  assert.equal(await signingIn().isDisabled(), true);
  assert.equal(await image.count(), 0);
  await page.evaluate(() => window.__detail.pendingSignIns.shift()());
  await image.waitFor();
  assert.equal(
    await page.evaluate(() => window.__detail.calls.filter((c) => c.op === "image").at(-1).host),
    "A",
  );
}
