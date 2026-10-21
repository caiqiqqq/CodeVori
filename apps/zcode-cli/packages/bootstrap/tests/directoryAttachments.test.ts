import assert from "node:assert/strict";
import test from "node:test";
import { mapAttachmentRefsToTurnAttachments } from "../src/zcode-protocol-v4/commands/attachment-refs.js";
import type { ZCodeApp } from "../src/app/types.js";

test("API restored directory artifacts decode as Host paths, not inline file text", async () => {
  const ref = {
    ref: "zcode-artifact://directory",
    fileName: "project",
    mime: "inode/directory",
    bytes: 16,
  };
  const app = (content: string) =>
    ({ readToolResultArtifact: async () => ({ content }) }) as unknown as ZCodeApp;
  for (const content of [
    "/fixture/project",
    `data:text/plain;base64,${Buffer.from("/fixture/project").toString("base64")}`,
  ]) {
    const mapped = await mapAttachmentRefsToTurnAttachments(app(content), [ref]);
    assert.deepEqual(mapped, [
      {
        path: "/fixture/project",
        type: "file",
        filename: "project",
        mimeType: "inode/directory",
        sizeBytes: 16,
      },
    ]);
  }
  await assert.rejects(
    mapAttachmentRefsToTurnAttachments(app("relative/path"), [ref]),
    /absolute Host path/,
  );
});
