import { createHash, randomUUID, type Hash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rmdir,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  resolveWorkspaceKey,
  type WorkTaskAttachment,
  type WorkTaskAttachmentBegin,
  type WorkTaskAttachmentChunk,
  type WorkTaskAttachmentImport,
  type WorkTaskAttachmentTarget,
  type WorkTaskScope,
} from "@zcode/shared";
import { PROTOCOL_V4_LIMITS, type V4AttachmentBeginResult } from "@zcode/shared/zcode-protocol-v4";

interface Upload {
  input: WorkTaskAttachmentBegin;
  directory: string;
  file: FileHandle | null;
  hash: Hash;
  chunks: string[];
  bytes: number;
  ref?: string;
}

/** Host-owned immutable snapshots; deliberately independent of any Agent session. */
export class WorkTaskAttachmentStore {
  private readonly uploads = new Map<string, Upload>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private readonly imports = new Set<Promise<WorkTaskAttachment>>();
  private closed = false;
  constructor(private readonly root: string) {}

  private key(input: WorkTaskAttachmentTarget) {
    return JSON.stringify([resolveWorkspaceKey(input), input.uploadId]);
  }
  private scopeDirectory(scope: WorkTaskScope) {
    const hash = createHash("sha256").update(resolveWorkspaceKey(scope)).digest("hex");
    return join(this.root, hash);
  }
  private serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("work-task.host-closed"));
    const operation = (this.operations.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
    this.operations.set(key, operation);
    void operation
      .finally(() => {
        if (this.operations.get(key) === operation) this.operations.delete(key);
      })
      .catch(() => {});
    return operation;
  }
  private upload(input: WorkTaskAttachmentTarget) {
    const upload = this.uploads.get(this.key(input));
    if (!upload) throw new Error("work-task.attachment-upload-not-found");
    return upload;
  }
  async begin(input: WorkTaskAttachmentBegin): Promise<V4AttachmentBeginResult> {
    return this.serial(this.key(input), async () => {
      const previous = this.uploads.get(this.key(input));
      if (previous) {
        if (!isDeepStrictEqual(previous.input, input))
          throw new Error("work-task.attachment-upload-conflict");
        return {
          uploadId: input.uploadId,
          nextChunkIndex: previous.chunks.length,
          ...(previous.ref
            ? { state: "committed" as const, ref: previous.ref }
            : { state: "staging" as const }),
        };
      }
      // 附件只在保存时上传；约束并行草稿占用，不依赖 Agent 或虚构 sessionId。
      if ([...this.uploads.values()].filter((upload) => !upload.ref).length >= 32)
        throw new Error("work-task.attachment-upload-limit");
      await mkdir(this.root, { recursive: true });
      const directory = await mkdtemp(join(this.root, ".upload-"));
      const file = await open(join(directory, "content"), "wx", 0o600).catch(async (error) => {
        await rmdir(directory);
        throw error;
      });
      this.uploads.set(this.key(input), {
        input,
        directory,
        file,
        hash: createHash("sha256"),
        chunks: [],
        bytes: 0,
      });
      return { uploadId: input.uploadId, state: "staging", nextChunkIndex: 0 };
    });
  }
  async chunk(input: WorkTaskAttachmentChunk) {
    return this.serial(this.key(input), async () => {
      const upload = this.upload(input);
      const bytes = Buffer.from(input.dataBase64, "base64");
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (input.chunkIndex < upload.chunks.length && upload.chunks[input.chunkIndex] === hash)
        return { uploadId: input.uploadId, nextChunkIndex: upload.chunks.length };
      if (
        upload.ref ||
        !upload.file ||
        input.chunkIndex !== upload.chunks.length ||
        input.chunkIndex >= upload.input.totalChunks
      )
        throw new Error("work-task.attachment-chunk-order");
      if (!bytes.length || upload.bytes + bytes.length > upload.input.totalBytes)
        throw new Error("work-task.attachment-size-mismatch");
      await upload.file.writeFile(bytes);
      upload.hash.update(bytes);
      upload.chunks.push(hash);
      upload.bytes += bytes.length;
      return { uploadId: input.uploadId, nextChunkIndex: upload.chunks.length };
    });
  }
  private async discard(upload: Upload) {
    await upload.file?.close();
    upload.file = null;
    await unlink(join(upload.directory, "content")).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rmdir(upload.directory).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  async commit(input: WorkTaskAttachmentTarget) {
    return this.serial(this.key(input), async () => {
      const upload = this.upload(input);
      if (upload.ref) return { ref: upload.ref };
      if (
        upload.bytes !== upload.input.totalBytes ||
        upload.chunks.length !== upload.input.totalChunks
      )
        throw new Error("work-task.attachment-size-mismatch");
      const digest = upload.hash.copy().digest("hex");
      if (`sha256:${digest}` !== upload.input.checksum)
        throw new Error("work-task.attachment-checksum");
      await upload.file!.sync();
      await upload.file!.close();
      upload.file = null;
      const directory = this.scopeDirectory(input);
      await mkdir(directory, { recursive: true });
      // 文件名保留扩展名并兼容 Windows；原名称仍留在元信息，路径不会由用户文件名决定目录。
      const name = basename(upload.input.fileName.replaceAll("\\", "/")).replace(
        /[<>:"/\\|?*\p{Cc}]/gu,
        "_",
      );
      const extension = extname(name).slice(0, 24);
      const boundedStem =
        Buffer.from(basename(name, extname(name)))
          .subarray(0, 160 - Buffer.byteLength(extension))
          .toString()
          .replace(/[. ]+$/, "") || "attachment";
      const boundedName = `${boundedStem}${extension}`;
      const ref = join(directory, `${digest}-${boundedName}`);
      try {
        await rename(join(upload.directory, "content"), ref);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await unlink(join(upload.directory, "content"));
      }
      await rmdir(upload.directory);
      upload.ref = ref;
      // 多文件保存期间仍须确认已提交分片；仅淘汰较旧的完成记录，不丢当前 ACK。
      const completed = [...this.uploads.entries()].filter(([, item]) => item.ref);
      for (const [key] of completed.slice(0, -128)) this.uploads.delete(key);
      return { ref };
    });
  }
  async abort(input: WorkTaskAttachmentTarget) {
    return this.serial(this.key(input), async () => {
      const key = this.key(input);
      const upload = this.uploads.get(key);
      if (!upload || upload.ref) return;
      await this.discard(upload);
      this.uploads.delete(key);
    });
  }
  importFile(input: WorkTaskAttachmentImport): Promise<WorkTaskAttachment> {
    if (this.closed) return Promise.reject(new Error("work-task.host-closed"));
    const operation = this.importFileContent(input);
    this.imports.add(operation);
    void operation.finally(() => this.imports.delete(operation)).catch(() => {});
    return operation;
  }
  private async importFileContent(input: WorkTaskAttachmentImport): Promise<WorkTaskAttachment> {
    const source = await open(input.localPath, "r");
    let target: WorkTaskAttachmentTarget | undefined;
    try {
      const stat = await source.stat();
      if (!stat.isFile()) throw new Error("work-task.attachment-not-file");
      if (stat.size > PROTOCOL_V4_LIMITS.attachmentMaxBytes)
        throw new Error("work-task.attachment-too-large");
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await source.read(bytes, offset, bytes.length - offset, offset);
        if (!result.bytesRead) throw new Error("work-task.attachment-size-mismatch");
        offset += result.bytesRead;
      }
      if ((await source.stat()).size !== bytes.length)
        throw new Error("work-task.attachment-size-mismatch");
      target = { workspacePath: input.workspacePath, uploadId: `file-${randomUUID()}` };
      const chunkSize = 384 * 1024;
      await this.begin({
        ...target,
        fileName: input.fileName,
        mime: input.mime,
        totalBytes: bytes.length,
        totalChunks: Math.ceil(bytes.length / chunkSize),
        checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      });
      for (let start = 0, chunkIndex = 0; start < bytes.length; start += chunkSize, chunkIndex++) {
        await this.chunk({
          ...target,
          chunkIndex,
          dataBase64: bytes.subarray(start, start + chunkSize).toString("base64"),
        });
      }
      return {
        ...(await this.commit(target)),
        fileName: input.fileName,
        mime: input.mime,
        bytes: bytes.length,
      };
    } catch (error) {
      // 关闭时由 dispose 等待导入并清理；不能让 abort 的 closed 错误覆盖原失败。
      if (target && !this.closed) await this.abort(target);
      throw error;
    } finally {
      await source.close();
    }
  }
  async validate(scope: WorkTaskScope, attachments: readonly WorkTaskAttachment[]) {
    for (const attachment of attachments) {
      const directory = this.scopeDirectory(scope);
      if (dirname(resolve(attachment.ref)) !== resolve(directory))
        throw new Error("work-task.attachment-scope");
      const stat = await lstat(attachment.ref);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        dirname(await realpath(attachment.ref)) !== (await realpath(directory))
      )
        throw new Error("work-task.attachment-scope");
      if (stat.size !== attachment.bytes) throw new Error("work-task.attachment-size-mismatch");
    }
  }
  async dispose() {
    this.closed = true;
    await Promise.allSettled(this.imports);
    await Promise.allSettled(this.operations.values());
    for (const upload of this.uploads.values()) if (!upload.ref) await this.discard(upload);
    this.uploads.clear();
  }
}
