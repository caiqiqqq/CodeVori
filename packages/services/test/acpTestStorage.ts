import { basename } from "node:path";
import { AcpSessionStore } from "../src/acp/acpSessionStore.js";

/** A fresh reader proves restart-visible persistence; never reads the in-memory Host owner. */
export const readPersistedAcpSession = (path: string) =>
  new AcpSessionStore(() => path).read(basename(path, ".json"));
