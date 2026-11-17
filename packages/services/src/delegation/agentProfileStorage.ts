import type { DatabaseSync } from "node:sqlite";
import {
  agentProfileSchema,
  agentSquadSchema,
  agentSquadDefinitionSchema,
  uuidv7,
  type AgentProfile,
  type AgentSquad,
  type AgentSquadDefinition,
} from "@zcode/shared";

export function resolveAgentSquad(
  definition: AgentSquadDefinition,
  profiles: AgentProfile[],
): AgentSquad {
  const resolve = (member: AgentSquadDefinition["leader"]) => {
    const profile = profiles.find((profile) => profile.id === member.agentId);
    if (!profile) throw new Error("delegation.profile-not-found");
    return {
      ...member,
      name: profile.name,
      instructions: profile.instructions,
      execution: profile.execution,
    };
  };
  return {
    ...definition,
    leader: resolve(definition.leader),
    members: definition.members.map(resolve),
  };
}

export function migrateAgentProfiles(db: DatabaseSync) {
  // 修复原因：旧小队只有内嵌角色；在同一事务内迁移成独立智能体和引用，重启不重复创建。
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare("SELECT id,data FROM delegation_squads").all() as {
      id: string;
      data: string;
    }[];
    for (const row of rows) {
      const raw: unknown = JSON.parse(row.data);
      if (agentSquadDefinitionSchema.safeParse(raw).success) continue;
      const old = agentSquadSchema.parse(raw);
      const migrate = (member: AgentSquad["leader"]) => {
        const profile = agentProfileSchema.parse({
          id: uuidv7(),
          name: member.name,
          description: "",
          instructions: member.instructions || member.role,
          execution: member.execution,
          revision: 1,
          createdAt: old.createdAt,
          updatedAt: old.updatedAt,
        });
        db.prepare("INSERT INTO delegation_agent_profiles(id,data) VALUES(?,?)").run(
          profile.id,
          JSON.stringify(profile),
        );
        return { id: member.id, agentId: profile.id, role: member.role };
      };
      const definition = agentSquadDefinitionSchema.parse({
        ...old,
        leader: migrate(old.leader),
        members: old.members.map(migrate),
      });
      db.prepare("UPDATE delegation_squads SET data=? WHERE id=?").run(
        JSON.stringify(definition),
        row.id,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
