import * as SecureStore from "expo-secure-store";
import { parseConnectionInput, type MobileConnection } from "./connection";

const STORAGE_KEY = "zcode.mobile.lan.connection.v1";

export async function loadConnection(): Promise<MobileConnection | null> {
  const serialized = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!serialized) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as { origin?: unknown; token?: unknown };
    if (typeof candidate.origin !== "string" || typeof candidate.token !== "string") return null;
    const parsed = parseConnectionInput(candidate.origin, candidate.token);
    return parsed.ok ? parsed.connection : null;
  } catch {
    return null;
  }
}

export async function saveConnection(connection: MobileConnection): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(connection), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}
