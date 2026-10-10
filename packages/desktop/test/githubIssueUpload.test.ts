import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { githubIssueUploadScript } from "../src/main/githubIssueUploadScript.js";
import { createForgeWebMediaMainBridge } from "../src/host/forgeWebMediaMainBridge.js";
import {
  hostResponseMessageSchema,
  type ForgeWebUploadContext,
  type HostForgeWebMediaRequest,
} from "@zcode/shared";

const context: ForgeWebUploadContext = {
  accountId: "3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01",
  username: "tester",
  serverUrl: "https://github.com",
  repository: "synthetic/project",
  repositoryUrl: "https://github.com/synthetic/project",
  image: {
    filename: "screenshot.png",
    mediaType: "image/png",
    dataBase64: "iVBORw0KGgo=",
    totalBytes: 8,
  },
};
const url = "https://github.com/user-attachments/assets/4c88bcca-98b9-4aaa-9c0c-2f869f0c1b01";

test("native upload has strict protocol validation and correlates only its own receipt", async () => {
  const messages: HostForgeWebMediaRequest[] = [];
  const bridge = createForgeWebMediaMainBridge((message) => messages.push(message));
  try {
    const result = bridge.port.upload!(context);
    assert.equal(hostResponseMessageSchema.safeParse(messages[0]).success, true);
    assert.equal(
      hostResponseMessageSchema.safeParse({
        ...messages[0],
        context: { ...context, cookie: "synthetic-cookie" },
      }).success,
      false,
    );
    bridge.handleResult({
      type: "forge-web-media-result",
      requestId: context.accountId,
      ok: true,
      upload: { url },
    });
    bridge.handleResult({
      type: "forge-web-media-result",
      requestId: messages[0]!.requestId,
      ok: true,
      upload: { url },
    });
    assert.deepEqual(await result, { url });
    const cancelled = assert.rejects(
      bridge.port.upload!(context),
      /FORGE_MEDIA_AUTHENTICATION_UNAVAILABLE/,
    );
    bridge.dispose();
    await cancelled;
  } finally {
    bridge.dispose();
  }
});

test("synthetic GitHub page reports only a newly completed attachment and blocks website creation", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><meta name="user-login" content="tester"><form><textarea aria-label="Markdown value"></textarea><input type="file"><button type="submit">Create</button><button type="button" id="create-react">Create via React</button></form>`,
      }),
    );
    await page.goto(`${context.repositoryUrl}/issues/new`);
    await page.evaluate((url) => {
      const textarea = document.querySelector("textarea")!;
      // Existing template links must not be mistaken for this upload's completion.
      textarea.value = `![old](${url.replace("4c88", "5c88")})`;
      document.querySelector('input[type="file"]')!.addEventListener("change", (event) => {
        const file = (event.target as HTMLInputElement).files![0]!;
        (window as any).__received = { name: file.name, type: file.type, size: file.size };
        document.querySelector("#create-react")!.addEventListener("click", () => {
          (window as any).__created = true;
        });
        const click = new MouseEvent("click", { bubbles: true, cancelable: true });
        (window as any).__clickBlocked = !document
          .querySelector("#create-react")!
          .dispatchEvent(click);
        const submit = new Event("submit", { bubbles: true, cancelable: true });
        (window as any).__submitBlocked = !document.querySelector("form")!.dispatchEvent(submit);
        setTimeout(() => {
          textarea.value += `\n![new](${url})`;
        }, 10);
      });
    }, url);
    const result = await page.evaluate(githubIssueUploadScript(context, 1000));
    assert.deepEqual(result, { url });
    assert.deepEqual(
      await page.evaluate(() => [
        (window as any).__received,
        (window as any).__clickBlocked,
        (window as any).__submitBlocked,
        Boolean((window as any).__created),
      ]),
      [{ name: "screenshot.png", type: "image/png", size: 8 }, true, true, false],
    );
    await page.evaluate(() => {
      document.querySelector('meta[name="user-login"]')!.setAttribute("content", "other-user");
    });
    await assert.rejects(
      page.evaluate(githubIssueUploadScript(context, 100)),
      /FORGE_MEDIA_IDENTITY_CHANGED/,
    );
    await page.evaluate(() => {
      document.querySelector('meta[name="user-login"]')!.setAttribute("content", "tester");
      document.querySelector('input[type="file"]')!.remove();
    });
    await assert.rejects(
      page.evaluate(githubIssueUploadScript(context, 100)),
      /FORGE_UPLOAD_UNAVAILABLE/,
    );
  } finally {
    await browser.close();
  }
});
