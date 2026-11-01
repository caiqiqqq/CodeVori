export const sameBounds = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === 4 &&
  a.every((n, i) => Number.isFinite(n) && n === b[i]);
export const validBounds = (a) =>
  Array.isArray(a) && a.length === 4 && a.every(Number.isFinite) && a[2] > 0 && a[3] > 0;
export function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}
function succeeded(value) {
  return value === true || value?.ok === true;
}
export function assertOutcome(value) {
  if (!succeeded(value))
    fail(
      "native_input_rejected",
      `Native input failed or its delivery could not be verified${typeof value?.error === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value.error) ? ` (${value.error})` : ""}; observe before another action.`,
    );
}
export function appMatches(app, ref) {
  return (
    app &&
    (ref.pid === undefined || app.pid === ref.pid) &&
    (ref.bundle_id === undefined || app.bundle_id === ref.bundle_id) &&
    (ref.name === undefined || app.name?.toLowerCase() === ref.name.toLowerCase())
  );
}
