import { createOpenComputerUseService, isOpenComputerUseSupported } from "./open-runtime.mjs";
import { ACTIONS, TOOL_FIELDS, record, validateToolRequest } from "./runtime-contract.mjs";
import { toolError } from "./vendor/open-zcode-computer-use/src/results.mjs";

const MAX_SESSIONS = 128;

function failure(message, code, delivery = "not_sent") {
  return toolError(new Error(message), {
    code,
    action_sent: delivery === "possibly_sent",
    request_delivery_state: delivery,
    dispatch_status: delivery,
  });
}

function sessionKey(context) {
  const workspace =
    context.workspaceKey?.trim() ||
    context.workspaceIdentity?.trim() ||
    context.workspacePath?.trim();
  const session = context.sessionId?.trim();
  if (!workspace || !session) return undefined;
  return [workspace, context.remoteSessionId?.trim() || "__local__", session].join("\0");
}

function textPayload(result) {
  if (record(result.structuredContent)) return result.structuredContent;
  // 截图结果的 image_ref 文本先于状态 JSON；只认含状态与元素表的块，避免把帧凭证误当成状态。
  for (const item of result.content ?? []) {
    if (item.type !== "text") continue;
    try {
      const value = JSON.parse(item.text);
      if (record(value) && typeof value.state_id === "string" && Array.isArray(value.elements)) {
        return value;
      }
    } catch {
      /* A plain accessibility tree is not JSON. */
    }
  }
  return undefined;
}

function matchesApp(observation, appRef) {
  if (!appRef) return false;
  const app = observation.app;
  return (
    (appRef.pid === undefined || appRef.pid === app.pid) &&
    (appRef.bundle_id === undefined || appRef.bundle_id === app.bundle_id) &&
    (appRef.name === undefined || appRef.name.toLowerCase() === app.name?.toLowerCase()) &&
    (appRef.window_id === undefined || appRef.window_id === observation.window?.window_id)
  );
}

function latestObservation(session, appRef) {
  for (let index = session.observations.length - 1; index >= 0; index -= 1) {
    const observed = session.observations[index];
    if (matchesApp(observed, appRef)) return observed;
  }
  return undefined;
}

function bindTarget(target, observed) {
  if (!target) return target;
  if (target.type === "element") {
    if (target.state_id && target.state_id !== observed?.state_id) return undefined;
    return observed ? { ...target, state_id: observed.state_id } : undefined;
  }
  if (target.frame_id && target.frame_id !== observed?.image_ref?.frame_id) return undefined;
  return observed?.image_ref?.frame_id
    ? { ...target, frame_id: observed.image_ref.frame_id }
    : undefined;
}

function normalizeObservation(result, session, appRef) {
  if (result.isError) return result;
  const payload = textPayload(result);
  if (
    !payload ||
    typeof payload.state_id !== "string" ||
    !Array.isArray(payload.elements) ||
    !record(payload.app) ||
    !record(payload.window)
  ) {
    return failure(
      "The accessibility executor returned no usable app state.",
      "structured_state_unavailable",
    );
  }
  if (!matchesApp(payload, appRef)) {
    return failure("The observed application does not match app_ref.", "element_unavailable");
  }
  const text =
    typeof payload.text === "string"
      ? payload.text
      : payload.elements
          .map((element) =>
            `[${element.index}] ${element.kind ?? element.role ?? "element"} ${element.name ?? ""}`.trim(),
          )
          .join("\n");
  const normalized = { ...payload, text };
  session.observations = session.observations.filter(
    (entry) =>
      !matchesApp(entry, { pid: normalized.app.pid, window_id: normalized.window.window_id }),
  );
  session.observations.push(normalized);
  if (session.observations.length > 16) session.observations.shift();
  const imageBlocks = (result.content ?? []).filter((part) => part.type === "image");
  return {
    ...result,
    content: [
      ...imageBlocks,
      ...(normalized.image_ref
        ? [{ type: "text", text: JSON.stringify({ image_ref: normalized.image_ref }) }]
        : []),
      { type: "text", text },
    ],
    structuredContent: normalized,
  };
}

function verifyWindowIdentity(result, appRef) {
  if (result.isError) return result;
  try {
    const windows = JSON.parse(result.content.find((part) => part.type === "text")?.text);
    if (
      Array.isArray(windows) &&
      windows.every(
        (window) =>
          (appRef.pid === undefined || window.pid === appRef.pid) &&
          (appRef.bundle_id === undefined || window.bundle_id === appRef.bundle_id),
      )
    ) {
      return result;
    }
  } catch {
    /* An unknown response shape cannot prove app ownership. */
  }
  return failure("The window list does not match app_ref.", "element_unavailable");
}

function createSession(key, options) {
  const platform = options.platform ?? process.platform;
  const openMac =
    !options.brokerSocketPath &&
    isOpenComputerUseSupported({ platform, macOsVersion: options.macOsVersion });
  const service =
    options.createService?.(key) ??
    (openMac ? createOpenComputerUseService({ platform, env: options.env }) : undefined);
  return {
    service,
    openMac,
    observations: [],
    stopped: false,
    closed: false,
    tail: Promise.resolve(),
    enqueue(run) {
      const result = this.tail.then(run);
      this.tail = result.catch(() => undefined);
      return result;
    },
    async close() {
      this.closed = true;
      await this.enqueue(async () => {
        await this.service?.close();
        this.observations = [];
      });
    },
  };
}

export function createComputerUseRuntime(options = {}) {
  const sessions = new Map();
  let admission = Promise.resolve();
  let disposed = false;

  function admit(run) {
    const result = admission.then(run);
    admission = result.catch(() => undefined);
    return result;
  }

  async function acquire(key) {
    return admit(async () => {
      if (disposed) return undefined;
      let session = sessions.get(key);
      if (!session) {
        if (sessions.size >= MAX_SESSIONS) {
          const oldest = sessions.keys().next().value;
          const evicted = sessions.get(oldest);
          sessions.delete(oldest);
          await evicted.close();
        }
        session = createSession(key, options);
        sessions.set(key, session);
      }
      return session;
    });
  }

  return {
    async execute({ toolName, arguments: supplied, context, signal }) {
      const key = sessionKey(context ?? {});
      if (!key) return failure("Computer Use session context is invalid.", "invalid_context");
      if (context.runtimeScope === "subagent") {
        return failure(
          "Computer Use is not available in subagent.",
          "SUBAGENT_COMPUTER_USE_UNAVAILABLE",
        );
      }
      const args = supplied ?? {};
      const invalid = validateToolRequest(toolName, args);
      if (invalid)
        return failure(invalid, TOOL_FIELDS.has(toolName) ? "invalid_arguments" : "unknown_tool");
      if (signal?.aborted) return failure("Computer Use request was cancelled.", "cancelled");
      const session = await acquire(key);
      if (!session) return failure("Computer Use runtime is closed.", "connection_closed");
      return session.enqueue(async () => {
        if (session.closed || signal?.aborted)
          return failure("Computer Use request was cancelled.", "cancelled");
        if (session.stopped && !["request_access", "stop_computer_control"].includes(toolName)) {
          return failure(
            "Computer control was stopped for this session.",
            "computer_control_stopped",
          );
        }
        if (!session.service) {
          // 产品 Helper socket 不能由开源执行器代接，否则会绕开原有签名准入。
          return failure(
            options.brokerSocketPath
              ? "The signed Computer Use Helper broker has no compatible client in this build."
              : `Computer Use native executor is unavailable on ${options.platform ?? process.platform}.`,
            options.brokerSocketPath ? "broker_unavailable" : "action_unavailable",
          );
        }
        const bound = { ...args };
        if (toolName !== "get_app_state" && ACTIONS.has(toolName)) {
          const observed = latestObservation(session, args.app_ref);
          if (!observed) {
            return failure(
              "Observe the requested application before sending input.",
              "element_unavailable",
            );
          }
          for (const field of ["target", "from_target", "to"]) {
            if (!args[field]) continue;
            bound[field] = bindTarget(args[field], observed);
            if (!bound[field])
              return failure(
                "Target state or frame is not current for this app.",
                "element_unavailable",
              );
          }
        }
        if (toolName === "get_app_state") bound.detail = "full";
        let dispatched = false;
        try {
          let name = toolName;
          if (toolName === "paste" && session.openMac) {
            return failure(
              "Native paste is unavailable in the open macOS executor.",
              "action_unavailable",
            );
          }
          if (toolName === "left_click" && session.openMac) {
            const button = args.mouse_button ?? "left";
            const count = args.click_count ?? 1;
            name =
              button === "left"
                ? { 1: "left_click", 2: "double_click", 3: "triple_click" }[count]
                : count === 1
                  ? { right: "right_click", middle: "middle_click" }[button]
                  : undefined;
            if (!name)
              return failure("Unsupported mouse button or click count.", "action_unavailable");
            delete bound.mouse_button;
            delete bound.click_count;
          }
          if (toolName === "key" && session.openMac && args.hold_seconds !== undefined) {
            if (
              typeof args.hold_seconds !== "number" ||
              args.hold_seconds < 0 ||
              args.hold_seconds > 30
            ) {
              return failure("hold_seconds must be between 0 and 30.", "invalid_arguments");
            }
            name = "hold_key";
            bound.duration = args.hold_seconds;
            delete bound.hold_seconds;
          }
          dispatched = true;
          let result = await session.service.callTool(name, bound, {
            signal,
            runtimeScope: context.runtimeScope,
          });
          if (
            toolName === "get_app_state" &&
            session.openMac &&
            result.isError === true &&
            result.structuredContent?.code === "app_not_found" &&
            (args.app_ref.name || args.app_ref.bundle_id) &&
            !signal?.aborted
          ) {
            const launch = await session.service.callTool(
              "open_application",
              {
                app: args.app_ref,
                activate: false,
              },
              { signal, runtimeScope: context.runtimeScope },
            );
            if (launch.isError === true) return launch;
            result = await session.service.callTool(name, bound, {
              signal,
              runtimeScope: context.runtimeScope,
            });
          }
          if (signal?.aborted)
            return failure(
              "Computer Use action may already have been sent.",
              "cancelled",
              "possibly_sent",
            );
          if (toolName === "get_app_state")
            return normalizeObservation(result, session, args.app_ref);
          if (toolName === "list_windows" && session.openMac) {
            return verifyWindowIdentity(result, args.app_ref);
          }
          if (toolName === "stop_computer_control" && result.isError !== true) {
            session.stopped = true;
            session.observations = [];
          }
          return result;
        } catch (error) {
          return failure(
            error instanceof Error ? error.message : String(error),
            error?.code ?? "native_error",
            dispatched ? "possibly_sent" : "not_sent",
          );
        }
      });
    },
    async closeSession(context) {
      const key = sessionKey(context ?? {});
      if (!key) return;
      const session = await admit(() => {
        const current = sessions.get(key);
        sessions.delete(key);
        return current;
      });
      await session?.close();
    },
    async dispose() {
      const active = await admit(() => {
        disposed = true;
        const all = [...sessions.values()];
        sessions.clear();
        return all;
      });
      await Promise.all(active.map((session) => session.close()));
    },
  };
}
