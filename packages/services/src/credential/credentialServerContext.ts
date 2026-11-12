import type { CredentialVaultServerReference } from "./credentialVaultServerReader.js";

export function credentialServerPromptContext(
  serverEntries: readonly CredentialVaultServerReference[],
): string {
  return [
    "SSH server connection details available to this workspace (credentials are not included):",
    ...serverEntries.map(
      ({ name, environment, host, port, username }) =>
        `- ${name} (${environment}); ${username ?? "username missing"}@${host}:${port ?? 22}`,
    ),
  ].join("\n");
}
