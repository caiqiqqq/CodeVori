import assert from "node:assert/strict";
import test from "node:test";
import {
  createRootTraceContext,
  type FileSystemPort,
  type MessageInfo,
  type MessagePart,
  type ModelMessageContentBlock,
  type ToolArtifactStorePort,
} from "@zcode/contracts";
import { MessageHistoryImpl } from "../src/agent/message-history.js";
import { hydrateMessageHistoryFromSession } from "../src/agent/session-history-hydrator.js";
import { resolveTurnAttachments } from "../src/runtime/helpers/attachments.js";
import { buildRuntimeUserEntriesFromTurn } from "../src/runtime/helpers/conversation.js";
import { persistUserPrompt } from "../src/runtime/methods/message-persistence.js";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import type { ResolvedTurnAttachment } from "../src/runtime/types.js";

async function roundTrip(
  attachments: ResolvedTurnAttachment[],
  artifactStore?: ToolArtifactStorePort,
) {
  const parts: MessagePart[] = [];
  let info: MessageInfo | undefined;
  const runtime = {
    sessionId: "fixture-session",
    config: {},
    sessionStore: {},
    getTools: () => [],
    getSessionModelSelection: () => undefined,
    persistMessage(message: MessageInfo) {
      info = message;
    },
    persistPart(part: MessagePart) {
      parts.push(part);
    },
  } as unknown as AgentRuntimeInternal;
  await persistUserPrompt.call(
    runtime,
    "fixture-message" as never,
    "synthetic input",
    attachments,
    createRootTraceContext(),
  );
  assert.ok(info);
  const history = new MessageHistoryImpl();
  await hydrateMessageHistoryFromSession({ history, messages: [{ info, parts }], artifactStore });
  // Media source.id/kind is rebuilt from persisted parts; compare actual provider bytes/order and reminder text.
  const normalize = (entries: unknown) =>
    JSON.parse(
      JSON.stringify(entries, (key, value) =>
        key === "source" && value && typeof value === "object" ? undefined : value,
      ),
    );
  assert.deepEqual(
    normalize(history.borrowReadOnlyRuntimeEntries()),
    normalize(buildRuntimeUserEntriesFromTurn("synthetic input", attachments)),
  );
  return { info, parts };
}

test("mixed PDF, URL, inline text and pasted image preserve the live message ordering after recovery", async () => {
  const attachments = await resolveTurnAttachments(
    [
      { type: "pdf", content: "data:application/pdf;base64,JVBERi0xLjcKZml4dHVyZQ==" },
      { type: "url", content: "https://example.test/fixture" },
      { type: "file", content: "synthetic text attachment" },
      { type: "image", content: "data:image/png;base64,aW1hZ2U=" },
      { type: "video", content: "data:video/mp4;base64,dmlkZW8=" },
    ],
    { workingDirectory: "/fixture", traceContext: createRootTraceContext() },
  );
  await roundTrip(attachments);
});

test("directory and deferred binary references retain the exact model-facing explanation without rereading disk", async () => {
  const fileSystemPort = {
    stat: async ({ path }: { path: string }) => ({
      kind: path.endsWith("dir") ? "directory" : "file",
      sizeBytes: 42,
    }),
  } as FileSystemPort;
  const attachments = await resolveTurnAttachments(
    [
      { type: "file", path: "/fixture/dir" },
      { type: "file", path: "/fixture/archive.bin" },
    ],
    { workingDirectory: "/fixture", fileSystemPort, traceContext: createRootTraceContext() },
  );
  await roundTrip(attachments);
});

test("persisted failed text attachment does not become a successful reference after recovery", async () => {
  const fileSystemPort = {
    stat: async () => {
      throw new Error("synthetic missing file");
    },
  } as unknown as FileSystemPort;
  const attachments = await resolveTurnAttachments(
    [{ type: "file", path: "/fixture/missing.txt" }],
    {
      workingDirectory: "/fixture",
      fileSystemPort,
      traceContext: createRootTraceContext(),
    },
  );
  assert.equal(attachments[0]?.metadata.errorCode, "attachment_read_failed");
  await roundTrip(attachments);
});

test("a durable local image keeps its place among PDF and video when restored as inline media", async () => {
  const uri = "zcode-artifact://fixture/image";
  const dataUrl = "data:image/png;base64,aW1hZ2U=";
  const image: ResolvedTurnAttachment = {
    mime: "image/png",
    url: uri,
    metadata: { artifactUri: uri, storageKind: "artifact", recoverability: "provider_ready" },
    source: {
      type: "file",
      path: "/deleted/image.png",
      text: { value: "image.png", start: 0, end: 9 },
    },
    contentBlock: {
      type: "image",
      dataUrl,
      mediaType: "image/png",
      source: { kind: "local_file", path: "/deleted/image.png", uri: "/deleted/image.png" },
    } as ModelMessageContentBlock,
  };
  const [pdf] = await resolveTurnAttachments(
    [{ type: "pdf", content: "data:application/pdf;base64,JVBERi0xLjcKZml4dHVyZQ==" }],
    {
      workingDirectory: "/fixture",
      traceContext: createRootTraceContext(),
    },
  );
  const artifactStore = {
    readToolResultArtifact: async () => ({ content: dataUrl }),
  } as unknown as ToolArtifactStorePort;
  await roundTrip([image, pdf!], artifactStore);
});
