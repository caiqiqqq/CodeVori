import type { SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk";
import type { AcpConfigOption, AcpModeState } from "@zcode/shared";

/** Only protocol display fields cross into the persistent Host snapshot. */
export function projectAcpConfigOptions(
  options: SessionConfigOption[] | null | undefined,
): AcpConfigOption[] {
  return (options ?? []).map((option) => {
    const base = {
      id: option.id,
      name: option.name,
      ...(option.description ? { description: option.description } : {}),
      ...(option.category ? { category: option.category } : {}),
    };
    if (option.type === "boolean")
      return { ...base, type: "boolean", currentValue: option.currentValue };
    return {
      ...base,
      type: "select",
      currentValue: option.currentValue,
      options: option.options.map((item) => {
        if ("group" in item)
          return {
            group: item.group,
            name: item.name,
            options: item.options.map(({ value, name, description }) => ({
              value,
              name,
              ...(description ? { description } : {}),
            })),
          };
        return {
          value: item.value,
          name: item.name,
          ...(item.description ? { description: item.description } : {}),
        };
      }),
    };
  });
}

export function projectAcpModeState(
  modes: SessionModeState | null | undefined,
): AcpModeState | null {
  if (!modes) return null;
  return {
    currentModeId: modes.currentModeId,
    availableModes: modes.availableModes.map(({ id, name, description }) => ({
      id,
      name,
      ...(description ? { description } : {}),
    })),
  };
}

export function acpConfigValues(option: AcpConfigOption): string[] {
  if (option.type !== "select") return [];
  return option.options.flatMap((entry) =>
    "group" in entry ? entry.options.map((item) => item.value) : [entry.value],
  );
}
