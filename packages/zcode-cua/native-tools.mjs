import { TOOLS as LEGACY_TOOLS } from "./vendor/open-zcode-computer-use/src/tool-definitions.mjs";
import { TOOL_FIELDS } from "./runtime-contract.mjs";

const legacy = new Map(LEGACY_TOOLS.map((tool) => [tool.name, tool]));
const appRef = {
  type: "object",
  properties: {
    pid: { type: "integer", minimum: 1 },
    bundle_id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    window_id: { type: "integer", minimum: 1 },
  },
  additionalProperties: false,
};
const extras = {
  app_ref: appRef,
  mouse_button: { enum: ["left", "right", "middle"] },
  click_count: { type: "integer", minimum: 1, maximum: 3 },
  hold_seconds: { type: "number", minimum: 0, maximum: 30 },
  disable_diffing: { type: "boolean" },
  tree_shown_to_model: { type: "boolean" },
  format: { enum: ["text"] },
};
export const NATIVE_TOOLS = [...TOOL_FIELDS].map(([name, fields]) => {
  const base = legacy.get(name) ?? {
    name,
    description:
      "Paste plain text through native provided-paste support; unavailable platforms return an error without replacing the clipboard.",
    inputSchema: { required: ["text", "app_ref"] },
  };
  const properties = Object.fromEntries(
    fields.map((field) => [
      field,
      extras[field] ?? base.inputSchema.properties?.[field] ?? { type: "string" },
    ]),
  );
  return {
    ...base,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties,
      ...(base.inputSchema.required ? { required: base.inputSchema.required } : {}),
    },
  };
});
export const INTERNAL_TOOL_BY_NAME = new Map(
  [...LEGACY_TOOLS, ...NATIVE_TOOLS].map((tool) => [tool.name, tool]),
);
