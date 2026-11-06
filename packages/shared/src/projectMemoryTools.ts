import { z } from "zod";

const name = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);
export const readProjectMemoryInputSchema = z.object({ name: name.optional() }).strict();
export const saveProjectMemoryInputSchema = z
  .object({
    name,
    description: z.string().trim().min(1).max(160),
    type: z.enum(["user", "feedback", "project", "reference"]),
    content: z.string().trim().min(1).max(4000),
    expectedRevision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();

export interface ProjectMemorySaveReceipt {
  status: "saved";
  workspaceId: string;
  fileName: string;
  revision: string;
}

/** Both native tools and ACP MCP advertise exactly this project-bound contract. */
export const projectMemoryTools = [
  {
    name: "ReadProjectMemory",
    description:
      "Read CodeVori project memory and its revision. Omit name to read the index; read an existing item before updating it. Scope is bound to this session.",
    inputSchema: z.toJSONSchema(readProjectMemoryInputSchema),
  },
  {
    name: "SaveProjectMemory",
    description:
      "Save one durable, non-secret fact to CodeVori project memory and update its index. Reuse an existing name; pass its read revision, or null to create. Only status=saved confirms project persistence visible in Settings and future sessions. Native agent memory notes are separate.",
    inputSchema: z.toJSONSchema(saveProjectMemoryInputSchema),
  },
] as const;
