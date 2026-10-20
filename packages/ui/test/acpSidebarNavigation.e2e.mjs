// Reuse a previously admitted ACP session; never sends a model prompt.
// ZCODE_E2E_ACP_SESSION_ID=<saved-id> ZCODE_E2E_ACP_AGENT=codex node packages/ui/test/acpSidebarNavigation.e2e.mjs
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const sessionId = process.env.ZCODE_E2E_ACP_SESSION_ID;
const agent = process.env.ZCODE_E2E_ACP_AGENT;
assert.ok(sessionId && agent, "Supply a saved ACP session id and its Agent");
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
let id = 0;
async function command(method, params) {
  const commandId = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP command timed out")), 10000);
    const onMessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== commandId) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      if (message.error || message.result?.exceptionDetails)
        reject(new Error(JSON.stringify(message)));
      else resolve(message.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id: commandId, method, params }));
  });
}
async function evaluate(expression) {
  return (await command("Runtime.evaluate", { expression, returnByValue: true })).result.value;
}
async function click(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  assert.ok(point, `Missing ${selector}`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await command("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
  }
}
async function selectAgent() {
  const item = `[data-testid=${JSON.stringify(`chat-model-select-item-acp:${agent}`)}]`;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(item)}))`)) break;
    if (
      await evaluate(
        "document.querySelector('[data-testid=\"chat-model-select-trigger\"]')?.getAttribute('aria-expanded') !== 'true'",
      )
    ) {
      await click('[data-testid="chat-model-select-trigger"]');
    }
    await delay(100);
  }
  assert.ok(await evaluate(`Boolean(document.querySelector(${JSON.stringify(item)}))`));
  await click(item);
}
const row = `[data-acp-session-id=${JSON.stringify(sessionId)}]`;
const model = `[data-testid="chat-model-select-trigger"]`;
const state = `({
  selected: document.querySelector(${JSON.stringify(row)})?.getAttribute('aria-current'),
  model: document.querySelector(${JSON.stringify(model)})?.getAttribute('data-model-current-value'),
  transcript: document.querySelector('[data-testid="v4-timeline"]')?.textContent,
  turns: document.querySelectorAll('[data-v4-turn-unit]').length,
  composerCount: document.querySelectorAll('[data-testid="v4-composer"]').length,
  draft: document.querySelector('[data-testid="v4-composer-input"]')?.textContent?.trim(),
  nativeSession: document.querySelector('[data-session-id]')?.getAttribute('data-session-id'),
})`;
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const value = await evaluate(state);
    if (predicate(value)) return value;
    await delay(100);
  }
  throw new Error("ACP sidebar state did not settle");
}
try {
  const initial = await evaluate(state);
  assert.equal(initial.draft, "", "Only inspect an empty user draft");
  assert.ok(initial.model && !initial.model.startsWith("acp:"), "Start on an API draft");
  assert.ok(await evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`));
  const title = await evaluate(
    `document.querySelector(${JSON.stringify(row)})?.querySelector('[title]')?.getAttribute('title')`,
  );
  assert.ok(title);
  await evaluate(`document.querySelector(${JSON.stringify(row)}).click()`);
  const opened = await waitFor(
    (value) =>
      value.selected === "page" &&
      value.model === `acp:${agent}` &&
      value.transcript?.includes(title),
  );
  assert.equal(opened.composerCount, 1);
  await evaluate(`document.querySelector('[data-testid="conversation-new-task"]').click()`);
  const draft = await waitFor((value) => value.model === initial.model && !value.selected);
  assert.equal(draft.draft, "");
  await selectAgent();
  await waitFor((value) => value.model === `acp:${agent}`);
  await delay(1000);
  const fresh = await evaluate(state);
  assert.equal(fresh.selected, null, "Model switching cannot select a saved sidebar row");
  assert.equal(fresh.turns, 0, "A new task must not display the saved transcript");
  assert.equal(fresh.draft, "");
  await evaluate(`document.querySelector('[data-testid="conversation-new-task"]').click()`);
  await waitFor((value) => value.model === initial.model && !value.selected);
  await selectAgent();
  await waitFor((value) => value.model === `acp:${agent}`);
  // While the fresh Agent may still be connecting, the explicit sidebar id wins over its late result.
  await evaluate(`document.querySelector(${JSON.stringify(row)}).click()`);
  await waitFor((value) => value.selected === "page" && value.transcript?.includes(title));
  await evaluate(`document.querySelector('[data-testid="conversation-new-task"]').click()`);
  await waitFor((value) => value.model === initial.model && !value.selected);
  await selectAgent();
  await waitFor((value) => value.model === `acp:${agent}`);
  await delay(1000);
  assert.equal((await evaluate(state)).turns, 0, "Repeated New Task must stay empty");
  await evaluate(`document.querySelector(${JSON.stringify(row)}).click()`);
  const reopened = await waitFor(
    (value) => value.selected === "page" && value.model === `acp:${agent}`,
  );
  assert.equal(reopened.composerCount, 1);
  if (process.env.ZCODE_E2E_NATIVE_TASK_ID) {
    const nativeId = process.env.ZCODE_E2E_NATIVE_TASK_ID;
    const nativeRow = `[data-testid=${JSON.stringify(`task-item-${nativeId}`)}]`;
    assert.ok(await evaluate(`Boolean(document.querySelector(${JSON.stringify(nativeRow)}))`));
    await evaluate(`document.querySelector(${JSON.stringify(nativeRow)}).click()`);
    await waitFor((value) => value.nativeSession === nativeId && !value.selected);
    await evaluate(`document.querySelector(${JSON.stringify(row)}).click()`);
    await waitFor((value) => value.selected === "page" && value.model === `acp:${agent}`);
    await evaluate(`document.querySelector(${JSON.stringify(nativeRow)}).click()`);
    await waitFor((value) => value.nativeSession === nativeId && !value.selected);
  }
  process.stdout.write(
    "PASS: saved ACP row → New Task → Agent selection stays empty → repeated New Task stays empty → saved row restores, one composer.\n",
  );
} finally {
  await evaluate(`document.querySelector('[data-testid="conversation-new-task"]')?.click()`);
  socket.close();
}
