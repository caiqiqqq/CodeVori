export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = "test-device-only";
export async function getItemAsync(key) {
  return sessionStorage.getItem(key);
}
export async function setItemAsync(key, value, options) {
  const state = window.__mobile;
  state.saveCalls.push({ key, value: JSON.parse(value), options });
  if (state.holdSave)
    await new Promise((resolve) => {
      state.releaseSave = resolve;
    });
  if (state.failSave) throw new Error("Synthetic secure store error");
  sessionStorage.setItem(key, value);
}
export async function deleteItemAsync(key) {
  const state = window.__mobile;
  state.deleteCalls = (state.deleteCalls ?? 0) + 1;
  if (state.holdDelete)
    await new Promise((resolve) => {
      state.releaseDelete = resolve;
    });
  if (state.failDelete) throw new Error("Synthetic secure store delete error");
  sessionStorage.removeItem(key);
}
