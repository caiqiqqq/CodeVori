// Run against ZCode Dev with CDP: node packages/ui/test/acpConversationPresentation.e2e.mjs
// This scenario uses only an installed, enabled ACP Agent; it never sends a paid prompt.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const endpoint = process.env.ZCODE_E2E_CDP_URL || "http://127.0.0.1:9229";
process.stdout.write("E2E: discover renderer\n");
const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && item.url.includes(":5174/"));
assert.ok(target?.webSocketDebuggerUrl, "ZCode Dev renderer must be running on port 5174");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const uiSource = `/@fs${repoRoot}/packages/ui/src`;
const rendererSource = await fetch(new URL("/src/main.tsx", target.url)).then((response) =>
  response.text(),
);
process.stdout.write("E2E: renderer modules ready\n");
const reactUrl = rendererSource.match(/from "([^"]+\/react\.js\?[^"]+)"/)?.[1];
const reactDomUrl = rendererSource.match(/from "([^"]+\/react-dom_client\.js\?[^"]+)"/)?.[1];
assert.ok(reactUrl && reactDomUrl, "Dev renderer must expose its React modules");
const timelineSource = await fetch(
  new URL(`${uiSource}/v4/ConversationTimeline.tsx`, target.url),
).then((response) => response.text());
const intlUrl = timelineSource.match(/from "([^"]+\/i18n\/IntlProvider\.tsx(?:\?t=\d+)?)"/)?.[1];
assert.ok(intlUrl, "Fixture provider must use the same Vite module as the timeline");
// Register open immediately after construction: fetching Vite modules before subscribing can
// complete after the socket opened, leaving an already-open connection waiting forever.
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    socket.close();
    reject(new Error("CDP WebSocket connection timed out"));
  }, 5000);
  socket.addEventListener(
    "open",
    () => {
      clearTimeout(timeout);
      resolve();
    },
    { once: true },
  );
  socket.addEventListener(
    "error",
    (error) => {
      clearTimeout(timeout);
      reject(error);
    },
    { once: true },
  );
});
process.stdout.write("E2E: CDP connected\n");
let nextId = 0;
async function command(method, params) {
  const id = ++nextId;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP response timed out")), 10000);
    const onMessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(message);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
  assert.ok(!result.exceptionDetails && !result.error, "Browser evaluation must succeed");
  return result.result;
}
async function evaluateResult(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}
async function evaluate(expression) {
  return evaluateResult(expression);
}
async function point(selector) {
  const rectangle = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    const bounds = element.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    return { x, y, visible: element.contains(document.elementFromPoint(x, y)) };
  })()`);
  assert.ok(rectangle?.visible, `Missing or obscured ${selector}`);
  return rectangle;
}
async function click(selector) {
  const { x, y } = await point(selector);
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}
async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function openModelMenuWithItem(itemSelector) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(itemSelector)}))`)) return;
    if (
      await evaluate(
        `document.querySelector('[data-testid="chat-model-select-trigger"]')?.getAttribute('data-state') !== 'open'`,
      )
    ) {
      await click('[data-testid="chat-model-select-trigger"]');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await waitFor(`Boolean(document.querySelector(${JSON.stringify(itemSelector)}))`, "model item");
}

let originalModel;
try {
  const initial = await evaluate(`(() => {
    const input = document.querySelector('[data-testid="v4-composer-input"]');
    const timeline = document.querySelector('[data-testid="v4-timeline"]');
    globalThis.__acpConversationTestInput = input;
    return { input: Boolean(input), timeline: Boolean(timeline), composerCount: document.querySelectorAll('[data-testid="v4-composer"]').length,
      model: document.querySelector('[data-testid="chat-model-select-trigger"]')?.getAttribute('data-model-current-value') };
  })()`);
  assert.equal(initial.input, true);
  assert.equal(initial.timeline, true);
  assert.equal(initial.composerCount, 1);
  originalModel = initial.model;
  await openModelMenuWithItem('[data-testid="chat-model-select-item-acp:codex"]');
  await click('[data-testid="chat-model-select-item-acp:codex"]');
  process.stdout.write("E2E: selected ACP\n");
  await waitFor(
    `document.querySelector('[data-testid="chat-model-select-trigger"]')?.getAttribute('data-model-current-value') === 'acp:codex'`,
    "Codex selection",
  );
  const active = await evaluate(`(() => ({
    controls: document.querySelectorAll('[data-testid="acp-conversation-controls"]').length,
    duplicate: document.querySelectorAll('[data-testid="acp-inline-transcript"]').length,
    composer: document.querySelectorAll('[data-testid="v4-composer"]').length,
    timeline: document.querySelectorAll('[data-testid="v4-timeline"]').length,
    sameInput: document.querySelector('[data-testid="v4-composer-input"]') === globalThis.__acpConversationTestInput,
  }))()`);
  assert.equal(active.controls, 0, "ACP composer no longer has a session history button");
  assert.equal(active.duplicate, 0);
  assert.equal(active.composer, 1);
  assert.equal(active.timeline, 1);
  assert.equal(active.sameInput, true);
  // Isolated component fixture: real production timeline and row components, synthetic ACP
  // snapshots, no Host writes, no real model request and no modification to the user's draft.
  process.stdout.write("E2E: mount fixture\n");
  const fixture = await evaluateResult(`(async () => {
    const React = (await import(${JSON.stringify(reactUrl)})).default;
    const { createRoot } = (await import(${JSON.stringify(reactDomUrl)})).default;
    const { ConversationTimeline } = await import(${JSON.stringify(`${uiSource}/v4/ConversationTimeline.tsx`)});
    const { buildAcpConversationRows } = await import(${JSON.stringify(`${uiSource}/v4/acpConversationRows.ts`)});
    const { ZCodeIntlProvider } = await import(${JSON.stringify(intlUrl)});
    const { TooltipProvider } = await import(${JSON.stringify(`${uiSource}/components/ui/tooltip.tsx`)});
    const { DEFAULT_CODE_PREVIEW_SETTINGS } = await import(${JSON.stringify(`${uiSource}/lib/codePreviewSettings.ts`)});
    const host = document.createElement('div');
    host.id = 'acp-conversation-e2e-fixture';
    Object.assign(host.style, { position: 'fixed', top: '24px', left: '24px', width: '640px', height: '280px', zIndex: '10000', background: 'var(--color-background)' });
    document.body.append(host);
    const errors = [];
    const root = createRoot(host, { onUncaughtError: error => errors.push(String(error)) });
    globalThis.__acpConversationFixture = { root, host };
    const snapshot = { status: 'running', footerHeight: 0, entries: [
      { id: 'user:test', kind: 'user', text: 'ACP fixture question' },
      { id: 'assistant:test:before', kind: 'assistant', text: 'checking' },
      { id: 'tool:test:read', kind: 'tool', title: 'Read', status: 'completed', content: 'ACP fixture tool result' },
      { id: 'assistant:test:after', kind: 'assistant', text: '**ACP fixture streaming**' }
    ] };
    const render = () => {
      const rows = buildAcpConversationRows(snapshot);
      root.render(React.createElement(ZCodeIntlProvider, { initialLocale: 'zh-CN' },
        React.createElement(TooltipProvider, null,
          React.createElement('div', { style: { height: '100%', display: 'flex' } },
            React.createElement(ConversationTimeline, { rows, totalCount: rows.length, sessionKey: 'acp-fixture', hideTurnNavigator: true,
              footerSlot: snapshot.footerHeight ? React.createElement('div', { style: { height: snapshot.footerHeight } }, 'ACP permission fixture') : null,
              workDurationAvailable: false, rowContext: { workspacePath: '/tmp/acp-fixture', theme: 'zai-light', codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS, logEpoch: 'fixture' } })))));
    };
    const paint = () => new Promise(resolve => setTimeout(resolve, 100));
    render(); await paint();
    const first = host.querySelector('[data-row-id="8"]');
    snapshot.entries[3].text = '**ACP fixture final**';
    render(); await paint();
    const stableStreamRow = first === host.querySelector('[data-row-id="8"]');
    snapshot.status = 'idle'; render(); await paint();
    host.querySelector('[data-testid^="chat-assistant-history-trigger"]')?.click();
    await paint();
    const toolTitle = Boolean(host.querySelector('[data-tool-name="Read"]'));
    snapshot.footerHeight = 350; render(); await paint(); await paint();
    const timeline = host.querySelector('[data-testid="v4-timeline"]');
    const followedPermission = Math.abs(timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop) < 3;
    timeline.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
    timeline.scrollTop = 0;
    timeline.dispatchEvent(new Event('scroll', { bubbles: true }));
    await paint();
    snapshot.footerHeight = 550; render(); await paint(); await paint();
    const preservedReaderScroll = timeline.scrollTop < 3;
    return { errors, stableStreamRow, user: host.textContent.includes('ACP fixture question'),
      markdown: Boolean(host.querySelector('[data-row-id="8"] strong')),
      finalText: host.textContent.includes('ACP fixture final'), toolTitle,
      followedPermission, preservedReaderScroll,
      turns: host.querySelectorAll('[data-v4-turn-unit]').length, duplicate: host.querySelectorAll('[data-testid="acp-inline-transcript"]').length };
  })()`);
  assert.deepEqual(fixture, {
    errors: [],
    stableStreamRow: true,
    user: true,
    markdown: true,
    finalText: true,
    toolTitle: true,
    followedPermission: true,
    preservedReaderScroll: true,
    turns: 1,
    duplicate: 0,
  });
  process.stdout.write(
    "PASS: shared composer, stable ACP stream rows, native user/markdown/tool presentation, permission tail scroll.\n",
  );
} finally {
  await evaluate(
    "globalThis.__acpConversationFixture?.root.unmount(); globalThis.__acpConversationFixture?.host.remove(); delete globalThis.__acpConversationFixture",
  );
  if (originalModel && originalModel !== "acp:codex") {
    const itemSelector = `[data-testid=${JSON.stringify(`chat-model-select-item-${originalModel}`)}]`;
    await openModelMenuWithItem(
      originalModel.startsWith("custom:")
        ? `[data-testid=${JSON.stringify(`chat-model-select-group-registry-provider:${originalModel.split(":")[1]}`)}]`
        : itemSelector,
    );
    if (originalModel.startsWith("custom:")) {
      const provider = originalModel.split(":")[1];
      const groupSelector = `[data-testid=${JSON.stringify(`chat-model-select-group-registry-provider:${provider}`)}]`;
      const { x, y } = await point(groupSelector);
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await waitFor(
        `Boolean(document.querySelector(${JSON.stringify(itemSelector)}))`,
        "original provider submenu",
      );
    }
    await waitFor(
      `Boolean(document.querySelector(${JSON.stringify(itemSelector)}))`,
      "original model item",
    );
    // Radix submenu may consume the first pointer press while focus transfers from its parent.
    for (let attempt = 0; attempt < 3; attempt++) {
      await click(itemSelector);
      if (
        await evaluate(
          `document.querySelector('[data-testid="chat-model-select-trigger"]')?.getAttribute('data-model-current-value') === ${JSON.stringify(originalModel)}`,
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await waitFor(
      `document.querySelector('[data-testid="chat-model-select-trigger"]')?.getAttribute('data-model-current-value') === ${JSON.stringify(originalModel)}`,
      "original model restoration",
    );
  }
  await evaluate("delete globalThis.__acpConversationTestInput");
  socket.close();
}
