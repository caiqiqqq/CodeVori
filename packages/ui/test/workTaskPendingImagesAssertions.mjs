import assert from "node:assert/strict";
import { join } from "node:path";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=",
  "base64",
);

export async function exerciseWorkTaskPendingImages(page, artifacts) {
  await page.reload();
  const panel = page.getByTestId("work-tasks-panel");
  const pending = panel.getByTestId("work-task-unstarted");
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
          title: "API images",
          prompt: "API image preview",
          attachments: attachments.slice(0, 4),
        }),
        window.__tasks.seed({
          title: "ACP images",
          prompt: "ACP image preview",
          execution: { kind: "acp", agent: "codex", config: [] },
          attachments: attachments.slice(0, 2),
        }),
        window.__tasks.seed({
          title: "Delayed image",
          prompt: "Delayed image preview",
          attachments: attachments.slice(4),
        }),
        window.__tasks.seed({
          title: "Text feedback",
          prompt: "Original input",
          runSeq: 1,
          runText: "Feedback only",
          runUsesPromptAssets: false,
          attachments: attachments.slice(0, 2),
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
    await pending.waitFor();
  };
  const chip = (name) =>
    pending.locator(`[data-testid="work-task-attachment"][title="${name}.png"]`);
  const ready = async (name) => {
    await page.waitForFunction(
      (name) =>
        document.querySelector(`[data-testid="work-task-unstarted"] img[alt="${name}.png"]`)
          ?.naturalWidth > 0,
      name,
    );
    return chip(name).locator("img").getAttribute("src");
  };

  await select(tasks[0]);
  const urls = [await ready("one"), await ready("two")];
  await chip("missing").getByRole("alert").waitFor();
  await chip("damaged").getByRole("alert").waitFor();
  const reads = await page.evaluate(
    () => window.__tasks.calls.filter((c) => c.op === "file-read").length,
  );
  await chip("one").click();
  const preview = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "one.png", exact: true }) });
  await preview.locator("img").waitFor();
  assert.equal(await preview.locator("img").getAttribute("src"), urls[0]);
  await preview.getByRole("button", { name: "Close", exact: true }).click();
  await preview.waitFor({ state: "detached" });
  assert.equal(await ready("one"), urls[0]);
  assert.equal(
    await page.evaluate(() => window.__tasks.calls.filter((c) => c.op === "file-read").length),
    reads,
  );

  await page.evaluate(
    (png) => {
      for (const name of ["missing", "damaged"])
        window.__tasks.assets.set(`/synthetic/task-attachments/${name}.png`, new Uint8Array(png));
    },
    [...png],
  );
  for (const name of ["missing", "damaged"]) {
    await chip(name).click();
    const dialog = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: `${name}.png`, exact: true }) });
    await dialog.locator("img").waitFor();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await ready(name);
  }
  await page.evaluate(() => window.__tasks.replaceFileHost());
  await page.waitForFunction(
    (urls) => urls.every((url) => window.__tasks.revokedPreviewUrls.includes(url)),
    urls,
  );
  assert.notEqual(await ready("one"), urls[0]);

  for (const task of tasks.slice(0, 2)) {
    await select(task);
    await ready("one");
    await ready("two");
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.className =
          theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
      }, theme);
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 850 });
        assert.equal(await pending.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
        await page.screenshot({
          path: join(artifacts, `pending-images-${task.execution.kind}-${theme}-${width}.png`),
        });
      }
    }
    await page.setViewportSize({ width: 1280, height: 850 });
  }
  const acpUrl = await ready("one");
  await select(tasks[3]);
  assert.equal(await pending.getByTestId("work-task-attachment").count(), 0);
  assert.match(await pending.innerText(), /Feedback only/);
  assert.ok(await page.evaluate((url) => window.__tasks.revokedPreviewUrls.includes(url), acpUrl));

  await page.evaluate(() =>
    window.__tasks.delayReadPaths.add("/synthetic/task-attachments/delayed.png"),
  );
  await select(tasks[2]);
  await chip("delayed").getByRole("status").waitFor();
  await page.waitForFunction(() =>
    window.__tasks.pendingFileReads.some((r) => r.path.endsWith("/delayed.png")),
  );
  await select(tasks[1]);
  await ready("one");
  const urlCount = await page.evaluate(() => window.__tasks.createdPreviewUrls.length);
  await page.evaluate(() =>
    window.__tasks.finishFileReads("/synthetic/task-attachments/delayed.png"),
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(await page.evaluate(() => window.__tasks.createdPreviewUrls.length), urlCount);
  assert.equal(await chip("delayed").count(), 0);
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((c) =>
        /^(start|create|update|agent-|forbidden-|acp-(create|prompt|refresh|setConfigOption))/.test(
          c.op,
        ),
      ),
    ),
    false,
  );

  // 重载后从 Host 记录重新投影，仍无需建立会话。
  await page.reload();
  await panel.getByTestId("work-task-board").waitFor();
  await page.evaluate(
    (png) => {
      window.__tasks.assets.set("/synthetic/reloaded.png", new Uint8Array(png));
      window.__tasks.seed({
        title: "Reloaded image",
        prompt: "Reloaded saved task",
        attachments: [
          {
            ref: "/synthetic/reloaded.png",
            fileName: "one.png",
            mime: "image/png",
            bytes: png.length,
          },
        ],
      });
    },
    [...png],
  );
  await panel.getByRole("button", { name: "Reloaded image", exact: true }).click();
  await ready("one");
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((c) => /^(start|create|update|agent-|forbidden-)/.test(c.op)),
    ),
    false,
  );
  process.stdout.write(
    "PASS: API/ACP pending image thumbnails, preview reuse/retry, Host replacement, delayed task switch, feedback exclusion, reload, themes/responsive layouts and zero Agent/task writes.\n",
  );
}
