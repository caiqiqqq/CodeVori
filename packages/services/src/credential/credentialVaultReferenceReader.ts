import type { CredentialVaultEnvironment, CredentialVaultKind } from "./credential.js";

export interface CredentialVaultReference {
  name: string;
  kind: CredentialVaultKind;
  environment: CredentialVaultEnvironment;
  host: string;
  port: number | null;
  username: string | null;
}

export interface CredentialVaultReferenceReader {
  listReferences(workspaceIdentity: string): Promise<CredentialVaultReference[]>;
}
