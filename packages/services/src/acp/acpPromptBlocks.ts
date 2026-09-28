import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { ContentBlock, PromptCapabilities } from "@agentclientprotocol/sdk";
import type { AcpPromptAttachment } from "@zcode/shared";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_INLINE_BYTES = 40 * 1024 * 1024;

function decodeBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("ACP attachment has invalid base64 content");
  }
  if (value.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4) {
    throw new Error("ACP attachment exceeds 20 MiB");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("ACP attachment exceeds 20 MiB");
  return bytes;
}

/** All filesystem access happens on the selected Host; workspace mentions cannot escape its root. */
export async function buildAcpPromptBlocks(input: {
  text: string;
  workspacePath: string;
  workspaceFiles: readonly string[];
  attachments: readonly AcpPromptAttachment[];
  capabilities?: PromptCapabilities;
}): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [{ type: "text", text: input.text }];
  const root = input.workspaceFiles.length ? await realpath(input.workspacePath) : null;
  for (const file of input.workspaceFiles) {
    if (isAbsolute(file)) throw new Error("ACP workspace file must use a relative path");
    if (!root) throw new Error("ACP workspace root is unavailable");
    const path = await realpath(resolve(root, file));
    const within = relative(root, path);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within) || !within) {
      throw new Error("ACP workspace file is outside the selected workspace");
    }
    const details = await stat(path);
    if (!details.isFile() && !details.isDirectory()) {
      throw new Error("ACP workspace reference must be a file or directory");
    }
    blocks.push({ type: "resource_link", uri: pathToFileURL(path).href, name: basename(path) });
  }
  let inlineBytes = 0;
  for (const attachment of input.attachments) {
    let bytes: Buffer | undefined;
    let path: string | undefined;
    if (attachment.path) {
      if (!isAbsolute(attachment.path)) throw new Error("ACP attachment path must be absolute");
      path = await realpath(attachment.path);
      const details = await stat(path);
      if (!details.isFile()) throw new Error("ACP attachment must be a file");
      if (details.size > MAX_ATTACHMENT_BYTES) throw new Error("ACP attachment exceeds 20 MiB");
      if (attachment.mimeType.startsWith("image/")) {
        if (!input.capabilities?.image) throw new Error("This ACP Agent does not accept images");
        bytes = await readFile(path);
      }
    } else if (attachment.dataBase64) {
      bytes = decodeBase64(attachment.dataBase64);
    }
    if (attachment.mimeType.startsWith("image/")) {
      if (!input.capabilities?.image) throw new Error("This ACP Agent does not accept images");
      if (!bytes) throw new Error("ACP image has no content");
      inlineBytes += bytes.length;
      blocks.push({
        type: "image",
        data: bytes.toString("base64"),
        mimeType: attachment.mimeType,
        ...(path ? { uri: pathToFileURL(path).href } : {}),
      });
    } else if (path) {
      blocks.push({
        type: "resource_link",
        name: attachment.fileName,
        uri: pathToFileURL(path).href,
      });
    } else if (bytes) {
      if (!input.capabilities?.embeddedContext) {
        throw new Error("This ACP Agent does not accept embedded files");
      }
      inlineBytes += bytes.length;
      blocks.push({
        type: "resource",
        resource: {
          uri: `zcode-attachment:///${encodeURIComponent(attachment.fileName)}`,
          mimeType: attachment.mimeType,
          blob: bytes.toString("base64"),
        },
      });
    } else {
      throw new Error("ACP attachment has no readable content");
    }
    if (inlineBytes > MAX_TOTAL_INLINE_BYTES) throw new Error("ACP prompt content exceeds 40 MiB");
  }
  return blocks;
}
