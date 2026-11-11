import type { CredentialVaultServerReference } from "./credentialVaultHostAccess.js";

export interface CredentialReference {
  alias: string;
  label: string;
  purpose: string;
  storedCredentialCount: number;
}

export interface CredentialReferenceSnapshot {
  references: CredentialReference[];
  otherStoredCredentialCount: number;
}

export interface CredentialReferenceReader {
  list(): Promise<CredentialReferenceSnapshot>;
}

const OAUTH_PROVIDERS = [
  {
    id: "zai",
    alias: "zai-oauth",
    label: "Z.ai account",
    purpose: "Authenticated Z.ai account and coding-plan operations.",
  },
  {
    id: "bigmodel",
    alias: "bigmodel-oauth",
    label: "BigModel account",
    purpose: "Authenticated BigModel account and coding-plan operations.",
  },
] as const;

const ACCOUNT_REFERENCE: Omit<CredentialReference, "storedCredentialCount"> = {
  alias: "codevori-account",
  label: "CodeVori account",
  purpose: "CodeVori account-authenticated features.",
};

const ACCOUNT_PROVIDER_REFERENCE: Omit<CredentialReference, "storedCredentialCount"> = {
  alias: "account-provider-api-keys",
  label: "Account Provider API keys",
  purpose: "Requests to configured account providers.",
};

const SSH_REFERENCE: Omit<CredentialReference, "storedCredentialCount"> = {
  alias: "ssh-workspace-credentials",
  label: "SSH workspace credentials",
  purpose: "Connecting to SSH workspaces using a password or private-key passphrase.",
};

const BOT_REFERENCE: Omit<CredentialReference, "storedCredentialCount"> = {
  alias: "bot-integration-credentials",
  label: "Bot integration credentials",
  purpose: "Host-managed bot and webhook integrations.",
};

/** Project storage key names into an allowlisted, non-secret summary for ACP. */
export function projectCredentialReferences(keys: readonly string[]): CredentialReferenceSnapshot {
  const counts = new Map<string, number>();
  const oauthCounts = new Map<(typeof OAUTH_PROVIDERS)[number]["id"], number>();
  let otherStoredCredentialCount = 0;

  for (const key of keys) {
    const oauthProvider = OAUTH_PROVIDERS.find(
      ({ id }) => key === `oauth:${id}:access_token` || key === `oauth:${id}:refresh_token`,
    );
    if (oauthProvider) {
      oauthCounts.set(oauthProvider.id, 1);
    } else if (key === "zcodejwttoken" || key === "auth_token") {
      counts.set(ACCOUNT_REFERENCE.alias, 1);
    } else if (/^account-provider:.+:api-key$/.test(key)) {
      counts.set(
        ACCOUNT_PROVIDER_REFERENCE.alias,
        (counts.get(ACCOUNT_PROVIDER_REFERENCE.alias) ?? 0) + 1,
      );
    } else if (/^remote-workspace:.+:(?:password|private-key-passphrase)$/.test(key)) {
      counts.set(SSH_REFERENCE.alias, (counts.get(SSH_REFERENCE.alias) ?? 0) + 1);
    } else if (/^bot:.+:(?:credential|webhook-secret)$/.test(key)) {
      counts.set(BOT_REFERENCE.alias, (counts.get(BOT_REFERENCE.alias) ?? 0) + 1);
    } else {
      otherStoredCredentialCount++;
    }
  }

  const references: CredentialReference[] = OAUTH_PROVIDERS.flatMap((provider) => {
    const storedCredentialCount = oauthCounts.get(provider.id) ?? 0;
    return storedCredentialCount
      ? [
          {
            alias: provider.alias,
            label: provider.label,
            purpose: provider.purpose,
            storedCredentialCount,
          },
        ]
      : [];
  });
  for (const reference of [
    ACCOUNT_REFERENCE,
    ACCOUNT_PROVIDER_REFERENCE,
    SSH_REFERENCE,
    BOT_REFERENCE,
  ]) {
    const storedCredentialCount = counts.get(reference.alias) ?? 0;
    if (storedCredentialCount) references.push({ ...reference, storedCredentialCount });
  }

  return { references, otherStoredCredentialCount };
}

export function credentialReferencePromptContext(
  snapshot: CredentialReferenceSnapshot,
  serverEntries: readonly CredentialVaultServerReference[] = [],
): string {
  const referenceLines = snapshot.references.map(
    ({ alias, label, purpose, storedCredentialCount }) =>
      `- ${alias}: ${label}; ${purpose} (${storedCredentialCount} stored reference${storedCredentialCount === 1 ? "" : "s"})`,
  );
  if (snapshot.otherStoredCredentialCount)
    referenceLines.push(
      `- Other Host credentials: ${snapshot.otherStoredCredentialCount} stored reference${snapshot.otherStoredCredentialCount === 1 ? "" : "s"}; details are intentionally hidden.`,
    );
  if (!referenceLines.length)
    referenceLines.push("- No known Host credential references are currently stored.");

  const context = [
    "Host credential references (metadata only; presence does not guarantee validity):",
    ...referenceLines,
    "The selected Host resolves values internally only for compatible integrations. Ask the Host to perform the corresponding authenticated operation; do not request or expose credential values.",
  ];
  if (serverEntries.length) {
    context.push(
      "Saved SSH server credentials are available through RunCredentialedServerCommand. Each remote command requires user approval; the Host supplies the password internally.",
      ...serverEntries.map(
        ({ id, name, environment, host, port, username }) =>
          `- serverId=${id}; ${name} (${environment}); ${username ?? "username missing"}@${host}:${port ?? 22}`,
      ),
      "Do not ask the user to paste the saved password or include it in command text.",
    );
  }
  return context.join("\n");
}
