// Hover/focus only: compare ACP pin placement with a native API row without changing history.
// node packages/ui/test/acpSidebarPinLayout.e2e.mjs
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const pages = await fetch(
  `${process.env.ZCODE_E2E_CDP_URL || "http://127.0.0.1:9229"}/json/list`,
).then((response) => response.json());
const page = pages.find((item) => item.type === "page" && item.url.includes(":5174/"));
assert.ok(page?.webSocketDebuggerUrl, "ZCode dev renderer is required");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
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
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error("Pin layout did not settle");
}
async function hover(selector) {
  const point = await evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(selector)});
    row.scrollIntoView({ block: 'nearest' });
    const rect = row.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
}
async function geometry(selector) {
  return evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(selector)});
    const pin = row?.querySelector('button[aria-label="置顶任务"], button[aria-label="取消置顶任务"]');
    const archive = row?.querySelector('button[aria-label="归档任务"]');
    const title = row?.querySelector('[title], p');
    if (!pin || !archive || !title || !pin.getBoundingClientRect().width || getComputedStyle(pin).opacity === '0') return null;
    const pr = pin.getBoundingClientRect(), ar = archive.getBoundingClientRect(), tr = title.getBoundingClientRect();
    const group = pin.closest('[data-task-row-actions="true"]');
    return {
      width: pr.width, height: pr.height, archiveWidth: ar.width, archiveHeight: ar.height,
      gap: ar.left - pr.right, sameTop: pr.top === ar.top,
      sameGroup: Boolean(group && group.contains(archive)),
      leadingButtons: row.firstElementChild.querySelectorAll('button').length,
      titleLeft: tr.left,
      agentVisible: row.querySelector('[data-acp-agent-icon]')?.getBoundingClientRect().width > 0,
    };
  })()`);
}
function assertActions(layout) {
  for (const key of ["width", "height", "archiveWidth", "archiveHeight"])
    assert.equal(layout[key], 24, `${key} uses the shared action size`);
  assert.equal(layout.gap, 2, "Pin is immediately before archive");
  assert.equal(layout.sameTop, true, "Both actions have the same vertical alignment");
  assert.equal(layout.sameGroup, true, "Both actions use the same trailing group");
  assert.equal(layout.leadingButtons, 0, "The left identity slot has no pin button");
}
try {
  // Electron 后台窗口不会接收悬停事件；验证前激活窗口，避免将失焦误判为布局回归。
  await command("Page.bringToFront", {});
  const id = await evaluate(
    `document.querySelector('[data-acp-session-id]')?.dataset.acpSessionId ?? null`,
  );
  const nativeKey = await evaluate(
    `document.querySelector('[data-task-item-key]')?.dataset.taskItemKey ?? null`,
  );
  assert.ok(id && nativeKey, "Visible ACP and native API rows are required");
  const acp = `[data-acp-session-id=${JSON.stringify(id)}]`;
  const native = `[data-task-item-key=${JSON.stringify(nativeKey)}]`;
  async function nativeIconVisible() {
    return evaluate(`(() => {
      const icon=document.querySelector(${JSON.stringify(native)})?.querySelector('[data-task-agent-icon="api"]');
      if(!icon)return false;
      const r=icon.getBoundingClientRect();
      return r.width===16&&r.height===16&&getComputedStyle(icon).visibility==='visible';
    })()`);
  }
  assert.equal(await nativeIconVisible(), true, "The native API row shows its provider icon");
  await hover(native);
  await waitFor(async () => Boolean(await geometry(native)));
  const reference = await geometry(native);
  assertActions(reference);
  assert.equal(await nativeIconVisible(), true, "Hover retains the provider icon");
  const titleBefore = await evaluate(
    `document.querySelector(${JSON.stringify(acp)})?.querySelector('[title]')?.getBoundingClientRect().x`,
  );
  const ordinaryState = await evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(acp)});
    const slot = row.firstElementChild;
    return {
      hasGrayDot: Boolean(slot.querySelector('.rounded-full.bg-border')),
      hasAgentIcon: Boolean(slot.querySelector('[data-acp-agent-icon]')),
      timeline: slot.classList.contains('mt-0.5'),
      pinned: row.dataset.acpPinned === 'true',
      slotWidth: slot.getBoundingClientRect().width,
    };
  })()`);
  assert.equal(
    ordinaryState.hasGrayDot,
    false,
    "ACP rows use their Agent brand instead of the old idle dot",
  );
  assert.equal(ordinaryState.hasAgentIcon, true, "The ACP row keeps its own Agent identity");
  assert.equal(ordinaryState.slotWidth, 16, "Agent slot keeps its existing width");
  await hover(acp);
  await waitFor(async () => Boolean(await geometry(acp)));
  const actual = await geometry(acp);
  assertActions(actual);
  assert.equal(actual.agentVisible, true, "Hover retains the Agent identity");
  for (const key of ["gap", "width", "height"])
    assert.ok(Math.abs(actual[key] - reference[key]) < 1, `ACP ${key} must match API`);
  assert.equal(actual.titleLeft, titleBefore, "Hovering the pin must not move the title");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 500, y: 80 });
  await evaluate(`document.querySelector(${JSON.stringify(acp)}).focus(); true`);
  await waitFor(async () => Boolean(await geometry(acp)));
  const focused = await geometry(acp);
  assertActions(focused);
  assert.equal(focused.agentVisible, true, "Keyboard focus retains the Agent identity");
  assert.equal(focused.titleLeft, titleBefore, "Keyboard focus must not move the title");
  await evaluate(`document.activeElement?.blur(); true`);
  const worktree = await evaluate(`(() => {
    const row = document.querySelector('[data-worktree-path]')?.closest('li');
    return row?.dataset.acpSessionId
      ? '[data-acp-session-id=' + JSON.stringify(row.dataset.acpSessionId) + ']'
      : row?.dataset.taskItemKey
        ? '[data-task-item-key=' + JSON.stringify(row.dataset.taskItemKey) + ']'
        : null;
  })()`);
  if (worktree) {
    const markerCount = () =>
      evaluate(
        `document.querySelector(${JSON.stringify(worktree)})?.querySelectorAll('[data-worktree-path]').length`,
      );
    assert.equal(await markerCount(), 1, "An idle worktree has its marker");
    await hover(worktree);
    await waitFor(async () => Boolean(await geometry(worktree)));
    assert.equal(await markerCount(), 0, "Hover replaces the marker with actions");
    assertActions(await geometry(worktree));
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 500, y: 80 });
    await waitFor(async () => (await markerCount()) === 1);
    await evaluate(`document.querySelector(${JSON.stringify(worktree)}).focus(); true`);
    await waitFor(async () => (await markerCount()) === 0);
    assertActions(await geometry(worktree));
    await evaluate(`document.activeElement?.blur(); true`);
    await waitFor(async () => (await markerCount()) === 1);
  }
  process.stdout.write(
    "PASS: API/ACP pin and archive share the right action group on hover and keyboard focus.\n",
  );
} finally {
  await evaluate(`document.activeElement?.blur(); true`).catch(() => {});
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 500, y: 80 }).catch(() => {});
  socket.close();
}
