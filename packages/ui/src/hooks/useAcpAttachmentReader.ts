import { useMemo } from "react";
import type { IAcpService } from "@zcode/services";
import {
  ACP_ATTACHMENT_READ_CHUNK_BYTES,
  acpAttachmentReadResultSchema,
  type AcpWorkspace,
} from "@zcode/shared";
import type { ConversationAttachmentReadParams } from "@/v4/transport.js";

/** 适配现有消息预览契约；只访问当前 ACP Host，不把 ACP id 交给原生 CLI。 */
export function createAcpAttachmentReader(
  service: Pick<IAcpService, "readAttachment">,
  scope: AcpWorkspace,
  sessionId: string | null,
) {
  const target = { ...scope };
  const check = (params: ConversationAttachmentReadParams) => {
    if (params.signal?.aborted) throw new DOMException("Attachment read cancelled", "AbortError");
    if (!sessionId || params.sessionId !== sessionId)
      throw new Error("ACP attachment session changed");
  };
  const readAttachmentRange = async (
    params: ConversationAttachmentReadParams & { offset: number; limit: number },
  ) => {
    check(params);
    const limit = Math.min(params.limit, ACP_ATTACHMENT_READ_CHUNK_BYTES);
    const result = acpAttachmentReadResultSchema.parse(
      await service.readAttachment({
        ...target,
        id: sessionId!,
        ref: params.ref,
        offset: params.offset,
        limit,
      }),
    );
    check(params);
    const bytes = Uint8Array.from(atob(result.dataBase64), (char) => char.charCodeAt(0));
    const end = params.offset + bytes.length;
    // 防止损坏或旧 Host 回包重复偏移，让读取无限循环或拼出另一份图片。
    if (
      bytes.length > limit ||
      end > result.totalBytes ||
      (result.nextOffset === null
        ? end !== result.totalBytes
        : result.nextOffset !== end || end <= params.offset)
    )
      throw new Error("Invalid ACP attachment chunk");
    return {
      bytes,
      mediaType: result.mediaType,
      totalBytes: result.totalBytes,
      nextOffset: result.nextOffset,
    };
  };
  const readAttachment = async (params: ConversationAttachmentReadParams) => {
    let offset = 0;
    let content: Uint8Array | undefined;
    let mediaType = "";
    for (;;) {
      const chunk = await readAttachmentRange({
        ...params,
        offset,
        limit: ACP_ATTACHMENT_READ_CHUNK_BYTES,
      });
      content ??= new Uint8Array(chunk.totalBytes);
      if (content.length !== chunk.totalBytes || (mediaType && mediaType !== chunk.mediaType))
        throw new Error("ACP attachment changed between chunks");
      mediaType = chunk.mediaType;
      content.set(chunk.bytes, offset);
      if (chunk.nextOffset === null) return { bytes: content, mediaType };
      offset = chunk.nextOffset;
    }
  };
  return { readAttachment, readAttachmentRange };
}

export function useAcpAttachmentReader(
  service: IAcpService,
  scope: AcpWorkspace,
  sessionId: string | null,
) {
  return useMemo(
    () => createAcpAttachmentReader(service, scope, sessionId),
    [service, scope.workspacePath, scope.workspaceIdentity, scope.remoteSessionId, sessionId],
  );
}
