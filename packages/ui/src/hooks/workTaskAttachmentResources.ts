import type { IFileService } from "@zcode/services";
import { PROTOCOL_V4_LIMITS } from "@zcode/shared/zcode-protocol-v4";
import type { ChatComposerAttachment } from "../lib/chatAttachments.js";

export interface ResourceState {
  url?: string;
  loading?: boolean;
  error?: boolean;
}

interface ResourceEntry {
  state: ResourceState;
  ownedUrl?: string;
  pending?: Promise<ResourceState>;
}

interface ResourceEnvironment {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  decodeImage(url: string): Promise<void>;
}

const browserEnvironment: ResourceEnvironment = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  async decodeImage(url) {
    const image = new Image();
    image.src = url;
    await image.decode();
  },
};

function resourceKey(attachment: ChatComposerAttachment) {
  return JSON.stringify([
    attachment.id,
    attachment.localPath,
    attachment.objectUrl,
    attachment.mimeType,
    attachment.sizeBytes,
  ]);
}

/** One component's temporary preview resources; never owns persisted attachment content. */
export class WorkTaskAttachmentResources {
  private readonly entries = new Map<string, ResourceEntry>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  constructor(
    private readonly files: Pick<IFileService, "stat" | "readFileRange"> | null,
    private readonly environment = browserEnvironment,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.revision;
  private changed() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  private release(entry: ResourceEntry) {
    if (entry.ownedUrl) this.environment.revokeObjectURL(entry.ownedUrl);
    entry.ownedUrl = undefined;
  }
  clear() {
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
    this.changed();
  }

  sync(attachments: readonly ChatComposerAttachment[]) {
    const keys = new Set(attachments.map(resourceKey));
    let removed = false;
    for (const [key, entry] of this.entries) {
      if (keys.has(key)) continue;
      // 从表中移除即使在途读取失效；晚到的分片/解码不能重新生成或发布 URL。
      this.entries.delete(key);
      this.release(entry);
      removed = true;
    }
    if (removed) this.changed();
    for (const attachment of attachments) {
      if (attachment.mimeType.startsWith("image/")) void this.load(attachment);
    }
  }

  get(attachment: ChatComposerAttachment): ResourceState {
    return (
      this.entries.get(resourceKey(attachment))?.state ?? {
        loading: attachment.mimeType.startsWith("image/"),
      }
    );
  }

  load(attachment: ChatComposerAttachment, retry = false): Promise<ResourceState> {
    const key = resourceKey(attachment);
    const previous = this.entries.get(key);
    if (previous?.pending) return previous.pending;
    if (previous && (!previous.state.error || !retry)) return Promise.resolve(previous.state);
    const entry: ResourceEntry = { state: { loading: true } };
    this.entries.set(key, entry);
    // 保存附件仅有 ref，旧缩略图把它当作空 URL；统一读取并与点击预览合并在途请求。
    entry.pending = this.read(attachment, key, entry).finally(() => {
      entry.pending = undefined;
    });
    this.changed();
    return entry.pending;
  }

  private async read(
    attachment: ChatComposerAttachment,
    key: string,
    entry: ResourceEntry,
  ): Promise<ResourceState> {
    const current = () => this.entries.get(key) === entry;
    try {
      let url = attachment.objectUrl;
      if (!url) {
        if (!this.files || !attachment.localPath) throw new Error("work-task.disconnected");
        const stat = await this.files.stat({ path: attachment.localPath });
        if (!current()) return entry.state;
        if (
          stat.type !== "file" ||
          typeof stat.size !== "number" ||
          !Number.isSafeInteger(stat.size) ||
          stat.size < 0 ||
          stat.size > PROTOCOL_V4_LIMITS.attachmentMaxBytes
        )
          throw new Error("work-task.attachment-too-large");
        const bytes = new Uint8Array(stat.size);
        for (let offset = 0; offset < bytes.length; ) {
          const length = Math.min(384 * 1024, bytes.length - offset);
          const chunk = await this.files.readFileRange({
            path: attachment.localPath,
            offset,
            length,
          });
          if (!current()) return entry.state;
          if (!(chunk instanceof Uint8Array) || !chunk.length || chunk.length > length)
            throw new Error("work-task.attachment-size-mismatch");
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        url = this.environment.createObjectURL(new Blob([bytes], { type: attachment.mimeType }));
        entry.ownedUrl = url;
      }
      if (attachment.mimeType.startsWith("image/")) await this.environment.decodeImage(url);
      if (!current()) return entry.state;
      entry.state = { url };
    } catch {
      if (!current()) return entry.state;
      this.release(entry);
      entry.state = { error: true };
    }
    this.changed();
    return entry.state;
  }
}
