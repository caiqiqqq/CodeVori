import assert from "node:assert/strict";
import test from "node:test";
import { buildAssistantPreviewCardsFromReferences } from "../src/lib/assistantPreviewCards.ts";

const health = "https://127.0.0.1:6443/healthz";
const preview = "http://localhost:5173/preview";
const cards = (content: string) =>
  buildAssistantPreviewCardsFromReferences(content, "/fixture", []);

test("diagnostic URLs in code examples never become website cards", () => {
  for (const example of [
    `\`\`\`bash\ncurl -k ${health}\n\`\`\``,
    `~~~bash\ncurl -k ${health}\n~~~`,
    `执行 \`curl -k ${health}\` 后贴出日志。`,
    `<pre>curl -k ${health}</pre>`,
    `<code>curl -k ${health}</code>`,
    `\`\`\`bash\ncurl -k ${health}`,
  ]) {
    assert.deepEqual(cards(`${example}\n\n记好了。等你贴日志。`), [], example);
  }
});

test("real preview links outside code survive filtering and keep their title", () => {
  const result = cards(`\`\`\`bash\ncurl -k ${health}\n\`\`\`\n\n[打开预览](${preview})`);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.type, "website");
  assert.equal(result[0]?.type === "website" && result[0].url, preview);
  assert.equal(result[0]?.title, "打开预览");
  assert.equal(cards(`预览地址：${preview}`)[0]?.type, "website");
});

test("a URL mentioned in both code and prose is still offered once", () => {
  const result = cards(`\`${preview}\`\n\n[打开预览](${preview})`);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.title, "打开预览");
});
