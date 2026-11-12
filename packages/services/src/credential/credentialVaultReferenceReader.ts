import type { CredentialVaultEnvironment, CredentialVaultKind } from "./credential.js";

export interface CredentialVaultReference {
  id: string;
  name: string;
  kind: CredentialVaultKind;
  environment: CredentialVaultEnvironment;
  host: string;
  port: number | null;
  username: string | null;
}

export interface CredentialVaultSecret extends CredentialVaultReference {
  secret: string;
}

export interface CredentialVaultReferenceReader {
  listReferences(workspaceIdentity: string): Promise<CredentialVaultReference[]>;
  /** Host 调用方完成本次读取授权后，才允许解密指定的凭证。 */
  readSecret(
    workspaceIdentity: string,
    reference: CredentialVaultReference,
    assertCurrent: () => void,
  ): Promise<CredentialVaultSecret>;
}
