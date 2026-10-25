import type { IComposerPreferenceService } from "./contract.js";

export async function readNewTaskPreference(service: IComposerPreferenceService) {
  return service.get({ workspacePath: "/example/project", workspaceIdentity: "example:project" });
}
