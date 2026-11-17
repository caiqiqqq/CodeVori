import type {
  ProjectEnvironmentScope,
  SaveProjectEnvironment,
  SetSessionEnvironment,
} from "@zcode/shared";
import type { ProjectEnvironmentService } from "./projectEnvironment.js";

export async function projectEnvironmentContractExample(
  service: ProjectEnvironmentService,
  scope: ProjectEnvironmentScope,
  profile: SaveProjectEnvironment,
  selection: SetSessionEnvironment,
) {
  const profiles = await service.listProjectEnvironments(scope);
  const saved = await service.saveProjectEnvironment(profile);
  const selected = await service.setSessionEnvironment(selection);
  const subscription = service.onDynamicProjectEnvironmentsChanged(scope)(async () => {
    await service.listProjectEnvironments(scope);
  });
  subscription.dispose();
  return { profiles, saved, selected };
}
