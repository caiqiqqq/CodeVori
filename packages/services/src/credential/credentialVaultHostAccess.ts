import type { CredentialVaultEnvironment } from "./credential.js";

export interface CredentialVaultServerReference {
  id: string;
  name: string;
  environment: CredentialVaultEnvironment;
  host: string;
  port: number | null;
  username: string | null;
}

export interface CredentialVaultSshCommandInput {
  host: string;
  port: number;
  username: string;
  password: string;
  command: string;
}

export interface CredentialVaultSshCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  outputTruncated?: boolean;
}

export type CredentialVaultSshCommandExecutor = (
  input: CredentialVaultSshCommandInput,
) => Promise<CredentialVaultSshCommandResult>;

export interface CredentialVaultHostAccess {
  listServers(workspaceIdentity: string): Promise<CredentialVaultServerReference[]>;
  executeCommand(
    server: CredentialVaultServerReference,
    workspaceIdentity: string,
    command: string,
    assertAuthorized: () => void,
  ): Promise<CredentialVaultSshCommandResult>;
}
