import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { build } from "esbuild";
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

test("visible GitHub SSR editor waits for real React hydration before the single paste", async () => {
  const fixture = await build({
    stdin: {
      resolveDir: import.meta.dirname,
      contents: `
        import {createElement as h, useEffect, useRef, useState} from 'react';
        import {hydrateRoot} from 'react-dom/client';
        const root = document.querySelector('react-app');
        function Editor() {
          const [value, setValue] = useState('');
          const mounted = useRef(false);
          useEffect(() => {
            mounted.current = true;
            const frame = requestAnimationFrame(() => requestIdleCallback(() => root.classList.add('loaded')));
            return () => { mounted.current = false; cancelAnimationFrame(frame); };
          }, []);
          return h('form', null, h('fieldset', null,
            h('legend', null, 'Add a description'),
            h('textarea', { 'aria-label': 'Markdown value', value, onChange: event => setValue(event.target.value),
              onPaste: event => {
                if (!mounted.current || !event.clipboardData.files.length) return;
                event.preventDefault(); window.__pastes++;
                const file = event.clipboardData.files[0];
                window.__received = [file.name, file.type, file.size];
                setValue('![image](' + window.__url + ')');
              }
            }), h('button', {type: 'submit'}, 'Create')));
        }
        window.__hydrate = () => hydrateRoot(root, h(Editor));
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<!doctype html><meta name="user-login" content="tester"><react-app app-name="issue-create" data-ssr="true"><form><fieldset><legend>Add a description</legend><textarea aria-label="Markdown value"></textarea><button type="submit">Create</button></fieldset></form></react-app>',
      }),
    );
    await page.goto(`${context.repositoryUrl}/issues/new`);
    await page.evaluate((url) => {
      (window as any).__url = url;
      (window as any).__pastes = 0;
      (window as any).__dispatches = 0;
      (window as any).__ssrEditor = document.querySelector("textarea");
      document.addEventListener("paste", () => (window as any).__dispatches++, true);
    }, url);
    await page.addScriptTag({ content: fixture.outputFiles[0]!.text });
    await page.evaluate(
      `window.__upload = ${githubIssueUploadScript(context, 2000)}; window.__upload.catch(() => {}); void 0;`,
    );
    assert.equal(
      await page.evaluate(() => (window as any).__dispatches),
      0,
      "visible SSR markup must receive no image bytes",
    );
    await page.evaluate(() => (window as any).__hydrate());
    assert.deepEqual(await page.evaluate(() => (window as any).__upload), { url });
    assert.deepEqual(
      await page.evaluate(() => [
        (window as any).__pastes,
        (window as any).__dispatches,
        (window as any).__received,
        document.querySelector("textarea") === (window as any).__ssrEditor,
      ]),
      [1, 1, ["screenshot.png", "image/png", 8], true],
    );
    await page.evaluate(() => document.querySelector("react-app")!.classList.add("another-render"));
    assert.equal(await page.evaluate(() => (window as any).__dispatches), 1);
  } finally {
    await browser.close();
  }
});

test("React root readiness rechecks identity and expires without a late paste", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const state of ["never-ready", "identity-changed", "loaded-without-handler"] as const) {
      const page = await browser.newPage();
      await page.route("**/*", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><meta name="user-login" content="tester"><react-app><textarea aria-label="Markdown value"></textarea></react-app>',
        }),
      );
      await page.goto(`${context.repositoryUrl}/issues/new`);
      await page.evaluate(() => {
        (window as any).__dispatches = 0;
        document.addEventListener("paste", () => (window as any).__dispatches++, true);
      });
      await page.evaluate(
        `window.__upload = ${githubIssueUploadScript(context, 200)}; window.__upload.catch(() => {}); void 0;`,
      );
      assert.equal(await page.evaluate(() => (window as any).__dispatches), 0);
      if (state !== "never-ready")
        await page.evaluate((state) => {
          if (state === "identity-changed")
            document
              .querySelector('meta[name="user-login"]')!
              .setAttribute("content", "other-user");
          document.querySelector("react-app")!.classList.add("loaded");
        }, state);
      await assert.rejects(
        page.evaluate(() => (window as any).__upload),
        state === "identity-changed" ? /FORGE_MEDIA_IDENTITY_CHANGED/ : /FORGE_UPLOAD_UNAVAILABLE/,
      );
      await page.evaluate(() => document.querySelector("react-app")!.classList.add("loaded"));
      assert.equal(
        await page.evaluate(() => (window as any).__dispatches),
        state === "loaded-without-handler" ? 1 : 0,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("current GitHub editor uploads through paste without a mounted file picker", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const inputs of [0, 1, 2]) {
      const page = await browser.newPage();
      await page.route("**/*", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><meta name="user-login" content="tester"><form><label id="description">Add a description</label><textarea aria-labelledby="description"></textarea>${'<input type="file">'.repeat(inputs)}<button type="submit">Create</button><button type="button" id="create-react">Create via React</button></form>`,
        }),
      );
      await page.goto(`${context.repositoryUrl}/issues/new`);
      await page.evaluate((url) => {
        const textarea = document.querySelector("textarea")!;
        textarea.value = `![old](${url.replace("4c88", "5c88")})`;
        (window as any).__pastes = 0;
        (window as any).__inputChanges = 0;
        for (const input of document.querySelectorAll("input"))
          input.addEventListener("change", () => (window as any).__inputChanges++);
        textarea.addEventListener("paste", (event) => {
          event.preventDefault();
          (window as any).__pastes++;
          const file = event.clipboardData!.files[0]!;
          (window as any).__received = { name: file.name, type: file.type, size: file.size };
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
      assert.deepEqual(await page.evaluate(githubIssueUploadScript(context, 500)), { url });
      assert.deepEqual(
        await page.evaluate(() => [
          (window as any).__pastes,
          (window as any).__inputChanges,
          (window as any).__received,
          (window as any).__clickBlocked,
          (window as any).__submitBlocked,
        ]),
        [1, 0, { name: "screenshot.png", type: "image/png", size: 8 }, true, true],
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("paste admission waits for identity/editor readiness and never retries rejected or expired uploads", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const state of [
      "missing",
      "wrong",
      "ambiguous",
      "disabled",
      "unhandled",
      "delayed",
      "timeout",
    ] as const) {
      const page = await browser.newPage();
      const username = state === "wrong" ? "other-user" : "tester";
      await page.route("**/*", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html>${state === "missing" || state === "delayed" ? "" : `<meta name="user-login" content="${username}">`}<label id="description">${state === "delayed" ? "Loading" : "Add a description"}</label><textarea aria-labelledby="description" ${state === "disabled" || state === "delayed" ? "disabled" : ""}></textarea>${state === "ambiguous" ? '<textarea aria-labelledby="description"></textarea>' : ""}`,
        }),
      );
      await page.goto(`${context.repositoryUrl}/issues/new`);
      await page.evaluate(
        ({ state, url }) => {
          (window as any).__pastes = 0;
          if (state !== "unhandled")
            document.querySelector("textarea")!.addEventListener("paste", (event) => {
              event.preventDefault();
              (window as any).__pastes++;
              if (state !== "timeout") document.querySelector("textarea")!.value = `![new](${url})`;
            });
        },
        { state, url },
      );
      await page.evaluate(
        `window.__upload = ${githubIssueUploadScript(context, 200)}; window.__upload.catch(() => {}); void 0;`,
      );
      if (state === "delayed")
        await page.evaluate(() => {
          const meta = document.createElement("meta");
          meta.name = "user-login";
          meta.content = "tester";
          document.head.append(meta);
          document.querySelector("label")!.firstChild!.textContent = "Add a description";
          document.querySelector("textarea")!.disabled = false;
        });
      const result = page.evaluate(() => (window as any).__upload);
      if (state === "delayed") assert.deepEqual(await result, { url });
      else
        await assert.rejects(
          result,
          state === "missing"
            ? /FORGE_MEDIA_AUTHENTICATION/
            : state === "wrong"
              ? /FORGE_MEDIA_IDENTITY_CHANGED/
              : state === "timeout"
                ? /FORGE_UPLOAD_UNCERTAIN/
                : /FORGE_UPLOAD_UNAVAILABLE/,
        );
      const expectedPastes = state === "delayed" || state === "timeout" ? 1 : 0;
      assert.equal(await page.evaluate(() => (window as any).__pastes), expectedPastes);
      await page.evaluate(() => {
        const meta =
          document.querySelector('meta[name="user-login"]') ?? document.createElement("meta");
        meta.setAttribute("name", "user-login");
        meta.setAttribute("content", "tester");
        document.head.append(meta);
        for (const editor of document.querySelectorAll("textarea")) editor.disabled = false;
        document.querySelector("textarea")!.value = "restored";
      });
      assert.equal(await page.evaluate(() => (window as any).__pastes), expectedPastes);
      assert.equal(
        await page.evaluate(() => Object.hasOwn(document.querySelector("textarea")!, "value")),
        false,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("GitHub identity readiness distinguishes missing, signed out and wrong users before attaching bytes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const state of ["missing", "empty", "wrong", "insert", "hydrate", "lost"] as const) {
      const page = await browser.newPage();
      const marker =
        state === "missing" || state === "insert"
          ? ""
          : `<meta name="user-login" ${state === "hydrate" ? "" : `content="${state === "wrong" ? "other-user" : state === "lost" ? "tester" : ""}"`}>`;
      await page.route("**/*", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html>${marker}<textarea aria-label="Markdown value" ${state === "lost" ? "disabled" : ""}></textarea>${state === "lost" ? "" : '<input type="file">'}`,
        }),
      );
      await page.goto(`${context.repositoryUrl}/issues/new`);
      await page.evaluate(
        ({ url }) => {
          (window as any).__files = 0;
          document.querySelector("input")?.addEventListener("change", () => {
            (window as any).__files++;
            document.querySelector("textarea")!.value = `![new](${url})`;
          });
        },
        { url },
      );
      await page.evaluate(
        `window.__upload = ${githubIssueUploadScript(context, 2000)}; window.__upload.catch(() => {}); void 0;`,
      );
      await page.evaluate((state) => {
        if (state === "lost") document.querySelector('meta[name="user-login"]')!.remove();
        if (state === "insert" || state === "hydrate") {
          const meta =
            document.querySelector<HTMLMetaElement>('meta[name="user-login"]') ??
            document.createElement("meta");
          meta.name = "user-login";
          meta.content = "TeStEr";
          if (!meta.isConnected) document.head.append(meta);
        }
      }, state);
      const result = page.evaluate(() => (window as any).__upload);
      if (state === "insert" || state === "hydrate") assert.deepEqual(await result, { url });
      else
        await assert.rejects(
          result,
          state === "wrong" ? /FORGE_MEDIA_IDENTITY_CHANGED/ : /FORGE_MEDIA_AUTHENTICATION\b/,
        );
      assert.equal(
        await page.evaluate(() => (window as any).__files),
        state === "insert" || state === "hydrate" ? 1 : 0,
      );
      // A timed-out script must not dispatch a late upload when identity subsequently appears.
      await page.evaluate(() => {
        const meta = document.createElement("meta");
        meta.name = "user-login";
        meta.content = "tester";
        document.head.append(meta);
      });
      assert.equal(
        await page.evaluate(() => (window as any).__files),
        state === "insert" || state === "hydrate" ? 1 : 0,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

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
    const result = await page.evaluate(githubIssueUploadScript(context, 5000));
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
