import { useCallback } from "react";
import type {
  ProjectEnvironmentScope,
  ProjectEnvironmentSession,
  SaveProjectEnvironment,
  SetSessionEnvironment,
} from "@zcode/shared";
import type { SaveCredentialVaultEntryInput } from "@zcode/services";
import { useServices } from "./useServices.js";

export function useCredentialVault() {
  const { credentialService } = useServices();
  const list = useCallback(() => {
    if (!credentialService.listVaultEntries) {
      throw new Error("Credential vault is not available on this Host");
    }
    return credentialService.listVaultEntries();
  }, [credentialService]);
  const save = useCallback(
    (input: SaveCredentialVaultEntryInput) => {
      if (!credentialService.saveVaultEntry) {
        throw new Error("Credential vault is not available on this Host");
      }
      return credentialService.saveVaultEntry(input);
    },
    [credentialService],
  );
  const remove = useCallback(
    (id: string) => {
      if (!credentialService.deleteVaultEntry) {
        throw new Error("Credential vault is not available on this Host");
      }
      return credentialService.deleteVaultEntry(id);
    },
    [credentialService],
  );
  const listEnvironments = useCallback(
    (scope: ProjectEnvironmentScope) => {
      if (!credentialService.listProjectEnvironments) {
        throw new Error("Project environments are not available on this Host");
      }
      return credentialService.listProjectEnvironments(scope);
    },
    [credentialService],
  );
  const saveEnvironment = useCallback(
    (input: SaveProjectEnvironment) => {
      if (!credentialService.saveProjectEnvironment) {
        throw new Error("Project environments are not available on this Host");
      }
      return credentialService.saveProjectEnvironment(input);
    },
    [credentialService],
  );
  const deleteEnvironment = useCallback(
    (input: ProjectEnvironmentScope & { id: string; expectedRevision: number }) => {
      if (!credentialService.deleteProjectEnvironment) {
        throw new Error("Project environments are not available on this Host");
      }
      return credentialService.deleteProjectEnvironment(input);
    },
    [credentialService],
  );
  const getSessionEnvironment = useCallback(
    (scope: ProjectEnvironmentSession) => {
      if (!credentialService.getSessionEnvironment) {
        throw new Error("Project environments are not available on this Host");
      }
      return credentialService.getSessionEnvironment(scope);
    },
    [credentialService],
  );
  const setSessionEnvironment = useCallback(
    (input: SetSessionEnvironment) => {
      if (!credentialService.setSessionEnvironment) {
        throw new Error("Project environments are not available on this Host");
      }
      return credentialService.setSessionEnvironment(input);
    },
    [credentialService],
  );
  const onEnvironmentsChanged = useCallback(
    (scope: ProjectEnvironmentScope, listener: () => void) => {
      if (!credentialService.onDynamicProjectEnvironmentsChanged) {
        throw new Error("Project environments are not available on this Host");
      }
      return credentialService.onDynamicProjectEnvironmentsChanged(scope)(listener);
    },
    [credentialService],
  );
  const environmentsAvailable = Boolean(
    credentialService.listProjectEnvironments &&
    credentialService.saveProjectEnvironment &&
    credentialService.deleteProjectEnvironment &&
    credentialService.getSessionEnvironment &&
    credentialService.setSessionEnvironment,
  );
  return {
    list,
    save,
    remove,
    listEnvironments,
    saveEnvironment,
    deleteEnvironment,
    getSessionEnvironment,
    setSessionEnvironment,
    onEnvironmentsChanged,
    environmentsAvailable,
  };
}
