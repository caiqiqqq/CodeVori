import assert from "node:assert/strict";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__empty-tools-${process.pid}`;
const files = [join(root, `${name}.html`), join(root, `${name}.tsx`)];
let browser;
try {
  await writeFile(
    files[0],
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  const fixture = (
    await readFile(new URL("./conversationReplyPreservation.fixture.tsx", import.meta.url), "utf8")
  )
    .replaceAll('"../src/', '"../../../ui/src/')
    .replace(
      "const rows = makeRows(view);",
      `const rows = makeRows(view);
 if(view.kind==='api') rows.splice(rows.length-1,0,{kind:'toolCall',rowId:6.5,turnId:'api:fixture',createdAt:106,createdAtSeq:6.5,toolCallId:'blank-placeholder',toolName:'',inputText:'',status:'cancelled'});`,
    );
  await writeFile(files[1], fixture);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 812 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5174"}/${name}.html`);
    for (const stage of ["running", "complete", "recovered"]) {
      await page.evaluate(
        (stage) => window.__replyPreservation.configure({ kind: "api", stage }),
        stage,
      );
      await page.waitForFunction(
        (stage) => document.querySelector("[data-ready]")?.getAttribute("data-stage") === stage,
        stage,
      );
      const trigger = page.locator('[data-testid^="chat-assistant-history-trigger"]').first();
      await trigger.waitFor();
      if ((await trigger.getAttribute("data-state")) === "closed") await trigger.click();
      await page.locator('[data-tool-call-id="memory:0"]').waitFor();
      assert.equal(await page.locator('[data-tool-call-id="blank-placeholder"]').count(), 0);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "PASS: actual conversation timeline removes empty tool placeholder in live, completed and replayed turns while retaining named tools, 1280/375px.",
  );
} finally {
  await browser?.close();
  await Promise.all(files.map((f) => rm(f, { force: true })));
}
