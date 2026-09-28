// Read-only ACP history search in a running ZCode Dev desktop app; no prompt is sent.
// ZCODE_E2E_ACP_SESSION_ID=<saved-id> node packages/ui/test/acpSearch.e2e.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const id = process.env.ZCODE_E2E_ACP_SESSION_ID;
assert.ok(id && /^[0-9a-f-]{36}$/i.test(id), "Provide a saved ACP session id");
const snapshot = JSON.parse(
  await readFile(
    join(process.env.ZCODE_DATA_BASE_DIR || homedir(), ".zcode", "acp-sessions", `${id}.json`),
    "utf8",
  ),
);
assert.ok(snapshot.entries.some((entry) => entry.kind === "user"));
const assistant = snapshot.entries.find(
  (entry) => entry.kind === "assistant" && entry.text.length > 12,
);
assert.ok(assistant, "Saved session needs an assistant reply");
const candidate = assistant.text
  .match(/[\p{L}\p{N}]{5,12}/gu)
  ?.find(
    (part) =>
      !snapshot.title.toLocaleLowerCase().includes(part.toLocaleLowerCase()) &&
      snapshot.entries
        .filter((entry) => entry.id !== assistant.id)
        .every((entry) => !entry.text?.toLocaleLowerCase().includes(part.toLocaleLowerCase())),
  );
assert.ok(candidate, "Saved session needs a reply-only search phrase");

const browser = await chromium.connectOverCDP(
  process.env.ZCODE_E2E_CDP_URL || "http://127.0.0.1:9229",
);
const page = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((item) => item.url().includes(":5174/"));
assert.ok(page, "ZCode Dev renderer is required");
const sessionRow = page.locator(`[data-acp-session-id="${id}"]`);
const result = page.locator(`[data-acp-search-session-id="${id}"]`);
const input = page.getByPlaceholder("搜索操作、任务或文件");
try {
  assert.equal(
    (await page.locator('[data-testid="v4-composer-input"]').first().textContent())?.trim(),
    "",
    "Do not disturb an unsent draft",
  );
  assert.ok(await sessionRow.count(), "Saved session must be visible in current workspace");
  assert.ok(
    !(
      await page
        .locator('[data-testid="chat-model-select-trigger"]')
        .first()
        .getAttribute("data-model-current-value")
    )?.startsWith("acp:"),
    "Start from an API draft",
  );
  const searchButton = page
    .locator("button")
    .filter({ hasText: "搜索" })
    .filter({ hasText: "⌘ K" })
    .first();
  if (!(await input.isVisible())) await searchButton.click();
  await input.fill("");
  await page.getByRole("tab", { name: "任务" }).click();
  // Empty query includes ACP in the same recent-task section as native tasks.
  await result.first().waitFor({ state: "visible", timeout: 10000 });
  await input.fill(`#${snapshot.title}`);
  await result.first().waitFor({ state: "visible", timeout: 10000 });
  await input.fill(`#${candidate}`);
  const selectedResult = page.locator(
    `[data-acp-search-session-id="${id}"][data-search-entry-id="${assistant.id}"]`,
  );
  await selectedResult.waitFor({ state: "visible", timeout: 10000 });
  await selectedResult.click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(`[data-acp-session-id="${id}"]`)?.getAttribute("aria-current") ===
      "page",
    id,
    { timeout: 10000 },
  );
  await page.waitForFunction(
    () => (CSS.highlights.get("zcode-v4-conversation-search-result")?.size || 0) > 0,
    undefined,
    { timeout: 10000 },
  );
  assert.equal(await page.locator('[data-testid="v4-composer"]').count(), 1);
  assert.equal(
    await page
      .locator('[data-testid="chat-model-select-trigger"]')
      .first()
      .getAttribute("data-model-current-value"),
    `acp:${snapshot.agent}`,
  );
  console.log(
    "ACP recent, title and reply-only search, exact session navigation and timeline highlight: OK",
  );
} finally {
  if (await input.isVisible().catch(() => false)) {
    await input.fill("");
    await page.keyboard.press("Escape");
  }
  if (await page.locator('[data-testid="conversation-new-task"]').count())
    await page.locator('[data-testid="conversation-new-task"]').first().click();
  await browser.close();
}
