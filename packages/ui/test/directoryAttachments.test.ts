import assert from "node:assert/strict";
import test from "node:test";
import { classifyPathAttachment } from "../src/v4/composer/classifyPathAttachment.ts";
import { acpAttachmentsFromComposer } from "../src/v4/composer/acpPromptDraft.ts";
import { serializeChatComposerAttachment } from "../src/lib/chatAttachments.ts";
import { uploadComposerAttachment } from "../src/v4/composer/attachmentUpload.ts";
import type { ComposerAttachmentUploadItem } from "../src/store/composerAttachmentUploadStore.ts";

test("directory classification overrides extensions and preserves path refs in both transports", async () => {
  const item = {
    id: "directory",
    filename: "project.png",
    localPath: "/host/project.png",
    mimeType: "image/png",
    sizeBytes: 4096,
    uploadStatus: "ready",
    attachmentRef: {
      ref: "/host/project.png",
      mime: "image/png",
      bytes: 4096,
      fileName: "project.png",
    },
  } as ComposerAttachmentUploadItem;
  const classified = await classifyPathAttachment(item, {
    stat: async () => ({ path: item.localPath!, type: "directory" }),
  });
  assert.equal(classified.mimeType, "inode/directory");
  assert.equal(classified.attachmentRef?.mime, "inode/directory");
  assert.equal(item.mimeType, "image/png");
  const serialized = await serializeChatComposerAttachment(classified);
  const uploaded = await uploadComposerAttachment(
    async () => {
      throw Error("Directory must not upload recursively");
    },
    "session",
    serialized,
  );
  assert.equal(uploaded?.ref, item.localPath);
  assert.equal(uploaded?.mime, "inode/directory");
  assert.deepEqual(await acpAttachmentsFromComposer([classified], false), [
    { fileName: item.filename, mimeType: "inode/directory", path: item.localPath },
  ]);
  await assert.rejects(acpAttachmentsFromComposer([classified], true), /not ready/);
});

test("withdrawn directory File preserves reference bytes in API and ACP", async () => {
  const path = "/host/project";
  const file = new File([path], "project", { type: "inode/directory" });
  const item = {
    filename: "project",
    mimeType: file.type,
    file,
    sizeBytes: file.size,
    uploadStatus: "ready",
  } as ComposerAttachmentUploadItem;
  const serialized = await serializeChatComposerAttachment(item);
  let body = "";
  await uploadComposerAttachment(
    async (input) => {
      body = atob(input.dataBase64);
      return { ref: "zcode-artifact://directory" };
    },
    "session",
    serialized,
  );
  assert.equal(body, path);
  assert.equal((await acpAttachmentsFromComposer([item], false))[0]?.dataBase64, btoa(path));
});
