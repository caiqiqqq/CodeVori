import assert from "node:assert/strict";
import { join } from "node:path";
import { selectWorkTaskExecution } from "./workTaskExecutionConfigAssertions.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=",
  "base64",
);

export async function exerciseWorkTaskHttpAttachments(page, artifacts) {
  assert.deepEqual(
    await page.evaluate(() => ({ secure: isSecureContext, subtle: typeof crypto.subtle })),
    { secure: false, subtle: "undefined" },
    "must reproduce real LAN HTTP restrictions",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.getByTestId("work-tasks-panel");
  const editor = page.getByTestId("work-task-editor");
  await panel.getByTestId("work-task-board").waitFor();
  for (const kind of ["api", "acp"]) {
    await panel.getByTestId("work-task-new").click();
    await editor.getByTestId("work-task-prompt").fill(`HTTP image task ${kind}`);
    await selectWorkTaskExecution(
      page,
      editor,
      kind === "api" ? "custom:api:TestModel" : "acp:codex",
    );
    await editor.getByTestId("work-task-add-menu").click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("work-task-add-attachment").click();
    await (await chooser).setFiles({ name: "http.png", mimeType: "image/png", buffer: png });
    await editor.getByTestId("work-task-attachment").waitFor();

    if (kind === "api") {
      // 原生摘要存在但计算失败：本地化提示、零上传、保留草稿，然后恢复 HTTP 路径重试。
      await page.evaluate(() => {
        Object.defineProperty(crypto, "subtle", {
          configurable: true,
          value: {
            digest: async () => {
              throw new Error("Synthetic digest failure");
            },
          },
        });
      });
      await editor.getByTestId("work-task-save").click();
      await editor
        .getByRole("alert")
        .filter({ hasText: "附件校验计算失败，请重新保存或重新添加文件。" })
        .waitFor();
      assert.equal(await editor.getByTestId("work-task-attachment").count(), 1);
      assert.equal(await page.evaluate(() => window.__tasks.tasks.length), 0);
      assert.equal(
        await page.evaluate(
          () => window.__tasks.calls.filter((c) => c.op === "attachment-begin").length,
        ),
        0,
      );
      assert.match(await editor.getByTestId("work-task-prompt").innerText(), /HTTP image task api/);
      await page.screenshot({ path: join(artifacts, "http-checksum-failure-retains-draft.png") });
      await page.evaluate(() => {
        delete crypto.subtle;
      });
    }
    await editor.getByTestId("work-task-save").click();
    await editor.waitFor({ state: "detached" });
    const saved = await page.evaluate(() => window.__tasks.tasks.at(-1));
    assert.equal(saved.execution.kind, kind);
    assert.equal(saved.attachments.length, 1);
    assert.deepEqual(
      Buffer.from(
        await page.evaluate((ref) => [...window.__tasks.assets.get(ref)], saved.attachments[0].ref),
      ),
      png,
    );
    await page.screenshot({ path: join(artifacts, `http-${kind}-image-saved.png`) });
  }
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((c) => /^(start|agent-|forbidden-|acp-(create|prompt))/.test(c.op)),
    ),
    false,
  );
  process.stdout.write(
    "PASS: real insecure HTTP, 390px API/ACP image save, independent Host SHA-256 verification, localized failure retains draft and retry succeeds with zero Agent starts.\n",
  );
}
