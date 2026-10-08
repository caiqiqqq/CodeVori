import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import {
  ACP_ATTACHMENT_MAX_BYTES,
  type AcpAttachmentRef,
  type AcpAttachmentReadResult,
  type AcpPromptAttachment,
} from "@zcode/shared";

async function sourceBytes(path: string): Promise<Buffer> {
  const source = await open(path, "r");
  try {
    const info = await source.stat();
    if (!info.isFile() || info.size > ACP_ATTACHMENT_MAX_BYTES)
      throw new Error("ACP attachment exceeds file limits");
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = await source.read(bytes, offset, bytes.length - offset, offset);
      if (!chunk.bytesRead) throw new Error("ACP attachment changed while reading");
      offset += chunk.bytesRead;
    }
    if ((await source.stat()).size !== bytes.length)
      throw new Error("ACP attachment changed while reading");
    return bytes;
  } finally {
    await source.close();
  }
}

/** IO only: admission/revision/removal remain owned by the existing ACP service. */
export class AcpAttachmentStore {
  constructor(private readonly root: string) {}

  private sessionDirectory(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid ACP attachment session");
    return join(this.root, id);
  }

  async save(id: string, inputs: readonly AcpPromptAttachment[], blocks: readonly ContentBlock[]) {
    if (!inputs.length) return { attachments: [] as AcpAttachmentRef[], group: null };
    const group = randomUUID();
    const directory = join(this.sessionDirectory(id), group);
    const attachments: AcpAttachmentRef[] = [];
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      for (const [index, input] of inputs.entries()) {
        const block = blocks[index];
        // 修复依据：图片保存已经校验并发给 Agent 的同一字节，不再次读取可变化的源文件。
        const bytes =
          block?.type === "image"
            ? Buffer.from(block.data, "base64")
            : block?.type === "resource" && "blob" in block.resource
              ? Buffer.from(block.resource.blob, "base64")
              : input.path
                ? await sourceBytes(input.path)
                : null;
        if (!bytes || bytes.length > ACP_ATTACHMENT_MAX_BYTES)
          throw new Error("ACP attachment has no valid saved content");
        await writeFile(join(directory, String(index)), bytes, { flag: "wx", mode: 0o600 });
        attachments.push({
          ref: `acp-attachment:${group}/${index}`,
          fileName: input.fileName,
          mime: input.mimeType,
          bytes: bytes.length,
        });
      }
      return { attachments, group };
    } catch (error) {
      await this.discard(id, group);
      throw error;
    }
  }

  async discard(id: string, group: string | null) {
    if (group) await rm(join(this.sessionDirectory(id), group), { recursive: true, force: true });
  }

  async remove(id: string) {
    await rm(this.sessionDirectory(id), { recursive: true, force: true });
  }

  async read(
    id: string,
    attachment: AcpAttachmentRef,
    offset: number,
    limit: number,
  ): Promise<AcpAttachmentReadResult> {
    const suffix = attachment.ref.slice("acp-attachment:".length);
    if (!/^[0-9a-f-]{36}\/[0-7]$/i.test(suffix)) throw new Error("Invalid ACP attachment ref");
    const path = join(this.sessionDirectory(id), suffix);
    const canonicalRoot = await realpath(this.root);
    // 引用必须落到当前会话的固定文件；拒绝 symlink 和任何路径越界。
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (await realpath(path)) !== join(canonicalRoot, id, suffix)
    )
      throw new Error("Invalid ACP attachment file");
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const details = await file.stat();
      if (!details.isFile() || details.size !== attachment.bytes || offset > details.size)
        throw new Error("Invalid ACP attachment size or offset");
      const bytes = Buffer.alloc(Math.min(limit, details.size - offset));
      let read = 0;
      while (read < bytes.length) {
        const chunk = await file.read(bytes, read, bytes.length - read, offset + read);
        if (!chunk.bytesRead) throw new Error("ACP attachment file is incomplete");
        read += chunk.bytesRead;
      }
      return {
        dataBase64: bytes.toString("base64"),
        mediaType: attachment.mime,
        totalBytes: details.size,
        nextOffset: offset + read < details.size ? offset + read : null,
      };
    } finally {
      await file.close();
    }
  }
}
