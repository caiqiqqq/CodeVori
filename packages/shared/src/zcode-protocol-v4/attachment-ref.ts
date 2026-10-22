import { z } from "zod";

/** 已提交引用与展示元信息；inode/directory 表示 Host 目录引用，artifact 正文仅为绝对路径。 */
export const attachmentRefSchema = z
  .object({
    ref: z.string(),
    fileName: z.string(),
    mime: z.string(),
    bytes: z.number(),
    previewRef: z.string().optional(),
  })
  .strict();

export type AttachmentRef = z.infer<typeof attachmentRefSchema>;
