// Run against an existing durable ACP conversation in the ZCode dev renderer:
// ZCODE_E2E_ACP_SESSION_ID=<saved-id> node packages/ui/test/acpSidebarRowActions.e2e.mjs
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

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
let nextId = 0;
function command(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP command timed out")), 10000);
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
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error("ACP sidebar change did not settle");
}
async function point(selector) {
  const result = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: "nearest" });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  assert.ok(result, `Missing ${selector}`);
  return result;
}
async function mouse(selector, button = "left") {
  const location = await point(selector);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await command("Input.dispatchMouseEvent", {
      type,
      ...location,
      button,
      clickCount: type === "mouseMoved" ? 0 : 1,
    });
  }
}
async function menuAction(row, label) {
  await waitFor(async () =>
    evaluate(
      "!document.querySelector('[role=dialog]') && document.body.style.pointerEvents !== 'none'",
    ),
  );
  await mouse(row, "right");
  const menu = `[data-testid=${JSON.stringify(`acp-task-menu-${sessionId}`)}]`;
  await waitFor(async () => evaluate(`Boolean(document.querySelector(${JSON.stringify(menu)}))`));
  const option = await evaluate(`(() => {
    const menu = document.querySelector(${JSON.stringify(menu)});
    return [...menu.querySelectorAll('[role="menuitem"]')].find(x => x.textContent.trim() === ${JSON.stringify(label)})?.outerHTML ?? null;
  })()`);
  assert.ok(option, `Missing menu action ${label}`);
  const location = await evaluate(`(() => {
    const item = [...document.querySelector(${JSON.stringify(menu)}).querySelectorAll('[role="menuitem"]')]
      .find(x => x.textContent.trim() === ${JSON.stringify(label)});
    const rect = item.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
    await command("Input.dispatchMouseEvent", { type, ...location, button: "left", clickCount: 1 });
}

const sessionId = process.env.ZCODE_E2E_ACP_SESSION_ID;
assert.ok(sessionId, "Supply a saved ACP session id");
const row = `[data-acp-session-id=${JSON.stringify(sessionId)}]`;
const pinLabel = "置顶任务";
const renameLabel = "重命名任务";
const input = '[role="dialog"] input';
async function renameTo(title) {
  await menuAction(row, renameLabel);
  await point(input);
  await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(input)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(title)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await mouse('[role="dialog"] button:last-of-type');
  await waitFor(async () =>
    evaluate(
      `document.querySelector(${JSON.stringify(row)})?.querySelector('[title]')?.title === ${JSON.stringify(title)}`,
    ),
  );
}
let before;
try {
  before = await evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(row)});
    return row && { title: row.querySelector('[title]')?.getAttribute('title'), pinned: row.dataset.acpPinned === 'true', active: row.getAttribute('aria-current') };
  })()`);
  assert.ok(before?.title, "Saved ACP row is required");
  assert.equal(before.pinned, false, "Run this scenario against an unpinned ACP session");
  const temporaryTitle = `${before.title} E2E check`;
  await mouse(row, "right");
  const menuLabels = await evaluate(
    `[...document.querySelectorAll('[data-testid^="acp-task-menu-"] [role="menuitem"]')].map(x => x.textContent.trim())`,
  );
  assert.deepEqual(menuLabels, [
    pinLabel,
    renameLabel,
    "归档任务",
    "标记为未读",
    "在分屏打开",
    "在 Finder 中打开",
    "复制路径",
    "复制任务路径",
    "复制日志路径",
    "复制会话 ID",
    "查看调用轨迹",
    "反馈问题",
  ]);
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await menuAction(row, pinLabel);
  await waitFor(async () =>
    evaluate(`document.querySelector(${JSON.stringify(row)})?.dataset.acpPinned === 'true'`),
  );
  assert.ok(
    await evaluate(
      `document.querySelector(${JSON.stringify(row)})?.parentElement?.parentElement?.textContent.includes('已置顶')`,
    ),
    "Pinned ACP row must move to the existing pinned section",
  );
  await mouse(`[data-testid=${JSON.stringify(`acp-task-pin-${sessionId}`)}]`);
  await waitFor(async () =>
    evaluate(`document.querySelector(${JSON.stringify(row)})?.dataset.acpPinned !== 'true'`),
  );
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(row)})?.getAttribute('aria-current')`),
    before.active,
    "Pin button must not open the conversation",
  );
  await renameTo(temporaryTitle);
  await renameTo(before.title);
  await menuAction(row, "标记为未读");
  await waitFor(async () =>
    evaluate(
      `Boolean(document.querySelector(${JSON.stringify(row)})?.querySelector('[data-unread-indicator]'))`,
    ),
  );
  await mouse(row);
  await waitFor(async () =>
    evaluate(
      `!document.querySelector(${JSON.stringify(row)})?.querySelector('[data-unread-indicator]')`,
    ),
  );
  await menuAction(row, "归档对话");
  await waitFor(async () => evaluate(`!document.querySelector(${JSON.stringify(row)})`));
  await mouse('button[aria-label="归档"]');
  const archivedRow = `[data-testid=${JSON.stringify(`archived-acp-task-${sessionId}`)}]`;
  await waitFor(async () =>
    evaluate(`Boolean(document.querySelector(${JSON.stringify(archivedRow)}))`),
  );
  await mouse(`${archivedRow} button[aria-label="恢复对话"]`);
  await waitFor(async () => evaluate(`!document.querySelector(${JSON.stringify(archivedRow)})`));
  await mouse('button[data-state="on"][aria-label="关闭"]');
  await waitFor(async () => evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`));
  process.stdout.write("PASS: ACP menu, pin, rename, unread, archive and restore.\n");
} finally {
  if (before) {
    // The scenario uses an opted-in saved conversation. Restore its metadata even when an
    // intermediate assertion fails, so the test does not leave user history changed.
    await (async () => {
      const archivedRow = `[data-testid=${JSON.stringify(`archived-acp-task-${sessionId}`)}]`;
      if (!(await evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`))) {
        if (!(await evaluate(`Boolean(document.querySelector(${JSON.stringify(archivedRow)}))`)))
          await mouse('button[aria-label="归档"]');
        if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(archivedRow)}))`))
          await mouse(`${archivedRow} button[aria-label="恢复对话"]`);
        await waitFor(async () =>
          evaluate(`!document.querySelector(${JSON.stringify(archivedRow)})`),
        );
        if (
          await evaluate(
            `Boolean(document.querySelector('button[data-state="on"][aria-label="关闭"]'))`,
          )
        )
          await mouse('button[data-state="on"][aria-label="关闭"]');
      }
      const state = await evaluate(`(() => {
        const item = document.querySelector(${JSON.stringify(row)});
        return item && {
          title: item.querySelector('[title]')?.title,
          pinned: item.dataset.acpPinned === 'true',
          unread: !!item.querySelector('[data-unread-indicator]'),
        };
      })()`);
      if (!state) return;
      if (state.pinned !== before.pinned)
        await mouse(`[data-testid=${JSON.stringify(`acp-task-pin-${sessionId}`)}]`);
      if (state.title !== before.title) await renameTo(before.title);
      if (state.unread) await mouse(row);
    })().catch((error) => {
      process.stderr.write(`ACP E2E cleanup failed: ${error}\n`);
    });
  }
  socket.close();
}
