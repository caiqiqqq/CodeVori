/** Same ordering for Host downgrade protection and UI update hints, including date releases. */
export function compareAcpAdapterVersions(
  installed: string | null | undefined,
  target: string,
): -1 | 0 | 1 | null {
  const parse = (version: string | null | undefined) => {
    const parts = version?.match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/);
    if (!parts) return null;
    const numbers = parts.slice(1, 4).map(Number);
    return numbers.every(Number.isSafeInteger) ? { numbers, pre: parts[4]?.split(".") } : null;
  };
  if (installed === target) return 0;
  const current = parse(installed);
  const desired = parse(target);
  if (!current || !desired) return null;
  for (let part = 0; part < 3; part++) {
    if (current.numbers[part]! > desired.numbers[part]!) return 1;
    if (current.numbers[part]! < desired.numbers[part]!) return -1;
  }
  if (!current.pre && !desired.pre) return 0;
  if (!current.pre) return 1;
  if (!desired.pre) return -1;
  for (let part = 0; part < Math.max(current.pre.length, desired.pre.length); part++) {
    const left = current.pre[part];
    const right = desired.pre[part];
    if (left === right) continue;
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return BigInt(left) > BigInt(right) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left > right ? 1 : -1;
  }
  return 0;
}
