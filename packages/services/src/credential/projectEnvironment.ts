import type { Event } from "@zcode/rpc";
import type {
  ProjectEnvironment,
  ProjectEnvironmentScope,
  ProjectEnvironmentSession,
  ResolvedProjectEnvironment,
  SaveProjectEnvironment,
  SessionEnvironment,
  SetSessionEnvironment,
} from "@zcode/shared";

/** Host 环境元数据所有者；UI 和会话能力都只通过此接口访问。 */
export interface ProjectEnvironmentService {
  listProjectEnvironments(scope: ProjectEnvironmentScope): Promise<ProjectEnvironment[]>;
  saveProjectEnvironment(input: SaveProjectEnvironment): Promise<ProjectEnvironment>;
  deleteProjectEnvironment(
    input: ProjectEnvironmentScope & { id: string; expectedRevision: number },
  ): Promise<void>;
  readProjectEnvironment(
    input: ProjectEnvironmentScope & { id: string },
  ): Promise<ResolvedProjectEnvironment>;
  getSessionEnvironment(scope: ProjectEnvironmentSession): Promise<SessionEnvironment>;
  setSessionEnvironment(input: SetSessionEnvironment): Promise<SessionEnvironment>;
  onDynamicProjectEnvironmentsChanged(scope: ProjectEnvironmentScope): Event<void>;
}
