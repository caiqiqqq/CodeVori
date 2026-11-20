import { useCallback } from "react";
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
    (id: string, workspaceIdentity: string) => {
      if (!credentialService.deleteVaultEntry) {
        throw new Error("Credential vault is not available on this Host");
      }
      return credentialService.deleteVaultEntry(id, workspaceIdentity);
    },
    [credentialService],
  );
  return { list, save, remove };
}
