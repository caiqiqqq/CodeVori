// Real settings editor + native-file service, using disposable fake credentials only.
// Start desktop Vite, then: node --import tsx packages/ui/test/acpCodexNativeConfig.e2e.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { parse } from "smol-toml";
import {
  readCodexNativeConfig,
  updateCodexNativeConfig,
} from "../../services/src/acp/acpCodexConfig.ts";

const origin = process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5174";
const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__codex-native-e2e-${process.pid}`;
const html = join(renderer, `${name}.html`);
const moduleFile = join(renderer, `${name}.tsx`);
const home = await mkdtemp(join(tmpdir(), "codex-native-e2e-"));
const configPath = join(home, "config.toml");
const initialConfig = `# CC Switch fixture
model_provider = "custom"
model = "fixture-old-model"
[model_providers.custom]
base_url = "https://fixture.example/v1"
requires_openai_auth = false
experimental_bearer_token = "fixture-bearer-key"
`;
const updates = [];
let holdNextResponse = false;
let releaseResponse;
let onApplied;
let browser;
const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Content-Type", "application/json");
  if (request.method === "OPTIONS") return response.end();
  try {
    if (request.method === "GET" && request.url === "/config")
      return response.end(JSON.stringify(await readCodexNativeConfig(home)));
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/config");
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    const update = JSON.parse(body);
    updates.push(update);
    const result = await updateCodexNativeConfig(home, update);
    if (holdNextResponse) {
      holdNextResponse = false;
      await new Promise((resolve) => {
        releaseResponse = resolve;
        onApplied?.();
      });
    }
    response.end(JSON.stringify(result));
  } catch {
    response.statusCode = 409;
    response.end("{}");
  }
});
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiOrigin = `http://127.0.0.1:${server.address().port}`;
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {AcpCodexConfigEditor} from '../../../ui/src/settings/AcpCodexConfigEditor.tsx';
      import {ZCodeIntlProvider} from '../../../ui/src/i18n/IntlProvider.tsx';
      import '../../../ui/src/styles.css';
      async function request(update) {
        const response = await fetch(${JSON.stringify(apiOrigin + "/config")}, update ? {
          method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(update)
        } : undefined);
        if(!response.ok) throw new Error('Fixture config conflict');
        return response.json();
      }
      const service = {
        readCodexConfig:()=>request(), updateCodexConfig:request,
        listCodexModels:()=>Promise.resolve([])
      };
      createRoot(document.getElementById('root')).render(
        <ZCodeIntlProvider initialLocale="zh-CN">
          <main style={{maxWidth:640,padding:16}}><AcpCodexConfigEditor service={service}/></main>
        </ZCodeIntlProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390]) {
    await writeFile(configPath, initialConfig);
    await rm(join(home, "auth.json"), { force: true });
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const allowed = [origin, apiOrigin].includes(new URL(route.request().url()).origin);
      return allowed ? route.continue() : route.abort();
    });
    await page.goto(`${origin}/${name}.html`);
    const section = page.getByTestId("acp-codex-native-config");
    const key = section.locator("#acp-codex-api-key");
    const model = section.locator("#acp-codex-default-model");
    const save = section.getByRole("button", { name: "保存 Codex 配置", exact: true });
    const reload = section.getByRole("button", { name: "重新读取", exact: true });
    await key.waitFor();
    assert.equal(await key.getAttribute("type"), "password");
    assert.equal(await key.inputValue(), "fixture-bearer-key");
    assert.equal(await section.locator("#acp-codex-auth-mode").textContent(), "自定义接口");

    // Changing the model must omit the unedited Key and preserve its native source.
    await model.fill("fixture-new-model");
    const saved = page.waitForResponse(
      (response) =>
        response.url() === `${apiOrigin}/config` && response.request().method() === "POST",
    );
    await save.click();
    assert.equal((await saved).status(), 200);
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "保存 Codex 配置" && button.disabled,
      ),
    );
    assert.equal(Object.hasOwn(updates.at(-1), "apiKey"), false);
    assert.equal(
      await readFile(configPath, "utf8"),
      initialConfig.replace("fixture-old-model", "fixture-new-model"),
    );
    await assert.rejects(readFile(join(home, "auth.json")), { code: "ENOENT" });

    // External switching is read afresh, and an old draft cannot overwrite it.
    const switched = initialConfig.replace("fixture-bearer-key", "fixture-switched-key");
    await writeFile(configPath, switched);
    await model.fill("stale-model");
    await save.click();
    await section.getByRole("alert").waitFor();
    assert.equal(await readFile(configPath, "utf8"), switched);
    await reload.click();
    await page.waitForFunction(
      () => document.querySelector("#acp-codex-api-key")?.value === "fixture-switched-key",
    );

    // A late save response must not erase edits made while the request was pending.
    holdNextResponse = true;
    const applied = new Promise((resolve) => {
      onApplied = resolve;
    });
    await model.fill("fixture-first-save");
    await save.click();
    await applied;
    await model.fill("fixture-newer-draft");
    releaseResponse();
    releaseResponse = undefined;
    await save.waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "保存 Codex 配置" && !button.disabled,
      ),
    );
    assert.equal(await model.inputValue(), "fixture-newer-draft");

    // Explicitly clearing the Key updates the provider, without creating auth.json.
    await key.fill("");
    const cleared = page.waitForResponse(
      (response) =>
        response.url() === `${apiOrigin}/config` && response.request().method() === "POST",
    );
    await save.click();
    assert.equal((await cleared).status(), 200);
    assert.equal(updates.at(-1).apiKey, "");
    const config = parse(await readFile(configPath, "utf8"));
    assert.equal(config.model_provider, "custom");
    assert.equal(config.model, "fixture-newer-draft");
    assert.equal(config.model_providers.custom.experimental_bearer_token, "");
    assert.equal(config.model_providers.custom.requires_openai_auth, false);
    await assert.rejects(readFile(join(home, "auth.json")), { code: "ENOENT" });
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    "PASS: desktop/mobile Codex native config read, save, external conflict, reload, late response and explicit Key clearing.\n",
  );
} finally {
  releaseResponse?.();
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await Promise.all([
    rm(html, { force: true }),
    rm(moduleFile, { force: true }),
    rm(home, { recursive: true, force: true }),
  ]);
}
