// Run against a ZCode Dev renderer with at least one mixed installed/uninstalled store group.
// ZCODE_E2E_CDP_URL=http://127.0.0.1:9229 node packages/ui/test/pluginStoreInstalledPriority.e2e.mjs
import assert from "node:assert/strict";

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
        method: "Runtime.evaluate",
        id,
        params: { expression, returnByValue: true },
      }),
    );
  });
}

try {
  if (!(await evaluate('Boolean(document.querySelector("[data-testid=plugin-store-list]"))'))) {
    await evaluate('document.querySelector("[data-testid=plugin-store-sidebar-open]")?.click()');
  }
  assert.ok(await evaluate('Boolean(document.querySelector("[data-testid=plugin-store-list]"))'));
  let mixedGroups = 0;
  for (const segment of ["public", "personal"]) {
    await evaluate(
      `document.querySelector('[data-testid="plugin-store-segment-${segment}"]')?.click()`,
    );
    const groups = await evaluate(`(() => {
      const installed = new Set([...document.querySelectorAll('[data-testid="plugin-store-installed-item"]')]
        .map((node) => node.getAttribute('data-plugin-id')));
      return [...document.querySelectorAll('[data-testid="plugin-store-sorted-group"]')].map((group) => ({
        key: group.getAttribute('data-group-key'),
        flags: [...group.querySelectorAll('[data-testid="plugin-store-card"]')]
          .map((card) => installed.has(card.getAttribute('data-plugin-id'))),
      }));
    })()`);
    for (const group of groups) {
      if (group.flags.includes(true) && group.flags.includes(false)) mixedGroups++;
      assert.deepEqual(
        group.flags,
        [...group.flags].sort((left, right) => Number(right) - Number(left)),
        group.key,
      );
    }
  }
  assert.ok(mixedGroups > 0, "fixture must contain a mixed installed/uninstalled group");
  process.stdout.write(`PASS: installed plugins lead in ${mixedGroups} mixed store groups.\n`);
} finally {
  socket.close();
}
