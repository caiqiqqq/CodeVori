import { uuidv7, type AgentSquadSave, type AgentSquadMember } from "@zcode/shared";
import type { AgentDelegationService } from "../src/delegation/agentDelegationService.js";

/** 显式先创建智能体，再构造小队引用；旧角色数据仅用作测试输入。 */
export async function saveSquadFixture(
  service: AgentDelegationService,
  draft: Omit<AgentSquadSave, "leader" | "members"> & {
    leader: AgentSquadMember;
    members: AgentSquadMember[];
  },
) {
  const existing = (await service.listSquads()).find((squad) => squad.id === draft.id);
  const reference = async (member: AgentSquadMember) => {
    const saved = [existing?.leader, ...(existing?.members ?? [])].find(
      (role) => role?.id === member.id,
    );
    const profile = saved?.agentId
      ? undefined
      : await service.saveAgentProfile({
          id: uuidv7(),
          expectedRevision: 0,
          name: member.name,
          description: "",
          instructions: member.role,
          execution: member.execution,
        });
    return { id: member.id, agentId: saved?.agentId ?? profile!.id, role: member.role };
  };
  return service.saveSquad({
    ...draft,
    leader: await reference(draft.leader),
    members: await Promise.all(draft.members.map(reference)),
  });
}
