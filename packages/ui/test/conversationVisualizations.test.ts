import assert from "node:assert/strict";
import test from "node:test";
import { projectConversationVisualizations } from "../src/lib/conversationVisualizations.ts";
import { extractAssistantFileReferences } from "../src/lib/assistantFileReferences.ts";
import { readConversationVisualization } from "../src/hooks/conversationVisualizationReader.ts";
import {
  buildVisualizationDocument,
  resolveVisualizationHeight,
} from "../src/lib/visualizationDocument.ts";

const marker = (params: unknown) => `\uE200visualize\uE202${JSON.stringify(params)}\uE201`;
const reference = marker({ path: "/project/preview.html", mode: "wide", title: "Preview" });

test("projects references in source order and preserves Markdown", () => {
  const blocks = projectConversationVisualizations(
    `**Before**\n\n${reference}\n\nAfter\n${marker({ path: "second.htm" })}`,
    false,
  );
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["markdown", "visualization", "markdown", "visualization"],
  );
  assert.equal(blocks[0]?.kind === "markdown" && blocks[0].text, "**Before**\n\n");
  assert.equal(blocks[1]?.kind === "visualization" && blocks[1].reference.mode, "wide");
  assert.equal(blocks[3]?.kind === "visualization" && blocks[3].reference.mode, "normal");
});

test("visualization paths do not create duplicate ordinary HTML preview cards", () => {
  assert.deepEqual(extractAssistantFileReferences(reference, "/project"), []);
  assert.equal(
    extractAssistantFileReferences(
      `${reference}\n\n[Another file](/project/other.html)`,
      "/project",
    )[0]?.path,
    "/project/other.html",
  );
});

test("streaming prefixes never execute and a closed reference renders once", () => {
  for (let index = 1; index < reference.length; index++) {
    const blocks = projectConversationVisualizations(`Before\n${reference.slice(0, index)}`, true);
    assert.ok(blocks.every((block) => block.kind === "markdown"));
    assert.equal(
      blocks.map((block) => (block.kind === "markdown" ? block.text : "")).join(""),
      "Before\n",
    );
  }
  assert.equal(projectConversationVisualizations(reference, true)[0]?.kind, "visualization");
  assert.equal(
    projectConversationVisualizations(reference.slice(0, -1), false)[0]?.kind,
    "markdown",
  );
});

test("code, inline prose, invalid JSON, unsafe paths and invalid options stay text", () => {
  for (const content of [
    `\`\`\`text\n${reference}\n\`\`\``,
    `\`${reference}\``,
    `    ${reference}`,
    `\t${reference}`,
    `prose ${reference}`,
    "\uE200visualize\uE202{broken}\uE201",
    marker({ path: "https://example.com/a.html" }),
    marker({ path: "../escape.html" }),
    marker({ path: "/project/a.txt" }),
    marker({ path: "/project/a.html", mode: "fullscreen" }),
    marker({ path: "/project/a.html", title: 12 }),
  ])
    assert.deepEqual(projectConversationVisualizations(content, false), [
      { kind: "markdown", text: content, start: 0 },
    ]);
});

test("height messages are validated and bounded", () => {
  for (const data of [
    null,
    {},
    { type: "other", height: 500 },
    { type: "zcode-visualization-height", height: Infinity },
    { type: "zcode-visualization-height", height: "500" },
  ])
    assert.equal(resolveVisualizationHeight(data), null);
  assert.equal(resolveVisualizationHeight({ type: "zcode-visualization-height", height: -1 }), 64);
  assert.equal(
    resolveVisualizationHeight({ type: "zcode-visualization-height", height: 5000 }),
    1400,
  );
});

function files(overrides = {}) {
  const bytes = new TextEncoder().encode("<button>Preview</button>");
  return {
    resolvePath: async ({ path }: { path: string }) => path,
    stat: async () => ({ path: "/project/a.html", type: "file" as const, size: bytes.length }),
    readFileRange: async ({ length }: { length: number }) => {
      assert.equal(length, 1_000_001);
      return bytes;
    },
    ...overrides,
  };
}

test("reads a bounded UTF-8 fragment after canonical workspace validation", async () => {
  assert.equal(
    await readConversationVisualization(files(), "/project", "a.html"),
    "<button>Preview</button>",
  );
  assert.equal(
    await readConversationVisualization(files(), "C:\\project", "C:\\project\\a.html"),
    "<button>Preview</button>",
  );
});

test("rejects traversal, canonical escapes, oversized, truncated and invalid UTF-8 files", async () => {
  let reads = 0;
  const denied = files({
    readFileRange: async () => {
      reads++;
      return new Uint8Array();
    },
  });
  for (const path of ["../a.html", "/project-other/a.html", "/outside/a.html"])
    await assert.rejects(readConversationVisualization(denied, "/project", path));
  await assert.rejects(
    readConversationVisualization(
      files({
        resolvePath: async ({ path }: { path: string }) =>
          path.endsWith("a.html") ? "/outside/a.html" : path,
      }),
      "/project",
      "a.html",
    ),
  );
  assert.equal(reads, 0);
  await assert.rejects(
    readConversationVisualization(
      files({ stat: async () => ({ type: "file", size: 1_000_001 }) }),
      "/project",
      "a.html",
    ),
  );
  await assert.rejects(
    readConversationVisualization(
      files({ readFileRange: async () => new Uint8Array([0xff]) }),
      "/project",
      "a.html",
    ),
  );
  await assert.rejects(
    readConversationVisualization(
      files({ readFileRange: async () => new Uint8Array() }),
      "/project",
      "a.html",
    ),
  );
});

test("document isolates executable HTML and supplies theme and sizing bootstrap", () => {
  const document = buildVisualizationDocument("<button>Preview</button>", "dark");
  assert.ok(document.includes("Content-Security-Policy"));
  assert.ok(document.includes("connect-src 'none'"));
  assert.ok(document.includes("frame-src 'none'"));
  assert.ok(document.includes("color-scheme:dark"));
  assert.ok(document.includes("ResizeObserver"));
  assert.ok(document.includes("<button>Preview</button>"));
  assert.ok(!document.includes("window.zcode"));
});
