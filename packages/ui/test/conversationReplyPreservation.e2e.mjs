// Start the desktop renderer Vite server on ZCODE_E2E_BASE_URL, then run this file with Node.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__reply-preservation-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-reply-preservation-"));
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    "import '../../../ui/test/conversationReplyPreservation.fixture.tsx';",
  );
  browser = await chromium.launch({ headless: true });
  let cases = 0;
  for (const width of [1280, 375]) {
    for (const theme of ["zai-light", "zai-dark"]) {
      for (const kind of ["acp", "api"]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(
          `${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5193"}/${name}.html`,
        );
        await page.locator("[data-ready]").waitFor();
        for (const stage of ["running", "complete", "recovered"]) {
          await page.evaluate((next) => window.__replyPreservation.configure(next), {
            kind,
            theme,
            stage,
            preview: false,
          });
          await page.waitForFunction(
            ({ kind, stage, theme }) => {
              const root = document.querySelector("[data-ready]");
              return (
                root?.dataset.kind === kind &&
                root.dataset.stage === stage &&
                root.dataset.theme === theme
              );
            },
            { kind, stage, theme },
          );
          const answer = page
            .locator('[data-conversation-selectable="true"]')
            .filter({ hasText: "先检查容器状态，再按日志定位。" });
          const closing = page
            .locator('[data-conversation-selectable="true"]')
            .filter({ hasText: "记好了。等你贴日志。" });
          await answer.waitFor({ state: "visible" });
          await closing.waitFor({ state: "visible" });
          assert.equal(await answer.count(), 1);
          assert.equal(
            await answer.evaluate((node) =>
              Boolean(node.closest('[data-slot="collapsible-content"]')),
            ),
            false,
          );
          assert.equal(await page.getByText("healthz", { exact: true }).count(), 0);
          assert.equal(await page.getByText("网站", { exact: true }).count(), 0);
          await page.waitForFunction(() => {
            const texts = [...document.querySelectorAll('[data-conversation-selectable="true"]')];
            const answer = texts.find((node) =>
              node.textContent.includes("先检查容器状态，再按日志定位。"),
            );
            const closing = texts.find((node) => node.textContent.includes("记好了。等你贴日志。"));
            return (
              answer &&
              closing &&
              answer.getBoundingClientRect().height > 0 &&
              answer.getBoundingClientRect().y < closing.getBoundingClientRect().y
            );
          });
          if (stage !== "running") {
            const trigger = page.locator('[data-testid^="chat-assistant-history-trigger"]');
            await trigger.waitFor();
            assert.equal(await trigger.getAttribute("data-state"), "closed");
            await trigger.click();
            assert.equal(await trigger.getAttribute("data-state"), "open");
            await trigger.click();
            assert.equal(await trigger.getAttribute("data-state"), "closed");
            await page
              .locator('[data-testid^="chat-assistant-history-content"]')
              .first()
              .waitFor({ state: "hidden" });
            assert.equal(await answer.isVisible(), true);
            assert.equal(await closing.isVisible(), true);
          }
          cases++;
        }
        await page.evaluate(() => window.__replyPreservation.configure({ preview: true }));
        await page.getByText("网站", { exact: true }).waitFor();
        assert.equal(await page.getByText("healthz", { exact: true }).count(), 0);
        await page.locator("[data-ready]").evaluate(async (root) => {
          await Promise.all(
            root
              .getAnimations({ subtree: true })
              .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        await page.screenshot({
          path: join(artifacts, `${width}-${theme}-${kind}.png`),
          fullPage: true,
        });
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
  }
  console.log(
    `PASS: ${cases} API/ACP live/completed/recovered cases; tools toggle independently; real preview survives. Screenshots: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
