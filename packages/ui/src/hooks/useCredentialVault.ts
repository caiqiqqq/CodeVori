import { useCallback } from "react";
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
  return { list, save, remove };
}
