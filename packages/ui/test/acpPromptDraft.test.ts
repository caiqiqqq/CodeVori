import assert from "node:assert/strict";
import test from "node:test";
import {
  acpAttachmentsFromComposer,
  acpWorkspaceFilesFromEditor,
} from "../src/v4/composer/acpPromptDraft.ts";
import type { ComposerAttachmentUploadItem } from "../src/store/composerAttachmentUploadStore.ts";

test("only structured workspace file mentions become ACP references", () => {
  const editor = JSON.stringify({
    root: {
      children: [
        { type: "prompt-mention", category: "files", value: "src/main.ts" },
        { type: "prompt-mention", category: "plugins", value: "demo@market" },
        { type: "prompt-mention", category: "files", value: "src/main.ts" },
      ],
    },
  });
  assert.deepEqual(acpWorkspaceFilesFromEditor(editor), ["src/main.ts"]);
});

test("ACP converts Web File bytes and target-Host paths without ZCode artifact refs", async () => {
  const file = new File(["hello"], "hello.txt", { type: "text/plain" });
  const items = [
    { filename: "hello.txt", mimeType: "text/plain", file },
    {
      filename: "image.png",
      mimeType: "image/png",
      localPath: "/host/image.png",
      staged: true,
      uploadStatus: "ready",
      attachmentRef: { ref: "/target/image.png" },
    },
  ] as ComposerAttachmentUploadItem[];
  assert.deepEqual(await acpAttachmentsFromComposer(items, true), [
    { fileName: "hello.txt", mimeType: "text/plain", dataBase64: "aGVsbG8=" },
    { fileName: "image.png", mimeType: "image/png", path: "/target/image.png" },
  ]);
  await assert.rejects(
    acpAttachmentsFromComposer([{ ...items[1], staged: false }], true),
    /not ready/,
  );
});

test("queue edit restores file mentions in place without duplicating text or treating unrelated links as references", async () => {
  const { acpQueuedEditorState } = await import("../src/v4/composer/acpPromptDraft.ts");
  const text =
    "inspect [main.ts](./src/main.ts) and [site](https://example.com)\n\nthen [a\\]b](<./a b.ts>)";
  const encoded = acpQueuedEditorState(text, ["src/main.ts", "a b.ts"]);
  assert.deepEqual(acpWorkspaceFilesFromEditor(encoded), ["src/main.ts", "a b.ts"]);
  const state = JSON.parse(encoded);
  const markdown = state.root.children
    .map((p: { children: Array<{ markdown?: string; text: string }> }) =>
      p.children.map((n) => n.markdown ?? n.text).join(""),
    )
    .join("\n\n");
  assert.equal(markdown, text);
  assert.deepEqual(acpWorkspaceFilesFromEditor(acpQueuedEditorState("", ["src/main.ts"])), [
    "src/main.ts",
  ]);
});
