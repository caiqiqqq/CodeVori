// Run against an open Agent SDK settings page: node packages/ui/test/acpAgentSwitch.e2e.mjs
// Only navigation and element identities are inspected; no input values are read or saved.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const endpoint = process.env.ZCODE_E2E_CDP_URL || "http://127.0.0.1:9229";
const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && item.url.includes(":5174/"));
assert.ok(target?.webSocketDebuggerUrl, "ZCode Dev renderer must be running on port 5174");
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;
socket.addEventListener("message", ({ data }) => {
  const response = JSON.parse(data);
  const task = pending.get(response.id);
  if (!task) return;
  pending.delete(response.id);
  clearTimeout(task.timer);
  if (response.error) task.reject(new Error("CDP command failed"));
  else task.resolve(response.result);
});
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

async function evaluate(expression) {
  const id = ++nextId;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("CDP evaluation timed out"));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    );
  });
  assert.ok(!result.exceptionDetails, "Browser evaluation must succeed");
  return result.result.value;
}

const agents = [
  "claude",
  "codex",
  "gemini",
  "openclaw",
  "opencode",
  "cline",
  "hermes",
  "codebuddy",
  "kimi-code",
  "pi",
  "grok",
  "cursor",
  "deepseek",
  "qoder",
  "antigravity",
];
try {
  assert.equal(
    await evaluate('Boolean(document.querySelector("[data-testid=settings-acp-agents]"))'),
    true,
    "Open Agent SDK settings before running this scenario",
  );
  const sequence = [
    ...Array.from({ length: 3 }, () => ["codex", "gemini", "codex", "claude", "codex"]).flat(),
    ...agents,
    "codex",
  ];
  for (const agent of sequence) {
    await evaluate(`document.querySelector('[data-testid="settings-acp-agent-${agent}"]').click()`);
    let state;
    for (let attempt = 0; attempt < 100; attempt++) {
      state = await evaluate(`(() => {
        const detail = document.querySelector('[data-testid="settings-acp-agent-detail-${agent}"]');
        return {
          selected: document.querySelector('[data-testid="settings-acp-agent-${agent}"]')?.getAttribute('aria-pressed') === 'true',
          detail: Boolean(detail),
          native: document.querySelectorAll('[data-testid="acp-codex-native-config"]').length,
          env: document.querySelectorAll('[data-testid="acp-agent-environment"]').length,
          ownEnv: Boolean(detail?.querySelector('#acp-env-raw-${agent}')),
          versionChannel: Boolean(detail?.querySelector('[data-testid="acp-adapter-channel"]'))
        };
      })()`);
      if (state.selected && state.detail && state.ownEnv) break;
      await delay(25);
    }
    assert.deepEqual(
      state,
      {
        selected: true,
        detail: true,
        native: agent === "codex" ? 1 : 0,
        env: 1,
        ownEnv: true,
        versionChannel: false,
      },
      `Unexpected settings content after selecting ${agent}`,
    );
  }
  process.stdout.write(
    `PASS: ${sequence.length} selections; each agent shows only its own settings.\n`,
  );
} finally {
  socket.close();
}
