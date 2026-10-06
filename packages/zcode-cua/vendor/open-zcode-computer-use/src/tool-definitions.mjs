const string = (description) => ({ type: "string", description });
const number = (description) => ({ type: "number", description });
const integer = (description) => ({ type: "integer", description });
const boolean = (description, defaultValue) => ({
  type: "boolean",
  description,
  ...(defaultValue === undefined ? {} : { default: defaultValue }),
});
const enumeration = (values, description, defaultValue) => ({
  type: "string",
  enum: values,
  description,
  ...(defaultValue === undefined ? {} : { default: defaultValue }),
});
const object = (properties, required = []) => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: false,
});

export const APP_REF_SCHEMA = {};

const OPEN_APP_PROPERTIES = {
  pid: {
    ...integer("Running process identifier."),
    minimum: Number.MIN_SAFE_INTEGER,
    maximum: Number.MAX_SAFE_INTEGER,
  },
  bundle_id: string("macOS application bundle identifier."),
  name: string("Application display name."),
  window_id: {
    ...integer("Exact macOS window identifier."),
    exclusiveMinimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  },
  url: string("URL to open with the application."),
  urls: { type: "array", items: string("URL to open.") },
};

const OPEN_APP_SCHEMA = {
  anyOf: [
    object(OPEN_APP_PROPERTIES, ["bundle_id"]),
    object(OPEN_APP_PROPERTIES, ["name"]),
    object(OPEN_APP_PROPERTIES, ["pid"]),
  ],
};

const ELEMENT_TARGET_SCHEMA = object(
  {
    type: { const: "element" },
    state_id: string("State identifier returned by get_app_state."),
    index: integer("Element index within the referenced state."),
  },
  ["type", "state_id", "index"],
);

const COORDINATE_TARGET_SCHEMA = object(
  {
    type: { const: "coordinate" },
    x: {
      ...integer("Horizontal pixel coordinate in the latest returned raster."),
      minimum: 0,
    },
    y: {
      ...integer("Vertical pixel coordinate in the latest returned raster."),
      minimum: 0,
    },
    frame_id: {
      ...string("Optional explicit frame identifier."),
      minLength: 1,
    },
  },
  ["type", "x", "y"],
);

export const TARGET_SCHEMA = {
  anyOf: [ELEMENT_TARGET_SCHEMA, COORDINATE_TARGET_SCHEMA],
};

const RETURN_STATE = enumeration(
  ["compact", "full", "none"],
  "Optionally observe the target again after the action.",
  "none",
);
const STRATEGY = enumeration(
  ["auto", "a11y", "event"],
  "Prefer accessibility, require accessibility, or require event dispatch.",
  "auto",
);

function tool(name, title, description, inputSchema, readOnly = false) {
  return {
    name,
    title,
    description,
    inputSchema,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: !readOnly,
      idempotentHint: readOnly,
      openWorldHint: false,
    },
  };
}

const clickSchema = object(
  {
    target: TARGET_SCHEMA,
    modifiers: { ...string("Comma or plus separated key modifiers."), default: "" },
    strategy: STRATEGY,
    return_state: RETURN_STATE,
    app_ref: APP_REF_SCHEMA,
  },
  ["target"],
);

export const TOOLS = [
  tool("list_apps", "List Apps", "List currently running applications.", object({}), true),
  tool(
    "open_application",
    "Open Application",
    "Resolve or launch an application without taking foreground focus unless activate is true.",
    object({
      app: OPEN_APP_SCHEMA,
      activate: boolean("Bring the application to the foreground.", false),
      new_instance: boolean("Request a new application process.", false),
    }),
  ),
  tool(
    "list_windows",
    "List Windows",
    "List windows belonging to an application.",
    object({ app_ref: APP_REF_SCHEMA }, ["app_ref"]),
    true,
  ),
  tool(
    "get_app_state",
    "Get App State",
    "Capture an accessibility-first application state and optionally its window image.",
    object(
      {
        app_ref: APP_REF_SCHEMA,
        detail: enumeration(["compact", "full"], "Returned element detail.", "compact"),
        include_screenshot: boolean("Include a frame-bound window screenshot.", false),
      },
      ["app_ref"],
    ),
    true,
  ),
  tool("screenshot", "Screenshot", "Capture the selected display.", object({}), true),
  tool(
    "zoom",
    "Zoom",
    "Crop a region from an existing frame or around an element target.",
    object({
      frame_id: {
        ...string("Source frame identifier."),
        minLength: 1,
      },
      region: {
        anyOf: [
          {
            type: "array",
            items: { type: "integer" },
            minItems: 4,
            maxItems: 4,
          },
          { type: "null" },
        ],
      },
      target: TARGET_SCHEMA,
    }),
    true,
  ),
  tool("list_displays", "List Displays", "List attached displays and their coordinate spaces.", object({}), true),
  tool(
    "switch_display",
    "Switch Display",
    "Select the display used by screenshot.",
    object({ index: integer("Zero-based display index.") }, ["index"]),
  ),
  tool("cursor_position", "Cursor Position", "Read the physical cursor position.", object({}), true),
  tool("left_click", "Left Click", "Click a bound element or frame coordinate.", clickSchema),
  tool("double_click", "Double Click", "Double-click a bound element or frame coordinate.", clickSchema),
  tool("triple_click", "Triple Click", "Triple-click a bound element or frame coordinate.", clickSchema),
  tool("right_click", "Right Click", "Right-click a bound element or frame coordinate.", clickSchema),
  tool("middle_click", "Middle Click", "Middle-click a bound element or frame coordinate.", clickSchema),
  tool(
    "scroll",
    "Scroll",
    "Scroll at a bound element or frame coordinate.",
    object(
      {
        target: TARGET_SCHEMA,
        scroll_direction: enumeration(["up", "down", "left", "right"], "Scroll direction."),
        scroll_amount: integer("Positive page-like scroll amount."),
        strategy: STRATEGY,
        return_state: RETURN_STATE,
        app_ref: APP_REF_SCHEMA,
      },
      ["target", "scroll_direction", "scroll_amount"],
    ),
  ),
  tool(
    "left_click_drag",
    "Left Click Drag",
    "Drag from one bound target to another.",
    object(
      {
        from_target: TARGET_SCHEMA,
        to: TARGET_SCHEMA,
        modifiers: { ...string("Comma or plus separated key modifiers."), default: "" },
        return_state: RETURN_STATE,
        app_ref: APP_REF_SCHEMA,
      },
      ["from_target", "to"],
    ),
  ),
  tool(
    "mouse_move",
    "Mouse Move",
    "Move a synthesized pointer without moving the user's physical cursor.",
    object(
      {
        coordinate: TARGET_SCHEMA,
        app_ref: APP_REF_SCHEMA,
        return_state: RETURN_STATE,
      },
      ["coordinate"],
    ),
  ),
  tool(
    "left_mouse_down",
    "Left Mouse Down",
    "Begin a scoped left-button hold.",
    object(
      {
        target: TARGET_SCHEMA,
        app_ref: APP_REF_SCHEMA,
        return_state: RETURN_STATE,
      },
      ["target"],
    ),
  ),
  tool(
    "left_mouse_up",
    "Left Mouse Up",
    "Release the scoped left-button hold.",
    object({ return_state: RETURN_STATE }),
  ),
  tool(
    "type",
    "Type",
    "Type text into a bound element or the focused element of a scoped app.",
    object(
      {
        text: string("Text to type."),
        target: TARGET_SCHEMA,
        app_ref: APP_REF_SCHEMA,
        strategy: STRATEGY,
        return_state: RETURN_STATE,
      },
      ["text"],
    ),
  ),
  tool(
    "set_value",
    "Set Value",
    "Set an accessibility element value.",
    object(
      {
        target: TARGET_SCHEMA,
        value: string("Replacement value."),
        strategy: STRATEGY,
        return_state: RETURN_STATE,
      },
      ["target", "value"],
    ),
  ),
  tool(
    "select_text",
    "Select Text",
    "Select all or a UTF-16 range in a text element.",
    object(
      {
        target: TARGET_SCHEMA,
        text_range: {
          anyOf: [
            {
              type: "array",
              items: { type: "integer" },
              minItems: 2,
              maxItems: 2,
            },
            { type: "null" },
          ],
        },
        return_state: RETURN_STATE,
      },
      ["target"],
    ),
  ),
  tool(
    "key",
    "Key",
    "Send a key or chord to a scoped application.",
    object(
      {
        text: string("Key or chord, for example cmd+a or return."),
        repeat: { anyOf: [integer("Repeat count."), { type: "null" }] },
        app_ref: APP_REF_SCHEMA,
        strategy: STRATEGY,
        return_state: RETURN_STATE,
      },
      ["text"],
    ),
  ),
  tool(
    "hold_key",
    "Hold Key",
    "Hold a key or chord for up to 30 seconds.",
    object(
      {
        text: string("Key or chord."),
        duration: number("Duration in seconds."),
        app_ref: APP_REF_SCHEMA,
        strategy: STRATEGY,
        return_state: RETURN_STATE,
      },
      ["text", "duration"],
    ),
  ),
  tool(
    "perform_action",
    "Perform Action",
    "Run one of the accessibility actions advertised by an element.",
    object(
      {
        target: TARGET_SCHEMA,
        action: string("Advertised accessibility action."),
        return_state: RETURN_STATE,
      },
      ["target", "action"],
    ),
  ),
  tool(
    "request_access",
    "Request Access",
    "Read permission and runtime readiness without prompting.",
    object({
      capabilities: {
        anyOf: [
          { type: "array", items: string("Capability name.") },
          { type: "null" },
        ],
      },
    }),
    true,
  ),
  tool(
    "stop_computer_control",
    "Stop Computer Control",
    "Latch the session kill switch and release held input.",
    object({ reason: { anyOf: [string("Stop reason."), { type: "null" }] } }),
  ),
  tool(
    "wait",
    "Wait",
    "Pause for up to 30 seconds.",
    object({ duration: number("Duration in seconds.") }, ["duration"]),
    true,
  ),
  tool("read_clipboard", "Read Clipboard", "Read plain text from the system clipboard.", object({}), true),
  tool(
    "write_clipboard",
    "Write Clipboard",
    "Replace the system clipboard with plain text.",
    object({ text: string("Clipboard text.") }, ["text"]),
  ),
];

export const TOOL_BY_NAME = new Map(TOOLS.map((definition) => [definition.name, definition]));
