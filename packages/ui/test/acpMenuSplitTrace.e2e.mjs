// ACP UI scenario against an existing durable row in the running dev renderer.
// node packages/ui/test/acpMenuSplitTrace.e2e.mjs
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const pages = await fetch(
  `${process.env.ZCODE_E2E_CDP_URL || "http://127.0.0.1:9229"}/json/list`,
).then((response) => response.json());
const page = pages.find((item) => item.type === "page" && item.url.includes(":5174/"));
assert.ok(page?.webSocketDebuggerUrl, "ZCode dev renderer is required");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
async function command(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP ${method} timed out`)), 10000);
    const receive = ({ data }) => {
      const result = JSON.parse(data);
      if (result.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", receive);
      if (result.error || result.result?.exceptionDetails)
        reject(new Error(JSON.stringify(result)));
      else resolve(result.result);
    };
    socket.addEventListener("message", receive);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  return (await command("Runtime.evaluate", { expression, returnByValue: true })).result.value;
}
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 70; attempt++) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error("ACP UI did not settle");
}
async function click(selector, button = "left") {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: "nearest" });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  assert.ok(point, `Missing element: ${selector}`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
    await command("Input.dispatchMouseEvent", {
      type,
      ...point,
      button,
      clickCount: type === "mouseMoved" ? 0 : 1,
    });
}
async function action(menuSelector, label) {
  const selector = await evaluate(`(() => {
    const menu = document.querySelector(${JSON.stringify(menuSelector)});
    const item = [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].find(x => x.textContent.trim() === ${JSON.stringify(label)});
    if (!item) return null;
    item.setAttribute('data-acp-e2e-action', ${JSON.stringify(label)});
    return '[data-acp-e2e-action=' + CSS.escape(${JSON.stringify(label)}) + ']';
  })()`);
  assert.ok(selector, `Missing menu action ${label}`);
  await click(selector);
}

let splitPaneId = null;
let traceTabId = null;
let clipboardIntercepted = false;
try {
  const id = await evaluate(
    `document.querySelector('[data-acp-session-id]')?.getAttribute('data-acp-session-id') ?? null`,
  );
  assert.ok(id, "A durable ACP row is required");
  const row = `[data-acp-session-id=${JSON.stringify(id)}]`;
  const menu = `[data-testid=${JSON.stringify(`acp-task-menu-${id}`)}]`;
  clipboardIntercepted = await evaluate(`(() => {
    window.__acpE2EOriginalWriteText = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async (value) => { window.__acpE2ECopied = value; };
    return true;
  })()`);
  if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(menu)}))`)) {
    for (const type of ["keyDown", "keyUp"])
      await command("Input.dispatchKeyEvent", {
        type,
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
    await waitFor(
      async () => !(await evaluate(`Boolean(document.querySelector(${JSON.stringify(menu)}))`)),
    );
  }
  const baseline = await evaluate(`document.querySelectorAll('[data-pane-id]').length`);
  await click(row, "right");
  await waitFor(
    async () =>
      await evaluate(
        `Boolean(document.querySelector(${JSON.stringify(menu)})?.querySelector('[role="menuitem"]'))`,
      ),
  );
  const labels = await evaluate(
    `(() => [...document.querySelectorAll(${JSON.stringify(menu + ' [role="menuitem"]')})].map(x => x.textContent.trim()))()`,
  );
  for (const label of ["在分屏打开", "复制任务路径", "复制日志路径", "查看调用轨迹"])
    assert.ok(labels.includes(label), `Missing ${label}`);
  assert.ok(!labels.includes("复制智能体会话文件路径"));
  await action(menu, "复制任务路径");
  await waitFor(
    async () =>
      await evaluate(`window.__acpE2ECopied?.endsWith(${JSON.stringify(`${id}.json`)}) ?? false`),
  );
  await click(row, "right");
  await waitFor(
    async () =>
      await evaluate(
        `Boolean(document.querySelector(${JSON.stringify(menu)})?.querySelector('[role="menuitem"]'))`,
      ),
  );
  await action(menu, "复制日志路径");
  await waitFor(
    async () =>
      await evaluate(
        `window.__acpE2ECopied?.endsWith(${JSON.stringify(`diagnostics/${id}.jsonl`)}) ?? false`,
      ),
  );
  await click(row, "right");
  await waitFor(
    async () =>
      await evaluate(
        `Boolean(document.querySelector(${JSON.stringify(menu)})?.querySelector('[role="menuitem"]'))`,
      ),
  );
  assert.equal(
    await evaluate(
      `(() => [...document.querySelectorAll(${JSON.stringify(menu + ' [role="menuitem"]')})].find(x => x.textContent.trim() === '在分屏打开')?.getAttribute('aria-disabled') ?? null)()`,
    ),
    null,
  );
  await action(menu, "在分屏打开");
  await waitFor(
    async () => (await evaluate(`document.querySelectorAll('[data-pane-id]').length`)) > baseline,
  );
  splitPaneId = await evaluate(
    `([...document.querySelectorAll('[data-pane-id]')].find(x => x.dataset.paneId !== 'workspace-main')?.dataset.paneId ?? null)`,
  );
  assert.ok(splitPaneId, "ACP session must have a secondary pane");
  await waitFor(
    async () =>
      await evaluate(`(() => {
    const pane = document.querySelector('[data-pane-id=${JSON.stringify(splitPaneId)}]');
    const title = document.querySelector(${JSON.stringify(row)})?.querySelector('[title]')?.title;
    return Boolean(pane && !pane.querySelector('[data-testid="acp-conversation-controls"]') && title && pane.textContent?.includes(title));
  })()`),
  );
  await click(`[data-pane-id=${JSON.stringify(splitPaneId)}] [aria-label="关闭窗格"]`);
  await waitFor(
    async () =>
      !(await evaluate(
        `Boolean(document.querySelector('[data-pane-id=${JSON.stringify(splitPaneId)}]'))`,
      )),
  );
  splitPaneId = null;

  await click(row, "right");
  await waitFor(
    async () =>
      await evaluate(
        `Boolean(document.querySelector(${JSON.stringify(menu)})?.querySelector('[role="menuitem"]'))`,
      ),
  );
  assert.equal(
    await evaluate(
      `(() => [...document.querySelectorAll(${JSON.stringify(menu + ' [role="menuitem"]')})].find(x => x.textContent.trim() === '在分屏打开')?.getAttribute('aria-disabled') ?? null)()`,
    ),
    null,
  );
  await action(menu, "查看调用轨迹");
  await waitFor(
    async () =>
      await evaluate(`Boolean(document.querySelector('[data-testid="acp-execution-trace"]'))`),
  );
  assert.equal(
    await evaluate(`document.querySelector('[data-testid="acp-execution-trace"] h2')?.textContent`),
    "ACP 执行轨迹",
  );
  await waitFor(
    async () =>
      await evaluate(`(() => {
      const trace = document.querySelector('[data-testid="acp-execution-trace"]');
      return Boolean(trace?.querySelector('ol') || trace?.textContent?.includes('此会话没有诊断事件'));
    })()`),
  );
  assert.equal(
    await evaluate(
      `Boolean(document.querySelector('[data-testid="acp-execution-trace"] [role="alert"]'))`,
    ),
    false,
    "The target Host must serve the ACP trace RPC",
  );
  traceTabId = await evaluate(
    `(() => [...document.querySelectorAll('[role="tab"]')].find(x => x.textContent?.includes('ACP 执行轨迹'))?.getAttribute('data-state') ?? null)()`,
  );
  await click('[data-testid="acp-execution-trace"] button[aria-label^="关闭"]');
  process.stdout.write(
    "PASS: ACP menu, typed split pane and execution trace in the existing side pane.\n",
  );
} finally {
  if (clipboardIntercepted)
    await evaluate(`(() => {
      navigator.clipboard.writeText = window.__acpE2EOriginalWriteText;
      delete window.__acpE2EOriginalWriteText;
      delete window.__acpE2ECopied;
      return true;
    })()`).catch(() => {});
  if (
    splitPaneId &&
    (await evaluate(
      `Boolean(document.querySelector('[data-pane-id=${JSON.stringify(splitPaneId)}]'))`,
    ))
  )
    await click(`[data-pane-id=${JSON.stringify(splitPaneId)}] [aria-label="关闭窗格"]`).catch(
      () => {},
    );
  if (
    traceTabId &&
    (await evaluate(`Boolean(document.querySelector('[data-testid="acp-execution-trace"]'))`))
  )
    await click('[data-testid="acp-execution-trace"] button[aria-label^="关闭"]').catch(() => {});
  socket.close();
}
