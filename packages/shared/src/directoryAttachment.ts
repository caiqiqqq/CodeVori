/** Directory references carry a Host path, never an archive or recursive contents. */
export const DIRECTORY_ATTACHMENT_MIME = "inode/directory";

export function buildDirectoryAttachmentText(path: string): string {
  return [
    `Attached directory: ${path}`,
    "This is a directory reference on the selected Host; its contents have not been read or uploaded.",
    "Use the available filesystem or command tools to browse this directory and read relevant files on demand.",
  ].join("\n");
}
