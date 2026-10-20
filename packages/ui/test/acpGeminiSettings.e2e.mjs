// Run against an open Agent SDK page. Clicks draft controls only; never reads secrets or saves.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const endpoint = process.env.ZCODE_E2E_CDP_URL || "http://127.0.0.1:9229";
const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === "page" && item.url.includes(":5174/"));
assert.ok(target?.webSocketDebuggerUrl);
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  const task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  clearTimeout(task.timer);
  if (message.error) task.reject(new Error("CDP command failed"));
  else task.resolve(message.result);
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
  socket.addEventListener("error", reject, { once: true });
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
const modes = [
  ["自定义接口", ["GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL"]],
  ["Google 登录（OAuth）", []],
  ["Gemini API Key", ["GEMINI_API_KEY"]],
  ["Vertex AI（ADC）", ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"]],
  [
    "Vertex AI（服务账号）",
    ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GOOGLE_APPLICATION_CREDENTIALS"],
  ],
  ["Vertex AI API Key", ["GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"]],
  ["模型供应商", ["GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL"]],
];
let edited = false;
try {
  assert.equal(
    await evaluate('Boolean(document.querySelector("[data-testid=settings-acp-agents]"))'),
    true,
  );
  await evaluate('document.querySelector("[data-testid=settings-acp-agent-gemini]").click()');
  assert.equal(
    await evaluate(`(() => {
      const detail=document.querySelector('[data-testid=settings-acp-agent-detail-gemini]');
      const save=[...(detail?.querySelectorAll('button')||[])].find(el=>el.textContent?.trim()==='保存 Gemini 配置');
      return Boolean(save && !save.disabled);
    })()`),
    false,
    "Gemini has unsaved edits; preserve them and run this scenario in a fresh page",
  );
  assert.deepEqual(
    await evaluate(`(() => {
      const detail=document.querySelector('[data-testid=settings-acp-agent-detail-gemini]');
      const tools=[...(detail?.querySelectorAll('button[role=switch]')||[])].find(el=>el.getAttribute('aria-label')==='由 Agent 自行处理文件与命令');
      return { raw:Boolean(detail?.querySelector('#acp-env-raw-gemini')), channel:Boolean(detail?.querySelector('[data-testid=acp-adapter-channel]')), tools:Boolean(tools && tools.disabled && tools.getAttribute('aria-checked')==='true'), docs:detail?.textContent?.includes('查看认证文档') };
    })()`),
    { raw: false, channel: false, tools: false, docs: true },
  );
  for (const [label, expected] of modes) {
    edited = true;
    await evaluate('document.querySelector("#acp-env-gemini-ZCODE_GEMINI_AUTH_MODE").click()');
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate('document.querySelectorAll("[role=option]").length > 0')) break;
      await delay(20);
    }
    assert.deepEqual(
      await evaluate(
        "[...document.querySelectorAll('[role=option]')].map(el=>el.textContent?.trim())",
      ),
      modes.map(([label]) => label),
      "认证菜单与 Codeg 的七项及顺序完全一致，无原生配置项",
    );
    await evaluate(
      `([...document.querySelectorAll('[role=option]')].find(el => el.textContent?.trim() === ${JSON.stringify(label)}) || (() => { throw new Error('Missing auth mode') })()).click()`,
    );
    const state = await evaluate(
      `(() => {const d=document.querySelector('[data-testid=settings-acp-agent-detail-gemini]'); return {mode:d?.querySelector('#acp-env-gemini-ZCODE_GEMINI_AUTH_MODE')?.textContent?.trim(), fields:[...(d?.querySelectorAll('label[for^="acp-env-gemini-"]')||[])].map(el=>el.getAttribute('for')?.replace('acp-env-gemini-','')).filter(key=>key!=='ZCODE_GEMINI_AUTH_MODE'&&key!=='GEMINI_MODEL'), rawHasMode:Boolean(d?.querySelector('#acp-env-raw-gemini')?.value.includes('ZCODE_GEMINI_AUTH_MODE=')), secretInputs:[...(d?.querySelectorAll('input[id^="acp-env-gemini-"]')||[])].filter(el=>['GEMINI_API_KEY','GOOGLE_API_KEY'].some(key=>el.id.endsWith(key))).every(el=>el.type==='password'), saveEnabled:[...(d?.querySelectorAll('button')||[])].some(el=>el.textContent?.trim()==='保存 Gemini 配置'&&!el.disabled), nativeCodex:document.querySelectorAll('[data-testid=acp-codex-native-config]').length};})()`,
    );
    assert.deepEqual(
      state,
      {
        mode: label,
        fields: expected,
        rawHasMode: false,
        secretInputs: true,
        saveEnabled:
          label === "模型供应商"
            ? Boolean(
                await evaluate(
                  "document.querySelector('#acp-gemini-provider')?.textContent?.trim() && !document.querySelector('[data-testid=acp-gemini-providers-empty]')",
                ),
              )
            : true,
        nativeCodex: 0,
      },
      label,
    );
    if (label === "模型供应商") {
      for (let attempt = 0; attempt < 50; attempt++) {
        if (
          await evaluate(
            "!document.querySelector('[data-testid=acp-gemini-provider-add]')?.disabled",
          )
        )
          break;
        await delay(20);
      }
      assert.equal(
        await evaluate("Boolean(document.querySelector('[data-testid=acp-gemini-providers]'))"),
        true,
      );
      assert.equal(
        await evaluate(
          "['GEMINI_API_KEY','GOOGLE_GEMINI_BASE_URL','GEMINI_MODEL'].every(key=>document.querySelector('#acp-env-gemini-'+key)?.readOnly)",
        ),
        true,
      );
      await evaluate("document.querySelector('[data-testid=acp-gemini-provider-add]').click()");
      assert.equal(
        await evaluate(
          "document.querySelector('#acp-gemini-provider-apiKey')?.type === 'password' && document.querySelectorAll('[data-testid=acp-gemini-provider-dialog] input').length === 4",
        ),
        true,
      );
      await evaluate(
        "[...document.querySelectorAll('[data-testid=acp-gemini-provider-dialog] button')].find(el=>el.textContent?.trim()==='取消').click()",
      );
    }
  }
  process.stdout.write(
    `PASS: ${modes.length} Gemini auth modes show their own fields without a raw editor.\n`,
  );
} finally {
  // No save was issued; reload drops only the temporary UI draft.
  if (edited) await evaluate("location.reload()").catch(() => {});
  socket.close();
}
