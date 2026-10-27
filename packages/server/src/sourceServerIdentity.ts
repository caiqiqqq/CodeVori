import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SOURCE_SERVER_ID_FILE = "source-server-id";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function ensureSourceServerId(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const destination = join(directory, SOURCE_SERVER_ID_FILE);
  const id = randomUUID();
  const temporary = join(directory, `${SOURCE_SERVER_ID_FILE}.${id}.tmp`);
  try {
    await writeFile(temporary, `${id}\n`, { flag: "wx", mode: 0o600 });
    try {
      // Hard-link publication is atomic and never replaces a concurrent owner's identity.
      await link(temporary, destination);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    }
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    });
  }
  const persisted = (await readFile(destination, "utf8")).trim();
  if (!UUID_PATTERN.test(persisted)) {
    throw new Error("Invalid Source Server identity");
  }
  return persisted;
}
