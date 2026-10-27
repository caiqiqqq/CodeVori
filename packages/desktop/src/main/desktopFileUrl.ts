import { fileURLToPath } from "node:url";

export function fileUrlToLocalPath(url: string): string | null {
  try {
    if (new URL(url).protocol !== "file:") return null;
    return fileURLToPath(url);
  } catch {
    return null;
  }
}
