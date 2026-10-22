import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystemPort, TraceContext } from "@zcode/contracts";
import { resolveTurnAttachments } from "../src/runtime/helpers/attachments.js";
import {
  buildUserContentFromTurn,
  buildRuntimeUserEntriesFromTurn,
} from "../src/runtime/helpers/conversation.js";

test("API directory references reach model input without reading directory contents", async () => {
  let stats = 0;
  const fileSystemPort = new Proxy(
    {},
    {
      get(_target, name) {
        if (name === "stat")
          return async () => {
            stats++;
            return { kind: "directory", sizeBytes: 4096 };
          };
        return () => {
          throw new Error(`Unexpected directory IO: ${String(name)}`);
        };
      },
    },
  ) as FileSystemPort;
  for (const type of ["file", "image", "pdf", "video"] as const) {
    const attachments = await resolveTurnAttachments([{ path: "/fixture/project.png", type }], {
      workingDirectory: "/fixture",
      fileSystemPort,
      traceContext: {} as TraceContext,
    });
    assert.equal(attachments[0]?.mime, "inode/directory");
    assert.equal(attachments[0]?.metadata.errorCode, undefined);
    for (const content of [
      buildUserContentFromTurn("inspect", attachments),
      buildRuntimeUserEntriesFromTurn("inspect", attachments),
    ]) {
      assert.match(JSON.stringify(content), /\/fixture\/project.png/);
      assert.match(JSON.stringify(content), /directory/);
      assert.match(JSON.stringify(content), /tools/);
      assert.doesNotMatch(JSON.stringify(content), /attachment_not_file/);
    }
  }
  assert.equal(stats, 4);
});

test("media resolver split preserves inline image, PDF, video and invalid media behavior", async () => {
  const options = { workingDirectory: "/fixture", traceContext: {} as TraceContext };
  const inputs = [
    { type: "image" as const, mime: "image/png", bytes: Buffer.from("image") },
    { type: "pdf" as const, mime: "application/pdf", bytes: Buffer.from("%PDF-1.7\nfixture") },
    { type: "video" as const, mime: "video/mp4", bytes: Buffer.from("video") },
  ];
  for (const input of inputs) {
    const dataUrl = `data:${input.mime};base64,${input.bytes.toString("base64")}`;
    const [result] = await resolveTurnAttachments(
      [{ type: input.type, content: dataUrl }],
      options,
    );
    assert.equal(result?.metadata.errorCode, undefined);
    assert.equal(result?.mime, input.mime);
    assert.equal(result?.contentBlock.type, input.type === "pdf" ? "file" : input.type);
    assert.equal(result?.url, dataUrl);
  }
  const [invalid] = await resolveTurnAttachments(
    [{ type: "pdf", content: "data:application/pdf;base64,bm90LXBkZg==" }],
    options,
  );
  assert.equal(invalid?.metadata.errorCode, "attachment_pdf_invalid");
});
