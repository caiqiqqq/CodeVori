import assert from "node:assert/strict";
import { join } from "node:path";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=",
  "base64",
);

export async function exerciseWorkTaskImageResources(page, artifacts) {
  await page.reload();
  const panel = page.getByTestId("work-tasks-panel");
  const detail = page.getByTestId("work-task-detail");
  await panel.getByTestId("work-task-board").waitFor();
  const tasks = await page.evaluate(
    (png) => {
      const attachments = ["one", "two", "missing", "damaged", "delayed"].map((name) => ({
        ref: `/synthetic/task-attachments/${name}.png`,
        fileName: `${name}.png`,
        mime: "image/png",
        bytes: png.length,
      }));
      for (const name of ["one", "two", "delayed"])
        window.__tasks.assets.set(`/synthetic/task-attachments/${name}.png`, new Uint8Array(png));
      window.__tasks.assets.set(
        "/synthetic/task-attachments/damaged.png",
        new TextEncoder().encode("damaged image"),
      );
      return [
        window.__tasks.seed({
          title: "Saved images",
          prompt: "Saved attachment previews",
          attachments: attachments.slice(0, 4),
        }),
        window.__tasks.seed({
          title: "Delayed image",
          prompt: "Delayed attachment preview",
          attachments: attachments.slice(4),
        }),
      ];
    },
    [...png],
  );
  const select = async (task) => {
    await panel
      .locator(`[data-task-id="${task.id}"]`)
      .getByRole("button", { name: task.title, exact: true })
      .click();
  };
  const openDetail = async (task) => {
    await select(task);
    await panel.getByRole("button", { name: "任务详情", exact: true }).click();
    await detail.waitFor();
  };
  const chip = (name) =>
    detail.locator(`[data-testid="work-task-attachment"][title="${name}.png"]`);
  const ready = async (name) => {
    await page.waitForFunction((name) => {
      const image = document.querySelector(
        `[data-testid="work-task-detail"] img[alt="${name}.png"]`,
      );
      return image?.naturalWidth > 0;
    }, name);
    return chip(name).locator("img").getAttribute("src");
  };
  const closeDetail = async () => {
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    await detail.waitFor({ state: "detached" });
  };

  await openDetail(tasks[0]);
  const originalUrls = [await ready("one"), await ready("two")];
  await chip("missing").getByRole("alert").waitFor();
  await chip("damaged").getByRole("alert").waitFor();
  assert.match(await chip("damaged").getByRole("alert").innerText(), /无法预览/);
  const reads = await page.evaluate(
    () => window.__tasks.calls.filter((call) => call.op === "file-read").length,
  );
  await page.evaluate(() => window.__tasks.notify());
  assert.equal(
    await page.evaluate(
      () => window.__tasks.calls.filter((call) => call.op === "file-read").length,
    ),
    reads,
    "notifications never automatically retry damaged files",
  );

  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(
        await detail.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
        false,
      );
      await page.screenshot({ path: join(artifacts, `saved-images-${theme}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 1280, height: 850 });

  await page.evaluate(
    (png) => {
      for (const name of ["missing", "damaged"])
        window.__tasks.assets.set(`/synthetic/task-attachments/${name}.png`, new Uint8Array(png));
    },
    [...png],
  );
  for (const name of ["missing", "damaged"]) {
    await chip(name).click();
    const preview = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: `${name}.png`, exact: true }) });
    await preview.locator("img").waitFor();
    await preview.getByRole("button", { name: "Close", exact: true }).click();
    await preview.waitFor({ state: "detached" });
    await ready(name);
  }

  // Host 改变时不能继续显示旧 Host 的临时资源，即使路径完全相同。
  await page.evaluate(() => window.__tasks.replaceFileHost());
  await page.waitForFunction(
    (urls) => urls.every((url) => window.__tasks.revokedPreviewUrls.includes(url)),
    originalUrls,
  );
  const newUrl = await ready("one");
  assert.ok(!originalUrls.includes(newUrl));
  await closeDetail();
  assert.ok(await page.evaluate((url) => window.__tasks.revokedPreviewUrls.includes(url), newUrl));

  await page.evaluate(() =>
    window.__tasks.delayReadPaths.add("/synthetic/task-attachments/delayed.png"),
  );
  await openDetail(tasks[1]);
  await chip("delayed").getByRole("status").waitFor();
  await page.waitForFunction(() =>
    window.__tasks.pendingFileReads.some((read) => read.path.endsWith("/delayed.png")),
  );
  await closeDetail();
  await openDetail(tasks[0]);
  await ready("one");
  await ready("two");
  await ready("missing");
  await ready("damaged");
  const urlCount = await page.evaluate(() => window.__tasks.createdPreviewUrls.length);
  await page.evaluate(() =>
    window.__tasks.finishFileReads("/synthetic/task-attachments/delayed.png"),
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(
    await page.evaluate(() => window.__tasks.createdPreviewUrls.length),
    urlCount,
    "closed/superseded reads never create late object URLs",
  );
  assert.equal(await chip("delayed").count(), 0);
  await closeDetail();

  // 编辑器移除图片只释放 UI 资源，不删除 Host 快照；取消也不执行任务。
  await panel
    .locator(`[data-task-id="${tasks[0].id}"]`)
    .getByRole("button", { name: "任务操作", exact: true })
    .click();
  await page
    .locator('[role="menu"][data-state="open"]')
    .getByRole("menuitem", { name: "编辑任务", exact: true })
    .click();
  const editor = page.getByTestId("work-task-editor");
  await editor.waitFor();
  const firstImage = editor.locator('[data-testid="work-task-attachment"][title="one.png"]');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="work-task-editor"] img[alt="one.png"]')?.naturalWidth >
      0,
  );
  const editorUrl = await firstImage.locator("img").getAttribute("src");
  await firstImage.getByTestId("work-task-attachment-remove").click();
  await firstImage.waitFor({ state: "detached" });
  assert.ok(
    await page.evaluate((url) => window.__tasks.revokedPreviewUrls.includes(url), editorUrl),
  );
  assert.ok(
    await page.evaluate(() => window.__tasks.assets.has("/synthetic/task-attachments/one.png")),
  );
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((call) =>
        /^(start|create|update|agent-|forbidden-|acp-(create|prompt|refresh|setConfigOption))/.test(
          call.op,
        ),
      ),
    ),
    false,
  );
  process.stdout.write(
    "PASS: saved image thumbnails, multiple images, missing/corrupt retry, Host replacement, delayed close/task switch, removal cleanup, both themes and responsive widths, zero Agent/task writes.\n",
  );
}
