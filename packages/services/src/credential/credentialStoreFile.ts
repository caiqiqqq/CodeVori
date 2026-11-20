import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { credentialRecordSchema, formatZodError } from "@zcode/shared";
import { atomicWritePrivateTextFile, backupCorruptFile, withFileLock } from "@zcode/shared/node";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { getAppConfigDir } from "../paths.js";

const logger = createServiceLogger("credentialService");

function getCredentialsFile() {
  return join(getAppConfigDir(), "credentials.json");
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export async function readCredentials(): Promise<Record<string, string>> {
  const credentialsFile = getCredentialsFile();
  let raw: string;
  try {
    raw = await readFile(credentialsFile, "utf-8");
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") return {};
    throw new Error(`Unable to read CodeVori credentials: ${credentialsFile}`, { cause: error });
  }

  try {
    const result = credentialRecordSchema.safeParse(JSON.parse(raw));
    if (!result.success) throw new Error(formatZodError(result.error));
    return result.data;
  } catch (error) {
    const backupPath = await backupCorruptFile(credentialsFile).catch(() => undefined);
    logger.warn(undefined, "read failed; refusing to overwrite corrupt credential store", {
      backupPath,
      credentialsFile,
    });
    throw new Error(`CodeVori credentials are corrupt: ${credentialsFile}`, { cause: error });
  }
}

export async function writeCredential(key: string, value: string | null): Promise<void> {
  const credentialsFile = getCredentialsFile();
  await withFileLock(credentialsFile, async () => {
    const credentials = await readCredentials();
    if (value === null) delete credentials[key];
    else credentials[key] = value;
    await atomicWritePrivateTextFile(credentialsFile, `${JSON.stringify(credentials, null, 2)}\n`);
  });
}
