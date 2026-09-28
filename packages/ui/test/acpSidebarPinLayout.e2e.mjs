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
    const title = row?.querySelector('[title], p');
    if (!pin || !title || !pin.getBoundingClientRect().width || getComputedStyle(pin).opacity === '0') return null;
    const rr = row.getBoundingClientRect(), pr = pin.getBoundingClientRect(), tr = title.getBoundingClientRect();
    return { inset: pr.x - rr.x, width: pr.width, height: pr.height, pinRight: pr.right, titleLeft: tr.left };
  })()`);
}
try {
  const id = await evaluate(
    `document.querySelector('[data-acp-session-id]')?.dataset.acpSessionId ?? null`,
  );
  const nativeKey = await evaluate(
    `document.querySelector('[data-task-item-key]')?.dataset.taskItemKey ?? null`,
  );
  assert.ok(id && nativeKey, "Visible ACP and native API rows are required");
  const acp = `[data-acp-session-id=${JSON.stringify(id)}]`;
  const native = `[data-task-item-key=${JSON.stringify(nativeKey)}]`;
  await hover(native);
  await waitFor(async () => Boolean(await geometry(native)));
  const reference = await geometry(native);
  const titleBefore = await evaluate(
    `document.querySelector(${JSON.stringify(acp)})?.querySelector('[title]')?.getBoundingClientRect().x`,
  );
  const ordinaryState = await evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(acp)});
    const slot = row.firstElementChild;
    return {
      hasGrayDot: Boolean(slot.querySelector('.rounded-full.bg-border')),
      timeline: slot.classList.contains('mt-0.5'),
      pinned: row.dataset.acpPinned === 'true',
      slotWidth: slot.getBoundingClientRect().width,
    };
  })()`);
  assert.equal(
    ordinaryState.hasGrayDot,
    ordinaryState.timeline && !ordinaryState.pinned,
    "Ordinary ACP rows must follow API: no gray dot in project lists; idle dot only in timeline",
  );
  assert.equal(ordinaryState.slotWidth, reference.width, "Empty status slot must keep API width");
  await hover(acp);
  await waitFor(async () => Boolean(await geometry(acp)));
  const actual = await geometry(acp);
  assert.ok(actual.pinRight <= actual.titleLeft, "ACP pin must be left of the title");
  for (const key of ["inset", "width", "height"])
    assert.ok(Math.abs(actual[key] - reference[key]) < 1, `ACP ${key} must match API`);
  assert.equal(actual.titleLeft, titleBefore, "Hovering the pin must not move the title");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 500, y: 80 });
  await evaluate(`document.querySelector(${JSON.stringify(acp)}).focus(); true`);
  await waitFor(async () => Boolean(await geometry(acp)));
  const focused = await geometry(acp);
  assert.equal(focused.inset, reference.inset, "Keyboard focus must keep the pin in the left slot");
  assert.equal(focused.titleLeft, titleBefore, "Keyboard focus must not move the title");
  process.stdout.write("PASS: ACP pin matches API left placement on hover and keyboard focus.\n");
} finally {
  await evaluate(`document.activeElement?.blur(); true`).catch(() => {});
  socket.close();
}
