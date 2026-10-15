import { BufferWriter, serialize } from "@zcode/rpc";
import { createUuid, ServiceChannels } from "@zcode/shared";
import {
  PROTOCOL_V4_LIMITS,
  type V4AttachmentBeginResult,
  type V4AttachmentChunkResult,
  type V4AttachmentPutParams,
  type V4AttachmentPutResult,
  type V4AttachmentBeginParams,
  type V4AttachmentChunkParams,
} from "@zcode/shared/zcode-protocol-v4";
import type {
  ZCodeAgentAttachmentBeginParams,
  ZCodeAgentAttachmentChunkParams,
  ZCodeAgentAttachmentTerminalParams,
} from "@zcode/services";
import { logger } from "@/logger.js";

/** 384KiB 可被 3 整除，除末片外 base64 不含 padding；同时为两层 envelope 留足空间。 */
const ATTACHMENT_UPLOAD_CHUNK_BYTES = 384 * 1024;

interface AttachmentUploadAgent {
  attachmentBeginV4(params: ZCodeAgentAttachmentBeginParams): Promise<V4AttachmentBeginResult>;
  attachmentChunkV4(params: ZCodeAgentAttachmentChunkParams): Promise<V4AttachmentChunkResult>;
  attachmentCommitV4(params: ZCodeAgentAttachmentTerminalParams): Promise<V4AttachmentPutResult>;
  attachmentAbortV4(params: ZCodeAgentAttachmentTerminalParams): Promise<void>;
}

interface AttachmentUploadWorkspace {
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface AttachmentUploadProgress {
  phase: "uploading" | "committing";
  uploadedBytes: number;
  totalBytes: number;
}

export interface AttachmentUploadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AttachmentUploadProgress) => void;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Attachment upload canceled");
  error.name = "AbortError";
  throw error;
}

function decodeBase64(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodedBase64ByteLength(dataBase64: string): number {
  if (dataBase64.length === 0) return 0;
  if (dataBase64.length % 4 !== 0) throw new Error("proto.invalidBase64");
  const padding = dataBase64.endsWith("==") ? 2 : dataBase64.endsWith("=") ? 1 : 0;
  const contentLength = dataBase64.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    const code = dataBase64.charCodeAt(index);
    const valid =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47;
    if (!valid) throw new Error("proto.invalidBase64");
  }
  for (let index = contentLength; index < dataBase64.length; index += 1) {
    if (dataBase64.charCodeAt(index) !== 61) throw new Error("proto.invalidBase64");
  }
  return (dataBase64.length / 4) * 3 - padding;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const callStackSafeChunk = 0x8000;
  for (let index = 0; index < bytes.length; index += callStackSafeChunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + callStackSafeChunk));
  }
  return btoa(binary);
}

async function checksum(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("fault.attachment.checksumUnavailable");
  // WebCrypto 的 BufferSource 要求 ArrayBuffer；复制也避免调用期间底层 view 被复用。
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function createUploadId(): string {
  return `upload-${createUuid()}`;
}

/** 用 production ChannelClient 相同的 serializer 计量完整 method+args physical request。 */
function measureAttachmentChannelRequestBytes(method: string, params: unknown): number {
  const writer = new BufferWriter();
  // RequestType.Promise=100；max int id 比正常短生命周期 request id 更保守。
  serialize(writer, [100, 2_147_483_647, ServiceChannels.ZCodeAgent, method]);
  serialize(writer, [params]);
  return writer.buffer.byteLength;
}

function assertAttachmentChannelRequest(method: string, params: unknown): void {
  if (measureAttachmentChannelRequestBytes(method, params) > PROTOCOL_V4_LIMITS.maxFrameBytes) {
    throw new Error("proto.frameTooLarge");
  }
}

export async function uploadAttachmentTransaction(
  agent: AttachmentUploadAgent,
  workspace: AttachmentUploadWorkspace,
  input: V4AttachmentPutParams,
  options: AttachmentUploadOptions = {},
): Promise<V4AttachmentPutResult> {
  const target = { ...workspace, sessionId: input.sessionId };
  return uploadAttachmentBytes(
    {
      begin: (data) => {
        const params = { ...target, ...data };
        assertAttachmentChannelRequest("attachmentBeginV4", params);
        return agent.attachmentBeginV4(params);
      },
      chunk: (data) => {
        const params = { ...target, ...data };
        assertAttachmentChannelRequest("attachmentChunkV4", params);
        return agent.attachmentChunkV4(params);
      },
      commit: (data) => {
        const params = { ...target, ...data };
        assertAttachmentChannelRequest("attachmentCommitV4", params);
        return agent.attachmentCommitV4(params);
      },
      abort: (data) => agent.attachmentAbortV4({ ...target, ...data }),
    },
    {
      fileName: input.fileName,
      mime: input.mime,
      bytes: validatedAttachmentBytes(input.dataBase64),
    },
    options,
  );
}

function validatedAttachmentBytes(dataBase64: string) {
  const decodedBytes = decodedBase64ByteLength(dataBase64);
  if (decodedBytes > PROTOCOL_V4_LIMITS.attachmentMaxBytes)
    throw new Error("proto.payloadTooLarge");
  const bytes = decodeBase64(dataBase64);
  if (bytes.byteLength !== decodedBytes) throw new Error("proto.invalidBase64");
  return bytes;
}

export interface AttachmentUploadTransactionPort {
  begin(
    data: Pick<
      V4AttachmentBeginParams,
      "uploadId" | "fileName" | "mime" | "totalBytes" | "totalChunks" | "checksum"
    >,
  ): Promise<V4AttachmentBeginResult>;
  chunk(
    data: Pick<V4AttachmentChunkParams, "uploadId" | "chunkIndex" | "dataBase64">,
  ): Promise<V4AttachmentChunkResult>;
  commit(data: { uploadId: string }): Promise<V4AttachmentPutResult>;
  abort(data: { uploadId: string }): Promise<void>;
}

/** Same bounded transaction for session artifacts and Host-owned task drafts. */
export async function uploadAttachmentBytes(
  port: AttachmentUploadTransactionPort,
  input: { fileName: string; mime: string; bytes: Uint8Array },
  options: AttachmentUploadOptions = {},
): Promise<V4AttachmentPutResult> {
  throwIfAborted(options.signal);
  const bytes = input.bytes;
  if (bytes.length > PROTOCOL_V4_LIMITS.attachmentMaxBytes) {
    throw new Error("proto.payloadTooLarge");
  }
  const uploadId = createUploadId();
  const common = { uploadId };
  const totalChunks = Math.ceil(bytes.byteLength / ATTACHMENT_UPLOAD_CHUNK_BYTES);
  const beginParams = {
    ...common,
    fileName: input.fileName,
    mime: input.mime,
    totalBytes: bytes.byteLength,
    totalChunks,
    checksum: await checksum(bytes),
  };

  let began = false;
  try {
    throwIfAborted(options.signal);
    // begin 回复丢失时 Host 可能已经创建暂存文件；仍按 uploadId 尝试清理。
    began = true;
    const begin = await port.begin(beginParams);
    if (begin.state === "committed") {
      options.onProgress?.({
        phase: "committing",
        uploadedBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
      });
      return { ref: begin.ref };
    }
    if (begin.nextChunkIndex > totalChunks) {
      throw new Error("fault.attachment.invalidServerProgress");
    }
    options.onProgress?.({
      phase: "uploading",
      uploadedBytes: Math.min(
        begin.nextChunkIndex * ATTACHMENT_UPLOAD_CHUNK_BYTES,
        bytes.byteLength,
      ),
      totalBytes: bytes.byteLength,
    });
    for (let chunkIndex = begin.nextChunkIndex; chunkIndex < totalChunks; chunkIndex += 1) {
      throwIfAborted(options.signal);
      const start = chunkIndex * ATTACHMENT_UPLOAD_CHUNK_BYTES;
      const chunkParams = {
        ...common,
        chunkIndex,
        dataBase64: encodeBase64(
          bytes.subarray(start, Math.min(start + ATTACHMENT_UPLOAD_CHUNK_BYTES, bytes.length)),
        ),
      };
      const result = await port.chunk(chunkParams);
      if (result.nextChunkIndex !== chunkIndex + 1) {
        throw new Error("fault.attachment.invalidServerProgress");
      }
      options.onProgress?.({
        phase: "uploading",
        uploadedBytes: Math.min((chunkIndex + 1) * ATTACHMENT_UPLOAD_CHUNK_BYTES, bytes.byteLength),
        totalBytes: bytes.byteLength,
      });
    }
    throwIfAborted(options.signal);
    options.onProgress?.({
      phase: "committing",
      uploadedBytes: bytes.byteLength,
      totalBytes: bytes.byteLength,
    });
    return await port.commit(common);
  } catch (error) {
    if (began) {
      try {
        await port.abort(common);
      } catch (abortError) {
        logger.warn("[v4-attachment] failed to abort upload transaction", abortError);
      }
    }
    throw error;
  }
}
