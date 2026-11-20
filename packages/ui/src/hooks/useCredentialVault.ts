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
  const list = useCallback(
    (workspaceIdentity: string) => {
      if (!credentialService.listVaultEntries) {
        throw new Error("Credential vault is not available on this Host");
      }
      return credentialService.listVaultEntries(workspaceIdentity);
    },
    [credentialService],
  );
  const listUnassigned = useCallback(() => {
    if (!credentialService.listUnassignedVaultEntries) {
      throw new Error("Credential vault is not available on this Host");
    }
    return credentialService.listUnassignedVaultEntries();
  }, [credentialService]);
  const listGlobal = useCallback(() => {
    if (!credentialService.listGlobalVaultEntries) {
      throw new Error("Credential vault is not available on this Host");
    }
    return credentialService.listGlobalVaultEntries();
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
    (id: string, scope: "unassigned" | "global" | "project", workspaceIdentity: string | null) => {
      if (!credentialService.deleteVaultEntry) {
        throw new Error("Credential vault is not available on this Host");
      }
      return credentialService.deleteVaultEntry(id, scope, workspaceIdentity);
    },
    [credentialService],
  );
  const attach = useCallback(
    (id: string, workspaceIdentity: string) => {
      if (!credentialService.attachVaultEntry) {
        throw new Error("Credential vault is not available on this Host");
      }
      return credentialService.attachVaultEntry(id, workspaceIdentity);
    },
    [credentialService],
  );
  const attachGlobal = useCallback(
    (id: string) => {
      if (!credentialService.attachVaultEntryGlobally) {
        throw new Error("Credential vault is not available on this Host");
      }
      return credentialService.attachVaultEntryGlobally(id);
    },
    [credentialService],
  );
  const detach = useCallback(
    (id: string, workspaceIdentity: string) => {
      if (!credentialService.detachVaultEntry) {
        throw new Error("Credential vault is not available on this Host");
      }
      return credentialService.detachVaultEntry(id, workspaceIdentity);
    },
    [credentialService],
  );
  const detachGlobal = useCallback(
    (id: string) => {
      if (!credentialService.detachGlobalVaultEntry) {
        throw new Error("Credential vault is not available on this Host");
      }
      return credentialService.detachGlobalVaultEntry(id);
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
    listUnassigned,
    listGlobal,
    save,
    remove,
    attach,
    attachGlobal,
    detach,
    detachGlobal,
    listEnvironments,
    saveEnvironment,
    deleteEnvironment,
    getSessionEnvironment,
    setSessionEnvironment,
    onEnvironmentsChanged,
    environmentsAvailable,
  };
}
