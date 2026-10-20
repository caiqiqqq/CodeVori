// Run against a ZCode Dev renderer whose official marketplace contains the marked fixture.
// ZCODE_E2E_PAID_PLAN_PLUGIN_ID=wind@zcode-plugins-official node packages/ui/test/pluginStorePlanBadge.e2e.mjs
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const pluginId = process.env.ZCODE_E2E_PAID_PLAN_PLUGIN_ID || "wind@zcode-plugins-official";
const target = (
  await fetch(`${process.env.ZCODE_E2E_CDP_URL || "http://127.0.0.1:9229"}/json/list`).then(
    (response) => response.json(),
  )
).find((item) => item.type === "page" && item.url.includes(":5174/"));
assert.ok(target?.webSocketDebuggerUrl, "ZCode Dev renderer is required");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let requestId = 0;
async function evaluate(expression) {
  const id = ++requestId;
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP command timed out")), 10000);
    const onMessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(message)));
      } else {
        resolve(message.result?.result?.value);
      }
    };
    socket.addEventListener("message", onMessage);
    socket.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      }),
    );
  });
}
async function waitFor(expression) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`ZCode UI did not reach: ${expression}`);
}

const card = `[data-testid="plugin-store-card"][data-plugin-id=${JSON.stringify(pluginId)}]`;
const detail = `[data-testid="plugin-store-detail"][data-plugin-id=${JSON.stringify(pluginId)}]`;
const badge = '[data-testid="plugin-store-paid-plan-badge"]';
try {
  if (!(await evaluate('Boolean(document.querySelector("[data-testid=plugin-store-list]"))'))) {
    await evaluate('document.querySelector("[data-testid=plugin-store-sidebar-open]")?.click()');
  }
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(card)}))`);
  assert.equal(
    await evaluate(`document.querySelectorAll(${JSON.stringify(badge)}).length`),
    0,
    "Plugin Store still renders plan badges in another card",
  );
  const cardState = await evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(card)});
    return { badge: Boolean(row?.querySelector(${JSON.stringify(badge)})), install: Boolean(row?.querySelector('[data-testid="plugin-store-install"]')) };
  })()`);
  assert.equal(cardState.badge, false, "List card still advertises Coding Plan");
  assert.equal(cardState.install, true, "A marked uninstalled plugin must remain installable");

  await evaluate(`document.querySelector(${JSON.stringify(card)}).click()`);
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(detail)}))`);
  const detailState = await evaluate(`(() => {
    const page = document.querySelector(${JSON.stringify(detail)});
    return { badge: Boolean(page?.querySelector(${JSON.stringify(badge)})), install: Boolean(page?.querySelector('[data-testid="plugin-store-install"]')) };
  })()`);
  assert.equal(detailState.badge, false, "Plugin detail still advertises Coding Plan");
  assert.equal(detailState.install, true, "Plugin detail must retain Install");
  await evaluate('document.querySelector("[data-testid=settings-breadcrumb-section]")?.click()');
  await waitFor('Boolean(document.querySelector("[data-testid=plugin-store-list]"))');
  process.stdout.write(
    "PASS: marked plugin shows no plan badge in list or detail; Install remains available.\n",
  );
} finally {
  socket.close();
}
