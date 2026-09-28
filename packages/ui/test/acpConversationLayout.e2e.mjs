// Run on an open native conversation with a saved Codex ACP conversation:
// node packages/ui/test/acpConversationLayout.e2e.mjs
// The scenario changes only the visible target; it never sends a prompt.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const endpoint = process.env.ZCODE_E2E_CDP_URL || "http://127.0.0.1:9229";
const agent = process.env.ZCODE_E2E_ACP_AGENT || "codex";
const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && item.url.includes(":5174/"));
assert.ok(target?.webSocketDebuggerUrl, "ZCode Dev renderer must be running on port 5174");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("CDP connection timed out")), 5000);
  socket.addEventListener(
    "open",
    () => {
      clearTimeout(timer);
      resolve();
    },
    { once: true },
  );
  socket.addEventListener(
    "error",
    () => {
      clearTimeout(timer);
      reject(new Error("CDP connection failed"));
    },
    { once: true },
  );
});
let nextId = 0;
async function command(method, params) {
  const id = ++nextId;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP evaluation timed out")), 10000);
    const onMessage = ({ data }) => {
      const response = JSON.parse(data);
      if (response.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(response);
    };
    socket.addEventListener("message", onMessage);
    socket.send(
      JSON.stringify({
        id,
        method,
        params,
      }),
    );
  });
  assert.ok(!result.error, "CDP command must succeed");
  return result.result;
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true });
  assert.ok(!result.exceptionDetails, "Browser evaluation must succeed");
  return result.result.value;
}
async function screenshot(name) {
  const directory = process.env.ZCODE_E2E_SCREENSHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const { data } = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(join(directory, `${name}.png`), Buffer.from(data, "base64"));
}
async function waitFor(expression, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
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
async function openModelItem(value) {
  const item = `[data-testid=${JSON.stringify(`chat-model-select-item-${value}`)}]`;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(item)}))`)) return item;
    // Tooltip also writes data-state on this button; aria-expanded belongs to the menu.
    if (
      await evaluate(
        "document.querySelector('[data-testid=\"chat-model-select-trigger\"]')?.getAttribute('aria-expanded') !== 'true'",
      )
    ) {
      await click('[data-testid="chat-model-select-trigger"]');
    }
    if (value.startsWith("custom:")) {
      const group = `[data-testid=${JSON.stringify(`chat-model-select-group-registry-provider:${value.split(":")[1]}`)}]`;
      const point = await evaluate(
        `(() => { const r = document.querySelector(${JSON.stringify(group)})?.getBoundingClientRect(); return r && { x: r.x+r.width/2, y: r.y+r.height/2 }; })()`,
      );
      if (point) await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    }
    await delay(100);
  }
  throw new Error(`Model item did not open: ${value}`);
}
const geometry = `(() => {
  const pane = document.querySelector('[data-testid="v4-session-pane-workspace-main"]') ?? document.querySelector('[data-session-id]');
  const rect = (selector) => {
    const box = pane?.querySelector(selector)?.getBoundingClientRect();
    return box && { x: box.x, y: box.y, width: box.width, bottom: box.bottom };
  };
  return { dock: rect('[data-v4-composer-dock-content]'), input: rect('.chat-composer-input-surface'),
    firstMessage: rect('[data-v4-timeline-virtual-history]'),
    extraHeader: Boolean(pane?.querySelector('[data-v4-timeline-header-slot]')),
    contextHeader: Boolean(pane?.querySelector('[data-v4-composer-context-header]')),
    menu: Boolean(pane?.querySelector('[data-testid="acp-conversation-controls"]')),
    nativeTaskActions: Boolean(document.querySelector('[data-testid="workspace-more-button"]')),
    horizontalOverflow: Boolean(pane && pane.scrollWidth > pane.clientWidth + 1),
    variant: document.querySelector('[data-workspace-header-variant]')?.getAttribute('data-workspace-header-variant'),
    title: document.querySelector('[data-testid="workspace-title"]')?.textContent?.trim() };
})()`;
let originalModel;
let draftGeometry;
try {
  if (process.env.ZCODE_E2E_VIEWPORT_WIDTH) {
    await command("Emulation.setDeviceMetricsOverride", {
      width: Number(process.env.ZCODE_E2E_VIEWPORT_WIDTH),
      height: 880,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitFor(
      `window.innerWidth === ${Number(process.env.ZCODE_E2E_VIEWPORT_WIDTH)}`,
      "narrow viewport",
    );
    await delay(220);
  }
  const initial = await evaluate(`(() => ({
    session: document.querySelector('[data-session-id]')?.getAttribute('data-session-id'),
    model: document.querySelector('[data-testid="chat-model-select-trigger"]')?.getAttribute('data-model-current-value')
  }))()`);
  assert.ok(initial.session && initial.session !== "draft", "Open a native conversation first");
  assert.ok(initial.model && !initial.model.startsWith("acp:"), "Select an API model first");
  originalModel = initial.model;
  const native = await evaluate(geometry);
  assert.ok(native.dock && native.input && native.firstMessage, "Native layout must be visible");
  await screenshot("native");
  if (process.env.ZCODE_E2E_FROM_DRAFT === "1") {
    // The original defect occurs when ACP is hosted in a native null-task draft.
    await click('[data-testid="conversation-new-task"]');
    await waitFor(
      "document.querySelector('[data-session-id]')?.getAttribute('data-session-id') === 'draft'",
      "new draft",
    );
    draftGeometry = await evaluate(geometry);
  }
  await evaluate(
    "globalThis.__layoutFixtureInput = document.querySelector('[data-testid=\"v4-composer-input\"]'); true",
  );
  if (process.env.ZCODE_E2E_EMPTY_ACP_AGENT) {
    const home = await evaluate(geometry);
    const value = `acp:${process.env.ZCODE_E2E_EMPTY_ACP_AGENT}`;
    await click(await openModelItem(value));
    await waitFor(
      `document.querySelector('[data-testid="chat-model-select-trigger"]')?.getAttribute('data-model-current-value') === ${JSON.stringify(value)}`,
      "empty ACP target",
    );
    const empty = await evaluate(geometry);
    for (const dimension of ["x", "y", "width", "bottom"]) {
      assert.ok(
        Math.abs(empty.input[dimension] - home.input[dimension]) <= 2,
        `Empty ACP input.${dimension} preserves home geometry`,
      );
    }
    assert.equal(empty.contextHeader, true);
    assert.equal(empty.extraHeader, false);
  }
  await click('[data-testid="chat-model-select-trigger"]');
  await waitFor(
    `Boolean(document.querySelector('[data-testid="chat-model-select-item-acp:${agent}"]'))`,
    "Agent option",
  );
  await click(`[data-testid="chat-model-select-item-acp:${agent}"]`);
  await waitFor(
    `document.querySelector('[data-testid="chat-model-select-trigger"]')?.getAttribute('data-model-current-value') === 'acp:${agent}'`,
    "Agent selection",
  );
  if (process.env.ZCODE_E2E_ACP_SESSION_ID) {
    await click('[data-testid="acp-conversation-controls"]');
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('[role=\"menuitem\"]')].some(item => item.textContent?.includes('新建会话'))",
      ),
      true,
      "History menu retains new session",
    );
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('[role=\"menuitem\"]')].some(item => item.textContent?.includes('从 ZCode 移除会话'))",
      ),
      true,
      "History menu retains remove session",
    );
    const item = `[data-testid="acp-session-item-${process.env.ZCODE_E2E_ACP_SESSION_ID}"]`;
    await waitFor(
      `Boolean(document.querySelector(${JSON.stringify(item)}))`,
      "saved session menu item",
    );
    await waitFor(
      `document.querySelector(${JSON.stringify(item)})?.getAttribute('aria-disabled') !== 'true'`,
      "session operation ready",
    );
    await click(item);
    await waitFor(
      "document.querySelector('[data-testid=\"acp-conversation-controls\"]')?.getAttribute('aria-expanded') === 'false'",
      "history menu closed",
    );
  }
  await waitFor(`Boolean(document.querySelector('[data-v4-turn-unit]'))`, "saved ACP conversation");
  assert.equal(
    await evaluate(
      "document.querySelector('[data-testid=\"v4-composer-input\"]') === globalThis.__layoutFixtureInput",
    ),
    true,
    "Keep the original input DOM after ACP content appears",
  );
  // The native width transition is 150ms; compare settled geometry, not the first paint.
  await delay(220);
  const acp = await evaluate(geometry);
  for (const part of ["dock", "input"]) {
    assert.ok(acp[part], `${part} must remain visible`);
    for (const dimension of ["x", "width", "bottom"]) {
      assert.ok(
        Math.abs(acp[part][dimension] - native[part][dimension]) <= 2,
        `${part}.${dimension}: native ${native[part][dimension]}, ACP ${acp[part][dimension]}`,
      );
    }
  }
  assert.ok(Math.abs(acp.firstMessage.x - native.firstMessage.x) <= 2);
  assert.equal(acp.extraHeader, false);
  assert.equal(acp.contextHeader, false);
  assert.equal(acp.menu, true);
  assert.equal(acp.nativeTaskActions, false);
  assert.equal(acp.horizontalOverflow, false);
  assert.equal(acp.variant, "acp");
  assert.ok(acp.title, "ACP Host session title must appear in the existing header");
  await screenshot("acp");
  process.stdout.write(
    `PASS: native/ACP dock width=${acp.input.width}, bottom=${acp.input.bottom}; shared header and input DOM, no draft context or separate controls row.\n`,
  );
} finally {
  try {
    if (originalModel) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await click(await openModelItem(originalModel));
        await delay(100);
        if (
          await evaluate(
            `document.querySelector('[data-testid="chat-model-select-trigger"]')?.getAttribute('data-model-current-value') === ${JSON.stringify(originalModel)}`,
          )
        )
          break;
      }
      await waitFor(
        `document.querySelector('[data-testid="chat-model-select-trigger"]')?.getAttribute('data-model-current-value') === ${JSON.stringify(originalModel)}`,
        "original model restoration",
      );
      if (draftGeometry) {
        const restored = await evaluate(geometry);
        assert.equal(restored.contextHeader, true);
        assert.equal(restored.variant, "draft");
        assert.ok(
          Math.abs(restored.input.width - draftGeometry.input.width) <= 2,
          "API restores home input width",
        );
      }
    }
  } finally {
    await evaluate("delete globalThis.__layoutFixtureInput");
    if (process.env.ZCODE_E2E_VIEWPORT_WIDTH)
      await command("Emulation.clearDeviceMetricsOverride", {});
    socket.close();
  }
}
