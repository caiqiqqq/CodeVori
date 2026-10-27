export const TOOL_FIELDS = new Map(
  Object.entries({
    list_apps: [],
    list_windows: ["app_ref"],
    get_app_state: [
      "app_ref",
      "detail",
      "include_screenshot",
      "disable_diffing",
      "tree_shown_to_model",
    ],
    left_click: [
      "target",
      "app_ref",
      "mouse_button",
      "click_count",
      "modifiers",
      "strategy",
      "return_state",
    ],
    scroll: ["target", "app_ref", "scroll_direction", "scroll_amount", "strategy", "return_state"],
    left_click_drag: ["from_target", "to", "app_ref", "modifiers", "return_state"],
    type: ["text", "target", "app_ref", "strategy", "return_state"],
    set_value: ["target", "app_ref", "value", "strategy", "return_state"],
    select_text: ["target", "app_ref", "text_range", "return_state"],
    key: ["text", "repeat", "hold_seconds", "app_ref", "strategy", "return_state"],
    perform_action: ["target", "app_ref", "action", "return_state"],
    paste: ["text", "format", "app_ref"],
    request_access: ["capabilities"],
    stop_computer_control: ["reason"],
  }),
);

export const ACTIONS = new Set([
  "left_click",
  "scroll",
  "left_click_drag",
  "type",
  "set_value",
  "select_text",
  "key",
  "perform_action",
  "paste",
]);

export function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validAppRef(value) {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !["pid", "bundle_id", "name", "window_id"].includes(key))
  )
    return false;
  if (value.pid !== undefined && (!Number.isInteger(value.pid) || value.pid <= 0)) return false;
  if (value.window_id !== undefined && (!Number.isInteger(value.window_id) || value.window_id <= 0))
    return false;
  if (value.bundle_id !== undefined && (typeof value.bundle_id !== "string" || !value.bundle_id))
    return false;
  if (value.name !== undefined && (typeof value.name !== "string" || !value.name)) return false;
  return value.pid !== undefined || value.bundle_id !== undefined || value.name !== undefined;
}

function validTarget(value) {
  if (!record(value)) return false;
  if (value.type === "element") {
    return (
      Object.keys(value).every((key) => ["type", "index", "state_id"].includes(key)) &&
      Number.isInteger(value.index) &&
      value.index >= 0 &&
      (value.state_id === undefined || typeof value.state_id === "string")
    );
  }
  return (
    value.type === "coordinate" &&
    Object.keys(value).every((key) => ["type", "x", "y", "frame_id"].includes(key)) &&
    Number.isInteger(value.x) &&
    value.x >= 0 &&
    Number.isInteger(value.y) &&
    value.y >= 0 &&
    (value.frame_id === undefined || typeof value.frame_id === "string")
  );
}

export function validateToolRequest(name, args) {
  const fields = TOOL_FIELDS.get(name);
  if (!fields) return "unknown Computer Use tool";
  if (!record(args) || Object.keys(args).some((key) => !fields.includes(key))) {
    return "invalid Computer Use arguments";
  }
  if (args.app_ref !== undefined && !validAppRef(args.app_ref)) return "invalid app_ref";
  if (["list_windows", "get_app_state"].includes(name) && !validAppRef(args.app_ref)) {
    return "app_ref is required";
  }
  for (const field of ["target", "from_target", "to"]) {
    if (args[field] !== undefined && !validTarget(args[field])) return `invalid ${field}`;
  }
  if (
    ["left_click", "scroll", "set_value", "select_text", "perform_action"].includes(name) &&
    !args.target
  ) {
    return "target is required";
  }
  if (name === "left_click_drag" && (!args.from_target || !args.to))
    return "drag targets are required";
  if (["type", "key", "paste"].includes(name) && typeof args.text !== "string")
    return "text is required";
  if (name === "set_value" && typeof args.value !== "string") return "value is required";
  if (name === "perform_action" && (typeof args.action !== "string" || !args.action.trim()))
    return "action is required";
  if (
    name === "scroll" &&
    (!["up", "down", "left", "right"].includes(args.scroll_direction) ||
      !Number.isInteger(args.scroll_amount) ||
      args.scroll_amount < 1 ||
      args.scroll_amount > 100)
  ) {
    return "invalid scroll direction or amount";
  }
  if (
    name === "select_text" &&
    args.text_range !== undefined &&
    args.text_range !== null &&
    (!Array.isArray(args.text_range) ||
      args.text_range.length !== 2 ||
      args.text_range.some((part) => !Number.isInteger(part) || part < 0))
  ) {
    return "invalid text_range";
  }
  if (name === "paste" && args.format !== undefined && args.format !== "text") {
    return "unsupported paste format";
  }
  if (args.strategy !== undefined && !["auto", "a11y", "event"].includes(args.strategy)) {
    return "invalid strategy";
  }
  if (args.return_state !== undefined && !["none", "compact", "full"].includes(args.return_state)) {
    return "invalid return_state";
  }
  if (args.mouse_button !== undefined && !["left", "right", "middle"].includes(args.mouse_button)) {
    return "invalid mouse_button";
  }
  if (
    args.click_count !== undefined &&
    (!Number.isInteger(args.click_count) || args.click_count < 1 || args.click_count > 3)
  ) {
    return "invalid click_count";
  }
  if (
    args.hold_seconds !== undefined &&
    (typeof args.hold_seconds !== "number" ||
      !Number.isFinite(args.hold_seconds) ||
      args.hold_seconds < 0 ||
      args.hold_seconds > 30)
  ) {
    return "invalid hold_seconds";
  }
  if (args.include_screenshot !== undefined && typeof args.include_screenshot !== "boolean")
    return "invalid include_screenshot";
  if (args.disable_diffing !== undefined && typeof args.disable_diffing !== "boolean")
    return "invalid disable_diffing";
  if (args.tree_shown_to_model !== undefined && typeof args.tree_shown_to_model !== "boolean")
    return "invalid tree_shown_to_model";
  if (args.detail !== undefined && !["compact", "full"].includes(args.detail))
    return "invalid detail";
  if (
    args.capabilities !== undefined &&
    args.capabilities !== null &&
    (!Array.isArray(args.capabilities) ||
      args.capabilities.some((item) => typeof item !== "string"))
  )
    return "invalid capabilities";
  if (args.reason !== undefined && args.reason !== null && typeof args.reason !== "string")
    return "invalid reason";
  return undefined;
}
