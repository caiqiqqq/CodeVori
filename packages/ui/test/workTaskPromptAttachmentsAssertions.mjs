import assert from "node:assert/strict";
import { join } from "node:path";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=",
  "base64",
);

export async function exerciseWorkTaskPromptAttachments(page, artifacts) {
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 850 });
  const panel = page.getByTestId("work-tasks-panel");
  const editor = page.getByTestId("work-task-editor");
  const prompt = editor.getByTestId("work-task-prompt");
  const chips = editor.getByTestId("work-task-attachment");
  await panel.getByTestId("work-task-board").waitFor();
  const select = async (value) => {
    await editor.getByTestId("work-task-model").click();
    if (value.startsWith("custom:"))
      await page.getByTestId("chat-model-select-group-registry-provider:api").hover();
    await page.getByTestId(`chat-model-select-item-${value}`).click();
  };
  const choose = async (files) => {
    await editor.getByTestId("work-task-add-menu").click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("work-task-add-attachment").click();
    await (await chooser).setFiles(files);
  };
  const edit = async (task) => {
    await panel
      .locator(`[data-task-id="${task.id}"]`)
      .getByRole("button", { name: "任务操作", exact: true })
      .click();
    await page
      .locator('[role="menu"][data-state="open"]')
      .getByRole("menuitem", { name: "编辑任务", exact: true })
      .click();
    await editor.waitFor();
  };
  const preview = async () => {
    const image = editor.locator('[data-testid="work-task-attachment"][title="pasted.png"]');
    await image.click();
    const dialog = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: "pasted.png", exact: true }) });
    await dialog.waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector('[role="dialog"] img[alt="pasted.png"]');
      return image?.naturalWidth > 0;
    });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await editor.waitFor();
  };
  const binary = Buffer.alloc(2 * 384 * 1024 + 37);
  for (let i = 0; i < binary.length; i++) binary[i] = i % 256;
  for (const kind of ["api", "acp"]) {
    await panel.getByTestId("work-task-new").click();

    await prompt.fill("Use the supplied files");
    await select(kind === "api" ? "custom:api:TestModel" : "acp:codex");
    if (kind === "api") {
      await editor.getByRole("combobox", { name: /^思考强度:/ }).click();
      await page.getByRole("option", { name: "high", exact: true }).click();
    }
    assert.equal(await editor.locator("form").count(), 1, "composer must not nest a form");
    await prompt.press("End");
    await prompt.press("Enter");
    await page.keyboard.insertText("Second line");
    assert.equal(await page.evaluate(() => window.__tasks.tasks.length), kind === "api" ? 0 : 1);
    await choose([{ name: "binary.bin", mimeType: "application/octet-stream", buffer: binary }]);
    await chips.first().waitFor();
    await prompt.evaluate(
      (element, bytes) => {
        const data = new DataTransfer();
        data.items.add(new File([new Uint8Array(bytes)], "pasted.png", { type: "image/png" }));
        element.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
      },
      [...png],
    );
    await chips.nth(1).waitFor();
    await prompt.evaluate((element) => {
      const data = new DataTransfer();
      data.items.add(new File(["drop contents"], "dropped.txt", { type: "text/plain" }));
      element.dispatchEvent(
        new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }),
      );
    });
    await chips.nth(2).waitFor();
    await chips.last().getByTestId("work-task-attachment-remove").click();
    assert.equal(await chips.count(), 2);
    await preview();
    await prompt.evaluate((element) => {
      const data = new DataTransfer();
      data.setData(
        "application/x-zcode-workspace-file",
        JSON.stringify({
          type: "file",
          workspacePath: "/synthetic/project",
          path: "/synthetic/project/docs/spec.md",
          relativePath: "docs/spec.md",
          name: "spec.md",
        }),
      );
      element.dispatchEvent(
        new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }),
      );
    });
    await prompt.getByText("spec.md", { exact: true }).waitFor();
    await prompt.click();
    await prompt.press("ControlOrMeta+End");
    await page.keyboard.insertText(" @main");
    await page.getByRole("option", { name: /main.ts/ }).click();
    await prompt.getByText("main.ts", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => window.__tasks.calls.some((c) => c.op.startsWith("attachment-"))),
      kind === "api" ? false : true,
    );

    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.className =
          theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
      }, theme);
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 850 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          await Promise.all(
            document
              .getAnimations()
              .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        const appearance = await editor.evaluate((element) => {
          const styles = getComputedStyle(element);
          return { background: styles.backgroundColor, foreground: styles.color };
        });
        assert.equal(
          appearance.background,
          theme === "zai-light" ? "rgb(255, 255, 255)" : "rgb(43, 43, 43)",
          `task editor theme: ${JSON.stringify(appearance)}`,
        );
        assert.equal(
          await editor.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
          false,
        );
        assert.equal(
          await prompt.evaluate((element) => element.scrollWidth > element.clientWidth + 1),
          false,
        );
        await page.screenshot({
          path: join(artifacts, `task-prompt-${kind}-${theme}-${width}.png`),
        });
      }
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    if (kind === "api") {
      await page.evaluate(() => {
        window.__tasks.failUpload = true;
      });
      await editor.getByTestId("work-task-save").click();
      await editor.getByRole("alert").waitFor();
      assert.equal(await chips.count(), 2);
      assert.match(await prompt.innerText(), /Second line/);
      assert.equal(await page.evaluate(() => window.__tasks.tasks.length), 0);
      assert.equal(
        await page.evaluate(() => [...window.__tasks.uploads.values()].some((u) => !u.ref)),
        false,
      );
    }
    await page.evaluate(() => {
      window.__tasks.failSave = true;
    });
    await editor.getByTestId("work-task-save").click();
    await editor.getByRole("alert").filter({ hasText: "Synthetic save failed" }).waitFor();
    assert.equal(await chips.count(), 2);
    const committed = await page.evaluate(
      () => window.__tasks.calls.filter((c) => c.op === "attachment-commit").length,
    );
    await editor.getByTestId("work-task-save").click();
    await editor.waitFor({ state: "detached" });
    assert.equal(
      await page.evaluate(
        () => window.__tasks.calls.filter((c) => c.op === "attachment-commit").length,
      ),
      committed,
      "save retry reuses uploaded snapshots",
    );
    const task = await page.evaluate(() => window.__tasks.tasks.at(-1));
    assert.equal(task.execution.kind, kind);
    assert.deepEqual(task.workspaceFiles, ["docs/spec.md", "src/main.ts"]);
    assert.deepEqual(
      task.attachments.map((item) => item.fileName),
      ["binary.bin", "pasted.png"],
    );
    assert.deepEqual(
      Buffer.from(
        await page.evaluate((ref) => [...window.__tasks.assets.get(ref)], task.attachments[0].ref),
      ),
      binary,
    );
    assert.deepEqual(
      Buffer.from(
        await page.evaluate((ref) => [...window.__tasks.assets.get(ref)], task.attachments[1].ref),
      ),
      png,
    );
    assert.ok(task.promptEditorState.includes('"prompt-mention"'));
    assert.equal(JSON.stringify(task).includes("dataBase64"), false);
    await panel
      .locator(`[data-task-id="${task.id}"]`)
      .getByRole("button", { name: task.title, exact: true })
      .click();
    await panel
      .getByTestId("work-task-unstarted")
      .getByText("binary.bin", { exact: true })
      .waitFor();
    await panel.getByRole("button", { name: "任务详情", exact: true }).click();
    const detail = page.getByTestId("work-task-detail");
    assert.equal(await detail.getByTestId("work-task-attachment").count(), 2);
    const savedImage = detail.locator('[data-testid="work-task-attachment"][title="pasted.png"]');
    await page.waitForFunction(() => {
      const image = document.querySelector(
        '[data-testid="work-task-detail"] img[alt="pasted.png"]',
      );
      return image?.naturalWidth > 0;
    });
    const readsBeforePreview = await page.evaluate(
      () => window.__tasks.calls.filter((call) => call.op === "file-read").length,
    );
    await savedImage.click();
    const savedPreview = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "pasted.png", exact: true }),
    });
    await savedPreview.locator('img[alt="pasted.png"]').waitFor();
    assert.equal(
      await page.evaluate(
        () => window.__tasks.calls.filter((call) => call.op === "file-read").length,
      ),
      readsBeforePreview,
      "thumbnail and enlarged preview share the saved Host resource",
    );
    await page.keyboard.press("Escape");
    await savedPreview.waitFor({ state: "detached" });
    assert.ok(await savedImage.locator("img").evaluate((image) => image.naturalWidth > 0));
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    await detail.waitFor({ state: "detached" });
    await edit(task);
    assert.equal(await chips.count(), 2);
    await prompt.getByText("spec.md", { exact: true }).waitFor();
    await prompt.getByText("main.ts", { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector(
        '[data-testid="work-task-editor"] img[alt="pasted.png"]',
      );
      return image?.naturalWidth > 0;
    });
    await preview();
    assert.ok(
      await page.evaluate(() => window.__tasks.calls.some((c) => c.op === "file-read")),
      "restored preview reads saved Host bytes",
    );
    await page.evaluate(() => window.__tasks.notify());
    await chips.first().getByTestId("work-task-attachment-remove").click();
    await prompt.fill("Edited description without file references");
    await editor.getByTestId("work-task-save").click();
    await editor.waitFor({ state: "detached" });
    const edited = await page.evaluate(
      (id) => window.__tasks.tasks.find((row) => row.id === id),
      task.id,
    );
    assert.deepEqual(edited.workspaceFiles, []);
    assert.deepEqual(
      edited.attachments.map((item) => item.fileName),
      ["pasted.png"],
    );
  }

  await panel.getByTestId("work-task-new").click();

  await prompt.fill("Keep the draft when attachment saving is rejected");
  const pastedText = "Pasted reference text\n".repeat(1000);
  await prompt.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, pastedText);
  await chips.first().waitFor();
  assert.match(await chips.first().getAttribute("title"), /\.txt$/);
  assert.equal(await prompt.innerText(), "Keep the draft when attachment saving is rejected");
  await editor.getByTestId("work-task-save").click();
  await editor.waitFor({ state: "detached" });
  const textTask = await page.evaluate(() => window.__tasks.tasks.at(-1));
  assert.equal(
    Buffer.from(
      await page.evaluate(
        (ref) => [...window.__tasks.assets.get(ref)],
        textTask.attachments[0].ref,
      ),
    ).toString(),
    pastedText,
  );
  await panel.getByTestId("work-task-new").click();

  await prompt.fill("Keep the draft when attachment saving is rejected");
  await choose(
    Array.from({ length: 9 }, (_, i) => ({
      name: `file-${i}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    })),
  );
  assert.equal(await chips.count(), 8);
  for (let i = 0; i < 8; i++)
    await chips.first().getByTestId("work-task-attachment-remove").click();
  await choose([
    {
      name: "too-large.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
    },
  ]);
  await editor.getByTestId("work-task-save").click();
  await editor.getByRole("alert").waitFor();
  assert.match(await editor.getByRole("alert").innerText(), /20 MiB/);
  assert.equal(await chips.count(), 1);
  await chips.first().getByTestId("work-task-attachment-remove").click();
  await page.evaluate(() => {
    window.__tasks.localFiles.set(
      "/synthetic/local/reference.txt",
      new TextEncoder().encode("immutable local bytes"),
    );
    window.__tasks.nativePicker(["/synthetic/local/reference.txt"]);
  });
  await editor.getByTestId("work-task-add-menu").click();
  await page.getByTestId("work-task-add-attachment").click();
  await chips.first().waitFor();
  await editor.getByTestId("work-task-save").click();
  await editor.waitFor({ state: "detached" });
  const localTask = await page.evaluate(() => window.__tasks.tasks.at(-1));
  assert.equal(localTask.attachments[0].fileName, "reference.txt");
  assert.equal(
    Buffer.from(
      await page.evaluate(
        (ref) => [...window.__tasks.assets.get(ref)],
        localTask.attachments[0].ref,
      ),
    ).toString(),
    "immutable local bytes",
  );
  assert.equal(
    await page.evaluate(() =>
      window.__tasks.calls.some((call) =>
        /^(agent-|forbidden-|acp-(create|prompt|refresh|setConfigOption|setGoal|manageAgent|updateAgent))/.test(
          call.op,
        ),
      ),
    ),
    false,
  );
  assert.ok(
    await page.evaluate(() =>
      window.__tasks.calls
        .filter((call) => call.op === "attachment-chunk")
        .every((call) => call.base64Length < 1024 * 1024),
    ),
  );
  process.stdout.write(
    "PASS: shared task composer attachments, binary chunks, image and long-text paste/preview, external/workspace drops, @ file mentions, saved restoration, removals, retry retention, 8-file/20MiB limits, native file import and zero Agent commands in API/ACP and both responsive themes.\n",
  );
}
