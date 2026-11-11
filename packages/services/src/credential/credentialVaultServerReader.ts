import type { CredentialVaultEnvironment } from "./credential.js";

export interface CredentialVaultServerReference {
  name: string;
  environment: CredentialVaultEnvironment;
  host: string;
  port: number | null;
  username: string | null;
}

export interface CredentialVaultServerReader {
  listServers(workspaceIdentity: string): Promise<CredentialVaultServerReference[]>;
}
