import { z } from "zod";
import { workTaskExecutionSchema } from "./work-task.js";

export const agentSquadMemberSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    role: z.string().trim().min(1).max(4000),
    agentId: z.string().uuid().optional(),
    instructions: z.string().max(12000).optional(),
    execution: z.discriminatedUnion("kind", [
      workTaskExecutionSchema.options[0],
      workTaskExecutionSchema.options[1].omit({ modelPreference: true }),
    ]),
  })
  .strict();
export type AgentSquadMember = z.infer<typeof agentSquadMemberSchema>;
const squadFields = {
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000),
  instructions: z.string().trim().max(12000),
  leader: agentSquadMemberSchema,
  members: z
    .array(agentSquadMemberSchema)
    .min(1)
    .max(8)
    .refine(
      (members) => new Set(members.map((member) => member.id)).size === members.length,
      "Squad member IDs must be unique",
    ),
};
export const agentSquadSchema = z
  .object({
    ...squadFields,
    revision: z.number().int().positive(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict()
  .refine(
    (squad) => !squad.members.some((member) => member.id === squad.leader.id),
    "Leader and member IDs must differ",
  );
export type AgentSquad = z.infer<typeof agentSquadSchema>;
const memberReferenceSchema = z
  .object({
    id: z.string().uuid(),
    agentId: z.string().uuid(),
    role: z.string().trim().min(1).max(4000),
  })
  .strict();
const referenceFields = {
  ...squadFields,
  leader: memberReferenceSchema,
  members: z.array(memberReferenceSchema).min(1).max(8),
};
function uniqueReferences(squad: {
  leader: { id: string; agentId: string };
  members: { id: string; agentId: string }[];
}) {
  const roles = [squad.leader, ...squad.members];
  return (
    new Set(roles.map((role) => role.id)).size === roles.length &&
    new Set(roles.map((role) => role.agentId)).size === roles.length
  );
}
export const agentSquadDefinitionSchema = z
  .object({
    ...referenceFields,
    revision: z.number().int().positive(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict()
  .refine(uniqueReferences, "Squad agents and role IDs must be unique");
export type AgentSquadDefinition = z.infer<typeof agentSquadDefinitionSchema>;
export const agentSquadSaveSchema = z
  .object({
    ...referenceFields,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(uniqueReferences, "Squad agents and role IDs must be unique");
export type AgentSquadSave = z.infer<typeof agentSquadSaveSchema>;
export const agentSquadDeleteSchema = z
  .object({
    id: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type AgentSquadDelete = z.infer<typeof agentSquadDeleteSchema>;
export const delegationSquadContextSchema = z.discriminatedUnion("role", [
  z
    .object({
      role: z.literal("leader"),
      definition: agentSquadSchema,
      memberIntent: z.enum(["analysis", "edit"]),
    })
    .strict(),
  z
    .object({
      role: z.literal("member"),
      squadId: z.string().uuid(),
      squadName: z.string(),
      memberId: z.string().uuid(),
      name: z.string(),
      instructions: z.string(),
    })
    .strict(),
]);
export type DelegationSquadContext = z.infer<typeof delegationSquadContextSchema>;
