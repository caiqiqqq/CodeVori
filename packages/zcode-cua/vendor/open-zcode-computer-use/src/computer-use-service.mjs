import { createHash, randomUUID } from "node:crypto";
import { copyFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ActionQueue,
  FrameRegistry,
  RegistryError,
  StateRegistry,
} from "./registries.mjs";
import {
  actionReceipt,
  imageResult,
  textContent,
  toolError,
  toolResult,
} from "./results.mjs";
import { HostTransportError, runNativeUtility } from "./host-client.mjs";

const KIND_BY_ROLE = new Map([
  ["AXButton", "button"],
  ["AXMenuButton", "menu button"],
  ["AXPopUpButton", "popup button"],
  ["AXCheckBox", "checkbox"],
  ["AXRadioButton", "radio"],
  ["AXTextField", "text field"],
  ["AXTextArea", "text area"],
  ["AXSearchField", "search field"],
  ["AXSecureTextField", "secure field"],
  ["AXStaticText", "text"],
  ["AXLink", "link"],
  ["AXSlider", "slider"],
  ["AXIncrementor", "stepper"],
  ["AXImage", "image"],
  ["AXRow", "row"],
  ["AXCell", "cell"],
  ["AXTable", "table"],
  ["AXOutline", "outline"],
  ["AXScrollArea", "scroll area"],
  ["AXTab", "tab"],
  ["AXTabGroup", "tab group"],
  ["AXWindow", "window"],
  ["AXSheet", "sheet"],
  ["AXGroup", "group"],
]);

const ACTION_ALIAS = new Map([
  ["axpress", "press"],
  ["invoke", "press"],
  ["click", "press"],
  ["showmenu", "show_menu"],
  ["axshowmenu", "show_menu"],
  ["menu", "show_menu"],
  ["axpick", "pick"],
  ["select", "pick"],
  ["selection", "pick"],
]);

class DomainError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.detail = detail;
  }
}

function ensureHostOK(result) {
  if (result?.ok === false) {
    throw new DomainError(
      result.error?.code ?? "native_error",
      result.error?.message ?? "Native executor refused the request",
      result.error?.detail,
    );
  }
  return result;
}

function rectArray(rect) {
  return [rect.x, rect.y, rect.width, rect.height];
}

function contains(rect, point) {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x < rect.x + rect.width &&
    point.y < rect.y + rect.height
  );
}

function center(rect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function parseModifiers(value = "") {
  const aliases = new Map([
    ["cmd", "command"],
    ["command", "command"],
    ["meta", "command"],
    ["shift", "shift"],
    ["alt", "option"],
    ["option", "option"],
    ["ctrl", "control"],
    ["control", "control"],
    ["fn", "fn"],
  ]);
  if (!value.trim()) return [];
  return value
    .split(/[+,]/u)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => {
      const resolved = aliases.get(part);
      if (!resolved) throw new DomainError("unsupported_modifier", `Unsupported modifier: ${part}`);
      return resolved;
    });
}

function parseKeyChord(value) {
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) throw new DomainError("unsupported_key", "Key text is empty");
  const keyRaw = parts.pop();
  const modifiers = parseModifiers(parts.join("+"));
  const aliases = new Map([
    ["enter", "Return"],
    ["return", "Return"],
    ["tab", "Tab"],
    ["space", "Space"],
    ["esc", "Escape"],
    ["escape", "Escape"],
    ["backspace", "Backspace"],
    ["delete", "Backspace"],
    ["forwarddelete", "ForwardDelete"],
    ["up", "Up"],
    ["down", "Down"],
    ["left", "Left"],
    ["right", "Right"],
    ["home", "Home"],
    ["end", "End"],
    ["pageup", "PageUp"],
    ["pagedown", "PageDown"],
  ]);
  const lower = keyRaw.toLowerCase();
  const key = aliases.get(lower)
    ?? (/^f(?:[1-9]|1[0-2])$/u.test(lower) ? lower.toUpperCase() : keyRaw);
  return { key, modifiers };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runProcess(command, args, { input, timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error(`${command} timed out`)));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code) => {
      finish(() => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
      });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export class ComputerUseService {
  constructor({
    host,
    nativeUtility = runNativeUtility,
    assertActive = () => {},
    now = Date.now,
  }) {
    this.host = host;
    this.nativeUtility = nativeUtility;
    this.runProcess = (...args) => { assertActive(); return runProcess(...args); };
    this.states = new StateRegistry({ now });
    this.frames = new FrameRegistry({ now });
    this.actions = new ActionQueue();
    this.selectedDisplayIndex = 0;
    this.stopped = false;
    this.stopReason = null;
    this.pointerHold = null;
  }

  async start() {
    await this.host.start();
  }

  async close() {
    await this.actions.run(() => this.releaseHeldPointer());
    this.states.clear("closed");
    this.frames.clear("closed");
    await this.host.close();
  }

  async callTool(name, args = {}) {
    try {
      if (this.stopped && !["request_access", "stop_computer_control"].includes(name)) {
        throw new DomainError(
          "computer_control_stopped",
          `Computer control is stopped${this.stopReason ? `: ${this.stopReason}` : ""}`,
        );
      }
      switch (name) {
      case "list_apps":
        return await this.listApps();
      case "open_application":
        return await this.openApplication(args);
      case "list_windows":
        return await this.listWindows(args);
      case "get_app_state":
        return await this.getAppState(args);
      case "screenshot":
        return await this.screenshot();
      case "zoom":
        return await this.zoom(args);
      case "list_displays":
        return await this.listDisplays();
      case "switch_display":
        return await this.switchDisplay(args);
      case "cursor_position":
        return toolResult(await this.nativeUtility("cursor"));
      case "left_click":
        return await this.click(args, "left", 1);
      case "double_click":
        return await this.click(args, "left", 2);
      case "triple_click":
        return await this.click(args, "left", 3);
      case "right_click":
        return await this.click(args, "right", 1);
      case "middle_click":
        return await this.click(args, "middle", 1);
      case "scroll":
        return await this.scroll(args);
      case "left_click_drag":
        return await this.drag(args);
      case "mouse_move":
        return await this.pointAction(args.coordinate, args, { kind: "move" });
      case "left_mouse_down":
        return await this.mouseDown(args);
      case "left_mouse_up":
        return await this.mouseUp(args);
      case "type":
        return await this.typeText(args);
      case "set_value":
        return await this.setValue(args);
      case "select_text":
        return await this.selectText(args);
      case "key":
        return await this.key(args);
      case "hold_key":
        return await this.holdKey(args);
      case "perform_action":
        return await this.performAction(args);
      case "request_access":
        return await this.requestAccess(args);
      case "stop_computer_control":
        return await this.stop(args);
      case "wait":
        return await this.wait(args);
      case "read_clipboard":
        return toolResult({ text: await this.runProcess("/usr/bin/pbpaste", []) });
      case "write_clipboard":
        await this.runProcess("/usr/bin/pbcopy", [], { input: String(args.text ?? "") });
        return toolResult("Clipboard written.");
      default:
        throw new DomainError("unknown_tool", `Unknown tool: ${name}`);
      }
    } catch (error) {
      const details = {
        code: error.code ?? "tool_error",
        action_sent: error.delivery === "possibly_sent",
        request_delivery_state: error.delivery ?? "not_sent",
        ...(error.detail ? { detail: error.detail } : {}),
      };
      return toolError(error, details);
    }
  }

  async listApps() {
    const result = ensureHostOK(
      await this.host.call("apps.list", { session: this.host.session }),
    );
    let frontmostPid = null;
    try {
      frontmostPid = (await this.nativeUtility("frontmost")).pid ?? null;
    } catch {
      // App enumeration remains useful when foreground inspection is unavailable.
    }
    return toolResult(
      result.apps.map((app) => ({
        name: app.name,
        bundle_id: app.appId.startsWith("pid:") ? null : app.appId,
        pid: app.pid,
        active: app.pid === frontmostPid,
        window_count: app.windowCount,
      })),
    );
  }

  async openApplication({ app = {}, activate = false, new_instance: newInstance = false }) {
    const identity = app.bundle_id ?? app.name ?? (app.pid ? `pid:${app.pid}` : null);
    if (!identity) throw new DomainError("invalid_app_ref", "app requires bundle_id, name, or pid");
    let resolved;
    if (newInstance) {
      if (app.pid !== undefined) {
        throw new DomainError("invalid_app_ref", "new_instance cannot be combined with app.pid");
      }
      const application = app.name ?? app.bundle_id;
      if (!application) {
        throw new DomainError("invalid_app_ref", "new_instance requires app.name or app.bundle_id");
      }
      const before = ensureHostOK(
        await this.host.call("apps.list", { session: this.host.session }),
      ).apps;
      const existingPids = new Set(before.map((candidate) => candidate.pid));
      const flags = ["-n"];
      if (app.bundle_id) flags.push("-b", app.bundle_id);
      else flags.push("-a", app.name);
      for (const url of app.urls ?? (app.url ? [app.url] : [])) flags.push(url);
      await this.runProcess("/usr/bin/open", flags);
      const deadline = Date.now() + 8_000;
      do {
        const running = ensureHostOK(
          await this.host.call("apps.list", { session: this.host.session }),
        ).apps;
        const candidates = running.filter((candidate) =>
          !existingPids.has(candidate.pid) &&
          (
            (app.bundle_id && candidate.appId.toLowerCase() === app.bundle_id.toLowerCase()) ||
            (app.name && candidate.name.toLowerCase() === app.name.toLowerCase())
          ),
        );
        if (candidates.length === 1) {
          [resolved] = candidates;
          break;
        }
        await delay(100);
      } while (Date.now() < deadline);
      if (!resolved) {
        throw new DomainError(
          "new_instance_not_found",
          "The launcher did not expose one unambiguous new application process",
        );
      }
    } else {
      const result = ensureHostOK(
        await this.host.call("apps.launch", {
          session: this.host.session,
          app: identity,
          waitForWindowMs: 8_000,
        }),
      );
      if (app.url || app.urls) {
        const flags = app.bundle_id ? ["-b", app.bundle_id] : ["-a", result.name];
        flags.push(...(app.urls ?? [app.url]));
        await this.runProcess("/usr/bin/open", flags);
      }
      resolved = {
        pid: result.pid,
        appId: result.appId,
        name: result.name,
      };
    }

    if (activate) {
      const activation = await this.nativeUtility("activate", [String(resolved.pid)]);
      if (activation.activated !== true || activation.active !== true) {
        throw new DomainError("activation_failed", "The application did not become active");
      }
    }
    const windows = await this.windowsForApp(resolved);
    return toolResult({
      name: resolved.name,
      bundle_id: resolved.appId.startsWith("pid:") ? null : resolved.appId,
      pid: resolved.pid,
      active: activate,
      windows: windows.map((window) => ({
        window_id: window.windowId,
        title: window.title,
      })),
    });
  }

  async listWindows({ app_ref: appRef }) {
    const app = await this.resolveApp(appRef);
    const windows = await this.windowsForApp(app);
    return toolResult(windows.map((window, index) => ({
      index,
      window_id: window.windowId,
      title: window.title,
      bounds: rectArray(window.bounds),
      main: index === 0,
      focused: index === 0,
      pid: window.pid,
      bundle_id: window.appId.startsWith("pid:") ? null : window.appId,
    })));
  }

  async getAppState({
    app_ref: appRef,
    detail = "compact",
    include_screenshot: includeScreenshot = false,
  }) {
    const snapshot = await this.observe(appRef, includeScreenshot);
    return this.presentSnapshot(snapshot, detail);
  }

  async observe(appRef, includeImage) {
    const app = await this.resolveApp(appRef);
    const target = await this.resolveWindow(app, appRef?.window_id);
    const result = ensureHostOK(
      await this.host.call(
        "observe",
        {
          session: this.host.session,
          target: {
            kind: "window",
            pid: target.pid,
            windowId: target.windowId,
          },
          includeImage,
          maxElements: 1500,
          maxDepth: 64,
          maxTextChars: 500,
        },
        { timeoutMs: includeImage ? 30_000 : 20_000 },
      ),
    );
    return result.snapshot;
  }

  async presentSnapshot(snapshot, detail = "compact") {
    const elements = snapshot.elements.map((element, index) => {
      const local = element.frame;
      const bounds = local
        ? [
            snapshot.target.bounds.x + local.x,
            snapshot.target.bounds.y + local.y,
            local.width,
            local.height,
          ]
        : null;
      const name = element.label ?? element.title ?? element.axIdentifier ?? "";
      return {
        index,
        kind: KIND_BY_ROLE.get(element.role) ?? element.role.replace(/^AX/u, "").toLowerCase(),
        name,
        enabled: element.enabled,
        focused: element.focused,
        editable: ["AXTextField", "AXTextArea", "AXSearchField", "AXSecureTextField", "AXComboBox"].includes(element.role),
        pressable: element.actions.includes("press"),
        has_menu: element.actions.includes("show_menu"),
        ...(detail === "full"
          ? {
              role: element.role,
              subrole: element.subrole,
              identifier: element.axIdentifier,
              title: element.title,
              label: element.label,
              value: element.value,
              placeholder: element.placeholder,
              selected: element.selected,
              bounds,
              actions: element.actions,
            }
          : {}),
        _native: {
          token: element.token,
          digest: element.digest,
          localFrame: local,
        },
      };
    });
    const state = this.states.issueState({
      snapshotId: snapshot.snapshotId,
      windowDigest: snapshot.windowDigest,
      target: snapshot.target,
      elements,
      focusedElementToken: snapshot.focusedElementToken,
      image: snapshot.image,
      displays: snapshot.displays,
    });
    const publicElements = elements.map(({ _native, ...element }) => element);
    const payload = {
      state_id: state.state_id,
      app: {
        bundle_id: snapshot.target.appId.startsWith("pid:") ? null : snapshot.target.appId,
        pid: snapshot.target.pid,
        name: snapshot.target.appName,
      },
      window: {
        window_id: snapshot.target.windowId,
        title: snapshot.target.title,
        bounds: rectArray(snapshot.target.bounds),
      },
      elements: publicElements,
      truncated: snapshot.truncated,
    };

    if (!snapshot.image) return toolResult(payload);
    const frame = this.issueWindowFrame(snapshot, state);
    payload.image_ref = this.publicImageRef(frame);
    return imageResult({
      path: snapshot.image.path,
      format: snapshot.image.format,
      imageRef: payload.image_ref,
      text: JSON.stringify(payload, null, 2),
    });
  }

  issueWindowFrame(snapshot, state = null) {
    return this.frames.issueFrame({
      actionable: true,
      kind: "window",
      path: snapshot.image.path,
      format: snapshot.image.format,
      width: snapshot.image.widthPx,
      height: snapshot.image.heightPx,
      sha256: snapshot.image.sha256,
      screenRect: snapshot.target.bounds,
      snapshotId: snapshot.snapshotId,
      windowDigest: snapshot.windowDigest,
      target: snapshot.target,
      elements: snapshot.elements,
      sourceStateId: state?.state_id ?? null,
    });
  }

  publicImageRef(frame) {
    return {
      frame_id: frame.frame_id,
      width: frame.width,
      height: frame.height,
      format: frame.format,
      actionable: frame.actionable,
      sha256: frame.sha256,
    };
  }

  async screenshot() {
    const displays = await this.getDisplays();
    const display = displays[this.selectedDisplayIndex];
    if (!display) throw new DomainError("display_unknown", "Selected display is no longer attached");
    const result = ensureHostOK(
      await this.host.call("screen.capture", {
        session: this.host.session,
        displayId: display.displayId,
      }),
    );
    const windows = ensureHostOK(
      await this.host.call("window.list", { session: this.host.session }),
    ).windows;
    const frame = this.frames.issueFrame({
      actionable: true,
      kind: "display",
      path: result.image.path,
      format: result.image.format,
      width: result.image.widthPx,
      height: result.image.heightPx,
      sha256: result.image.sha256,
      screenRect: display.bounds,
      display,
      windows,
    });
    return imageResult({
      path: result.image.path,
      format: result.image.format,
      imageRef: this.publicImageRef(frame),
      text: JSON.stringify({
        screenshot_display: display,
      }),
    });
  }

  async zoom({ frame_id: frameId, region, target }) {
    let source = this.frames.resolve(frameId);
    let crop;
    if (target?.type === "element") {
      const resolved = this.resolveElement(target);
      if (!resolved.element._native.localFrame) {
        throw new DomainError("element_has_no_bounds", "The element has no visual bounds");
      }
      const local = resolved.element._native.localFrame;
      const global = {
        x: resolved.state.target.bounds.x + local.x,
        y: resolved.state.target.bounds.y + local.y,
        width: local.width,
        height: local.height,
      };
      source = this.findFrameForState(resolved.state) ?? source;
      crop = this.screenRectToFrameCrop(source, global);
    } else if (target?.type === "coordinate") {
      const point = this.framePoint(source, target);
      const halfWidth = Math.min(source.width / 4, 320);
      const halfHeight = Math.min(source.height / 4, 240);
      crop = [
        Math.max(0, target.x - halfWidth),
        Math.max(0, target.y - halfHeight),
        Math.min(source.width, halfWidth * 2),
        Math.min(source.height, halfHeight * 2),
      ];
      void point;
    } else if (Array.isArray(region) && region.length === 4) {
      crop = region.map(Number);
    } else {
      throw new DomainError("invalid_zoom", "zoom requires region or target");
    }
    const [x, y, width, height] = normalizeCrop(crop, source.width, source.height);
    const output = path.join(this.host.imageDir, `zoom-${randomUUID()}.png`);
    await copyFile(source.path, output);
    await runProcess("/usr/bin/sips", [
      "-c",
      String(Math.round(height)),
      String(Math.round(width)),
      "--cropOffset",
      String(Math.round(y)),
      String(Math.round(x)),
      output,
      "--out",
      output,
    ]);
    const metadata = await imageMetadata(output);
    const screenRect = {
      x: source.screenRect.x + (x / source.width) * source.screenRect.width,
      y: source.screenRect.y + (y / source.height) * source.screenRect.height,
      width: (width / source.width) * source.screenRect.width,
      height: (height / source.height) * source.screenRect.height,
    };
    const frame = this.frames.issueFrame({
      ...source,
      path: output,
      width: metadata.width,
      height: metadata.height,
      sha256: metadata.sha256,
      screenRect,
      kind: "zoom",
      parentFrameId: source.frame_id,
    });
    return imageResult({
      path: output,
      format: "png",
      imageRef: this.publicImageRef(frame),
    });
  }

  async listDisplays() {
    return toolResult(await this.getDisplays());
  }

  async getDisplays() {
    return this.nativeUtility("displays");
  }

  async switchDisplay({ index }) {
    const displays = await this.getDisplays();
    if (!Number.isInteger(index) || index < 0 || index >= displays.length) {
      throw new DomainError("display_unknown", `Display index ${index} is unavailable`);
    }
    this.selectedDisplayIndex = index;
    return toolResult({ selected: displays[index] });
  }

  async click(args, button, count) {
    if (parseModifiers(args.modifiers).length > 0) {
      throw new DomainError(
        "unsupported_modifier",
        "Modified pointer clicks are not supported by the current open native protocol",
      );
    }
    if (args.target?.type === "element" && args.strategy !== "event") {
      if (button === "left" && count === 1) {
        return this.elementAction(args.target, args, { kind: "click", button, count });
      }
      if (button === "right" && count === 1) {
        const resolved = this.resolveElement(args.target);
        if (!resolved.element.actions.includes("show_menu")) {
          throw new DomainError(
            "element_not_actionable",
            "The element does not expose an accessibility menu action",
          );
        }
        return this.elementAction(args.target, args, {
          kind: "secondary_action",
          action: "show_menu",
        });
      }
      throw new DomainError(
        "no_accessibility_equivalent",
        "This pointer action requires strategy=event and an image-backed target",
      );
    }
    if (args.strategy === "a11y") {
      throw new DomainError("element_required", "strategy=a11y requires an element target");
    }
    const kind = button === "left"
      ? count === 1 ? "left_click" : count === 2 ? "double_click" : "triple_click"
      : `${button}_click`;
    if ((button === "left" || button === "right") && count === 1 && args.strategy !== "event") {
      return this.actions.run(async () => {
        const resolved = await this.resolvePoint(args.target);
        const expectedAction = button === "left" ? "press" : "show_menu";
        const element = this.hitTestNativeElement(
          resolved.snapshot,
          resolved.screenPoint,
          (candidate) => candidate.actions?.includes(expectedAction),
        );
        if (!element) {
          if (args.strategy === "a11y") {
            throw new DomainError(
              "element_not_actionable",
              `No accessibility element exposing ${expectedAction} contains the target point`,
            );
          }
          return this.dispatchPoint(resolved, args, { kind, count });
        }
        const state = this.findStateBySnapshot(resolved.snapshot.snapshotId);
        const hostResult = await this.callMutation("dispatch.element", {
          session: this.host.session,
          snapshotId: resolved.snapshot.snapshotId,
          toolCallId: `call-${randomUUID()}`,
          elementToken: element.token,
          expectElementDigest: element.digest,
          strictness: "element",
          occlusionPolicy: "same_app",
          action: button === "left"
            ? { kind: "click", button, count }
            : { kind: "secondary_action", action: "show_menu" },
        }, { state, frame: resolved.frame });
        return this.finishAction(hostResult, state, args.return_state, resolved.frame);
      });
    }
    return this.pointAction(args.target, args, { kind, count });
  }

  async scroll(args) {
    if (args.target?.type === "element" && args.strategy !== "event") {
      throw new DomainError(
        "no_accessibility_equivalent",
        "Scroll is a raw event; use strategy=event with a bound target",
      );
    }
    if (args.strategy === "a11y") {
      throw new DomainError("no_accessibility_equivalent", "Scroll has no accessibility-only route");
    }
    const pages = Math.max(0, Math.min(100, Number(args.scroll_amount)));
    if (pages === 0) {
      return toolResult({
        action_receipt: actionReceipt({
          actionSent: false,
          dispatchStatus: "not_sent",
        }),
      });
    }
    return this.pointAction(args.target, args, {
      kind: "scroll",
      direction: args.scroll_direction,
      pages,
    });
  }

  async drag(args) {
    if (parseModifiers(args.modifiers).length > 0) {
      throw new DomainError(
        "unsupported_modifier",
        "Modified drags are not supported by the current open native protocol",
      );
    }
    return this.actions.run(async () => {
      const from = await this.resolvePoint(args.from_target);
      const to = await this.resolvePointAgainst(args.to, from);
      return this.dispatchPoint(from, args, {
        kind: "drag",
        startPoint: from.imagePoint,
        point: to.imagePoint,
      });
    });
  }

  async resolvePointAgainst(target, anchor) {
    let screenPoint;
    let frame = anchor.frame;
    if (target?.type === "element") {
      const resolved = this.resolveElement(target);
      if (
        resolved.state.target.pid !== anchor.snapshot.target.pid ||
        resolved.state.target.windowId !== anchor.snapshot.target.windowId
      ) {
        throw new DomainError("cross_window_drag", "Drag endpoints must resolve to the same observed window");
      }
      const local = resolved.element._native.localFrame;
      if (!local) {
        throw new DomainError("element_has_no_bounds", "The target element has no bounds");
      }
      screenPoint = center({
        x: resolved.state.target.bounds.x + local.x,
        y: resolved.state.target.bounds.y + local.y,
        width: local.width,
        height: local.height,
      });
    } else if (target?.type === "coordinate") {
      frame = this.frames.resolve(target.frame_id);
      screenPoint = this.framePoint(frame, target);
    } else {
      throw new DomainError("invalid_target", "A coordinate or element target is required");
    }
    if (!contains(anchor.snapshot.target.bounds, screenPoint)) {
      throw new DomainError("cross_window_drag", "Drag endpoints must resolve to the same observed window");
    }
    return this.pointForSnapshot(anchor.snapshot, screenPoint, frame);
  }

  async mouseDown(args) {
    return this.actions.run(async () => {
      if (this.pointerHold) {
        throw new DomainError("mouse_already_down", "This session is already holding the left mouse button");
      }
      const resolved = await this.resolvePoint(args.target);
      const result = await this.dispatchPoint(
        resolved,
        { ...args, return_state: "none" },
        { kind: "mouse_down" },
      );
      if (result.isError) return result;

      const snapshot = await this.observe(
        {
          pid: resolved.snapshot.target.pid,
          window_id: resolved.snapshot.target.windowId,
        },
        true,
      );
      this.pointerHold = this.pointForSnapshot(snapshot, resolved.screenPoint);
      if (!args.return_state || args.return_state === "none") return result;
      const observed = await this.presentSnapshot(snapshot, args.return_state);
      return { ...result, content: [...result.content, ...observed.content] };
    });
  }

  async mouseUp(args) {
    return this.actions.run(async () => {
      if (!this.pointerHold) {
        return toolError(
          new DomainError(
            "mouse_not_down",
            "This session has not successfully called left_mouse_down",
          ),
          {
            action_receipt: actionReceipt({
              actionSent: false,
              dispatchStatus: "not_sent",
            }),
          },
        );
      }
      const held = this.pointerHold;
      this.pointerHold = null;
      return this.dispatchPoint(held, args, { kind: "mouse_up" });
    });
  }

  async typeText(args) {
    if (!args.target && !args.app_ref) {
      throw new DomainError(
        "target_required",
        "macOS typing requires an element, coordinate, or app_ref target",
      );
    }
    const binding = await this.resolveKeyboardBinding(args.target, args.app_ref);
    if (args.target && args.strategy !== "event") {
      if (!binding.element.editable) {
        throw new DomainError("element_not_editable", "The target element is not editable");
      }
      return this.elementAction(
        {
          type: "element",
          state_id: binding.state.state_id,
          index: binding.element.index,
        },
        args,
        { kind: "set_value", value: args.text },
      );
    }
    if (!args.target && args.strategy === "a11y") {
      throw new DomainError(
        "element_required",
        "strategy=a11y requires an editable element or coordinate target",
      );
    }
    return this.dispatchKey(binding, args, { kind: "type", text: args.text });
  }

  async setValue(args) {
    if (args.strategy === "event") {
      throw new DomainError(
        "unsupported_strategy",
        "Event-based replacement is not implemented; use type with strategy=event",
      );
    }
    const target = await this.resolveElementTarget(
      args.target,
      (element) => ["AXTextField", "AXTextArea", "AXSearchField", "AXSecureTextField", "AXComboBox", "AXSlider", "AXIncrementor"].includes(element.role),
      "No settable accessibility element contains the target point",
    );
    return this.elementAction(target, args, {
      kind: "set_value",
      value: args.value,
    });
  }

  async key(args) {
    if (!args.app_ref) {
      throw new DomainError("app_ref_required", "macOS key input requires app_ref");
    }
    const binding = await this.resolveKeyboardBinding(null, args.app_ref);
    const chord = parseKeyChord(args.text);
    const count = Math.max(0, Math.min(100, args.repeat ?? 1));
    if (count === 0) {
      return toolResult({
        action_receipt: actionReceipt({
          actionSent: false,
          dispatchStatus: "not_sent",
        }),
      });
    }
    let result;
    for (let index = 0; index < count; index += 1) {
      result = await this.dispatchKey(binding, { ...args, return_state: "none" }, {
        kind: "key",
        ...chord,
      });
      if (result.isError) return result;
      if (index + 1 < count) {
        binding.state = await this.observeStateForTarget(binding.state.target);
        binding.element = this.focusedElement(binding.state);
      }
    }
    return args.return_state && args.return_state !== "none"
      ? this.observeAfter(binding.state.target, args.return_state, result)
      : result;
  }

  async holdKey(args) {
    if (!args.app_ref) {
      throw new DomainError("app_ref_required", "macOS hold_key requires app_ref");
    }
    const binding = await this.resolveKeyboardBinding(null, args.app_ref);
    const chord = parseKeyChord(args.text);
    const duration = Math.max(0, Math.min(30, Number(args.duration)));
    if (!Number.isFinite(duration)) {
      throw new DomainError("invalid_duration", "duration must be finite");
    }
    const response = await this.actions.run(() =>
      this.nativeUtility(
        "hold-key",
        [
          String(binding.state.target.pid),
          chord.key,
          String(duration),
          ...chord.modifiers,
        ],
        { timeoutMs: (duration + 5) * 1000 },
      ),
    );
    this.states.consume(binding.state.state_id);
    const result = toolResult({
      action_receipt: actionReceipt({
        actionSent: response.actionSent ?? response.action_sent ?? true,
        dispatchStatus: response.dispatchStatus ?? response.dispatch_status ?? "accepted",
        path: "cg_event_pid",
      }),
    });
    return args.return_state && args.return_state !== "none"
      ? this.observeAfter(binding.state.target, args.return_state, result)
      : result;
  }

  async selectText(args) {
    const target = await this.resolveElementTarget(
      args.target,
      (element) => ["AXTextField", "AXTextArea", "AXSearchField", "AXSecureTextField", "AXComboBox"].includes(element.role),
      "No selectable text element contains the target point",
    );
    const resolved = this.resolveElement(target);
    const value = resolved.element.value ?? "";
    let selected = "";
    if (Array.isArray(args.text_range)) {
      const [location, length] = args.text_range.map(Number);
      if (
        !Number.isInteger(location) ||
        !Number.isInteger(length) ||
        location < 0 ||
        length < 0
      ) {
        throw new DomainError("invalid_text_range", "text_range must contain a non-negative UTF-16 location and length");
      }
      selected = utf16Slice(value, location, length);
    }
    return this.elementAction(target, args, {
      kind: "select_text",
      text: selected,
    });
  }

  async performAction(args) {
    const target = await this.resolveElementTarget(
      args.target,
      (element) => element.actions?.length > 0,
      "No actionable accessibility element contains the target point",
    );
    const resolved = this.resolveElement(target);
    const requested = args.action.trim().toLowerCase().replaceAll("-", "_");
    const action = resolved.element.actions.includes(requested)
      ? requested
      : ACTION_ALIAS.get(requested) ?? requested;
    if (!resolved.element.actions.includes(action)) {
      throw new DomainError(
        "unsupported_action",
        `Element does not advertise action ${JSON.stringify(args.action)}`,
      );
    }
    return this.elementAction(target, args, {
      kind: "secondary_action",
      action,
    });
  }

  async elementAction(target, args, action) {
    return this.actions.run(async () => {
      const resolved = this.resolveElement(target);
      if (!resolved.element.enabled) {
        throw new DomainError("element_disabled", "The target element is disabled");
      }
      const frame = this.findFrameForState(resolved.state);
      const hostResult = await this.callMutation("dispatch.element", {
        session: this.host.session,
        snapshotId: resolved.state.snapshotId,
        toolCallId: `call-${randomUUID()}`,
        elementToken: resolved.element._native.token,
        expectElementDigest: resolved.element._native.digest,
        strictness: "element",
        occlusionPolicy: "same_app",
        action,
      }, { state: resolved.state, frame });
      return this.finishAction(hostResult, resolved.state, args.return_state, frame);
    });
  }

  async pointAction(target, args, action) {
    return this.actions.run(async () => {
      const resolved = await this.resolvePoint(target);
      return this.dispatchPoint(resolved, args, action);
    });
  }

  async dispatchPoint(resolved, args, action) {
    const state = this.findStateBySnapshot(resolved.snapshot.snapshotId);
    const hostResult = await this.callMutation("dispatch.point", {
      session: this.host.session,
      snapshotId: resolved.snapshot.snapshotId,
      toolCallId: `call-${randomUUID()}`,
      expectWindowDigest: resolved.snapshot.windowDigest,
      point: action.point ?? resolved.imagePoint,
      ...(action.startPoint ? { startPoint: action.startPoint } : {}),
      space: "image_px",
      occlusionPolicy: "any",
      action: Object.fromEntries(
        Object.entries(action).filter(([key]) => !["point", "startPoint"].includes(key)),
      ),
    }, { state, frame: resolved.frame });
    return this.finishAction(hostResult, state, args.return_state, resolved.frame);
  }

  async dispatchKey(binding, args, action) {
    return this.actions.run(async () => {
      const frame = this.findFrameForState(binding.state);
      const hostResult = await this.callMutation("dispatch.key", {
        session: this.host.session,
        snapshotId: binding.state.snapshotId,
        toolCallId: `call-${randomUUID()}`,
        focusToken: binding.element._native.token,
        expectElementDigest: binding.element._native.digest,
        focusPolicy: "acquire",
        action,
      }, { state: binding.state, frame });
      return this.finishAction(hostResult, binding.state, args.return_state, frame);
    });
  }

  async callMutation(method, params, { state = null, frame = null } = {}) {
    try {
      return await this.host.call(method, params);
    } catch (error) {
      if (error instanceof HostTransportError && error.delivery === "possibly_sent") {
        this.invalidateActionInputs(state, frame, "outcome_unknown");
      }
      throw error;
    }
  }

  invalidateActionInputs(state, frame, status = "spent") {
    if (state?.state_id) this.states.consume(state.state_id, status);
    const boundFrame = frame ?? (state ? this.findFrameForState(state) : null);
    if (boundFrame?.frame_id) this.frames.consume(boundFrame.frame_id, status);
  }

  async finishAction(hostResult, state, returnState = "none", frame = null) {
    const mayHaveSent =
      hostResult?.ok === true ||
      hostResult?.outcome === "unknown" ||
      hostResult?.error?.code === "outcome_unknown";
    if (mayHaveSent && state?.state_id) {
      this.invalidateActionInputs(state, frame);
    } else if (mayHaveSent && frame?.frame_id) {
      this.frames.consume(frame.frame_id);
    }
    if (hostResult?.ok === false) {
      const receipt = actionReceipt({
        actionSent: mayHaveSent,
        dispatchStatus: mayHaveSent ? "possibly_sent" : "not_sent",
        path: hostResult.path ?? "none",
        effect: hostResult.effect ?? "unverifiable",
      });
      return toolError(
        new DomainError(
          hostResult.error?.code ?? "dispatch_refused",
          hostResult.error?.message ?? "Native executor refused the action",
          hostResult.error?.detail,
        ),
        { action_receipt: receipt },
      );
    }
    const receipt = actionReceipt({
      actionSent: true,
      dispatchStatus: hostResult.outcome === "unknown" ? "possibly_sent" : "accepted",
      path: hostResult.path,
      effect: hostResult.effect,
    });
    const result = toolResult({ action_receipt: receipt });
    if (returnState && returnState !== "none" && state) {
      return this.observeAfter(state.target, returnState, result);
    }
    return result;
  }

  async observeAfter(target, detail, baseResult) {
    const snapshot = await this.observe(
      { pid: target.pid, window_id: target.windowId },
      false,
    );
    const observed = await this.presentSnapshot(snapshot, detail);
    return {
      ...baseResult,
      content: [...baseResult.content, ...observed.content],
    };
  }

  resolveElement(target) {
    if (target?.type !== "element") {
      throw new DomainError("element_required", "An element target is required");
    }
    const state = this.states.get(target.state_id);
    const element = state.elements[target.index];
    if (!element) {
      throw new DomainError("element_unknown", `Element index ${target.index} is not in ${target.state_id}`);
    }
    return { state, element };
  }

  async resolvePoint(target) {
    if (target?.type === "element") {
      const resolved = this.resolveElement(target);
      const local = resolved.element._native.localFrame;
      if (!local) {
        throw new DomainError("element_has_no_bounds", "The target element has no bounds");
      }
      const screenPoint = center({
        x: resolved.state.target.bounds.x + local.x,
        y: resolved.state.target.bounds.y + local.y,
        width: local.width,
        height: local.height,
      });
      if (!resolved.state.image) {
        const snapshot = await this.observe(
          {
            pid: resolved.state.target.pid,
            window_id: resolved.state.target.windowId,
          },
          true,
        );
        return this.pointForSnapshot(snapshot, screenPoint);
      }
      return this.pointForState(resolved.state, screenPoint);
    }
    if (target?.type !== "coordinate") {
      throw new DomainError("invalid_target", "A coordinate or element target is required");
    }
    const frame = this.frames.resolve(target.frame_id);
    const screenPoint = this.framePoint(frame, target);
    if (frame.snapshotId) {
      return {
        frame,
        screenPoint,
        snapshot: {
          snapshotId: frame.snapshotId,
          windowDigest: frame.windowDigest,
          target: frame.target,
          elements: frame.elements,
        },
        imagePoint: {
          x: (screenPoint.x - frame.target.bounds.x) *
            (frame.width / frame.screenRect.width),
          y: (screenPoint.y - frame.target.bounds.y) *
            (frame.height / frame.screenRect.height),
        },
      };
    }
    return this.pointFromDisplayFrame(frame, screenPoint);
  }

  framePoint(frame, target) {
    if (
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      target.x < 0 ||
      target.y < 0 ||
      target.x >= frame.width ||
      target.y >= frame.height
    ) {
      throw new DomainError("invalid_point", "Coordinate is outside the referenced raster");
    }
    return {
      x: frame.screenRect.x + (target.x / frame.width) * frame.screenRect.width,
      y: frame.screenRect.y + (target.y / frame.height) * frame.screenRect.height,
    };
  }

  async pointFromDisplayFrame(frame, screenPoint) {
    const candidate = frame.windows
      .filter((window) => window.onScreen && window.layer === 0 && contains(window.bounds, screenPoint))
      .sort((left, right) => right.zIndex - left.zIndex)[0];
    if (!candidate) {
      throw new DomainError("window_owner_unknown", "No captured application window owns this display pixel");
    }
    const snapshot = await this.observe(
      { pid: candidate.pid, window_id: candidate.windowId },
      true,
    );
    if (
      snapshot.target.bounds.x !== candidate.bounds.x ||
      snapshot.target.bounds.y !== candidate.bounds.y ||
      snapshot.target.bounds.width !== candidate.bounds.width ||
      snapshot.target.bounds.height !== candidate.bounds.height
    ) {
      throw new DomainError("window_changed", "The window moved or resized after the display screenshot");
    }
    return this.pointForSnapshot(snapshot, screenPoint, frame);
  }

  pointForState(state, screenPoint) {
    return this.pointForSnapshot(
      {
        snapshotId: state.snapshotId,
        windowDigest: state.windowDigest,
        target: state.target,
        image: state.image,
      },
      screenPoint,
      this.findFrameForState(state),
    );
  }

  pointForSnapshot(snapshot, screenPoint, frame = null) {
    const scale = snapshot.image?.scale ?? frame?.width / frame?.screenRect?.width;
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new DomainError("image_required", "Coordinate dispatch requires a captured window image");
    }
    return {
      frame,
      snapshot,
      screenPoint,
      imagePoint: {
        x: (screenPoint.x - snapshot.target.bounds.x) * scale,
        y: (screenPoint.y - snapshot.target.bounds.y) * scale,
      },
    };
  }

  hitTestActionableElement(snapshot, screenPoint) {
    return this.hitTestNativeElement(
      snapshot,
      screenPoint,
      (element) => element.actions?.includes("press"),
    );
  }

  hitTestNativeElement(snapshot, screenPoint, predicate = () => true) {
    const localPoint = {
      x: screenPoint.x - snapshot.target.bounds.x,
      y: screenPoint.y - snapshot.target.bounds.y,
    };
    const candidates = (snapshot.elements ?? [])
      .filter((element) =>
        element.enabled &&
        predicate(element) &&
        element.frame &&
        contains(
          element.frame,
          localPoint,
        ),
      )
      .sort((left, right) => {
        const depth = (right.depth ?? 0) - (left.depth ?? 0);
        if (depth !== 0) return depth;
        return left.frame.width * left.frame.height - right.frame.width * right.frame.height;
      });
    return candidates[0] ?? null;
  }

  async resolveElementTarget(target, predicate, failureMessage) {
    if (target?.type === "element") return target;
    const resolved = await this.resolvePoint(target);
    const nativeElement = this.hitTestNativeElement(
      resolved.snapshot,
      resolved.screenPoint,
      predicate,
    );
    if (!nativeElement) {
      throw new DomainError("element_not_found", failureMessage);
    }
    let state = this.findStateBySnapshot(resolved.snapshot.snapshotId);
    if (!state) {
      await this.presentSnapshot(resolved.snapshot, "full");
      state = this.findStateBySnapshot(resolved.snapshot.snapshotId);
    }
    const index = state.elements.findIndex(
      (element) => element._native.token === nativeElement.token,
    );
    if (index < 0) {
      throw new DomainError("element_not_found", failureMessage);
    }
    return { type: "element", state_id: state.state_id, index };
  }

  async resolveKeyboardBinding(target, appRef) {
    if (target?.type === "element") {
      const resolved = this.resolveElement(target);
      return { state: resolved.state, element: resolved.element };
    }
    if (target?.type === "coordinate") {
      const elementTarget = await this.resolveElementTarget(
        target,
        (element) => ["AXTextField", "AXTextArea", "AXSearchField", "AXSecureTextField", "AXComboBox"].includes(element.role),
        "No editable accessibility element contains the target point",
      );
      const resolved = this.resolveElement(elementTarget);
      return { state: resolved.state, element: resolved.element };
    }
    const snapshot = await this.observe(appRef, false);
    const presented = await this.presentSnapshot(snapshot, "full");
    void presented;
    const state = this.findStateBySnapshot(snapshot.snapshotId);
    return { state, element: this.focusedElement(state) };
  }

  focusedElement(state) {
    const element = state.elements.find(
      (candidate) => candidate._native.token === state.focusedElementToken,
    );
    if (!element) {
      throw new DomainError(
        "focused_element_unknown",
        "The target application does not expose a focused accessibility element",
      );
    }
    return element;
  }

  findStateBySnapshot(snapshotId) {
    for (const state of this.states.entries.values()) {
      if (state.snapshotId === snapshotId) return state;
    }
    return null;
  }

  findFrameForState(state) {
    for (const frame of [...this.frames.entries.values()].reverse()) {
      if (frame.snapshotId === state.snapshotId) return frame;
    }
    return null;
  }

  screenRectToFrameCrop(frame, rect) {
    return [
      ((rect.x - frame.screenRect.x) / frame.screenRect.width) * frame.width,
      ((rect.y - frame.screenRect.y) / frame.screenRect.height) * frame.height,
      (rect.width / frame.screenRect.width) * frame.width,
      (rect.height / frame.screenRect.height) * frame.height,
    ];
  }

  async resolveApp(appRef = {}, { allowName = true } = {}) {
    const result = ensureHostOK(
      await this.host.call("apps.list", { session: this.host.session }),
    );
    let matches = result.apps;
    if (appRef.pid !== undefined) {
      matches = matches.filter((app) => app.pid === appRef.pid);
    } else if (appRef.bundle_id) {
      matches = matches.filter((app) => app.appId.toLowerCase() === appRef.bundle_id.toLowerCase());
    } else if (allowName && appRef.name) {
      matches = matches.filter((app) => app.name.toLowerCase() === appRef.name.toLowerCase());
    } else {
      throw new DomainError("invalid_app_ref", "app_ref requires pid, bundle_id, or name");
    }
    if (matches.length !== 1) {
      throw new DomainError(
        matches.length === 0 ? "app_not_found" : "app_ambiguous",
        `Application reference resolved to ${matches.length} running applications`,
      );
    }
    return matches[0];
  }

  async windowsForApp(app) {
    const result = ensureHostOK(
      await this.host.call("window.list", { session: this.host.session }),
    );
    return result.windows.filter(
      (window) => window.pid === app.pid && window.appId === app.appId,
    );
  }

  async resolveWindow(app, requestedWindowId) {
    const windows = await this.windowsForApp(app);
    const candidates = requestedWindowId === undefined
      ? windows
      : windows.filter((window) => window.windowId === requestedWindowId);
    if (candidates.length === 0) {
      throw new DomainError("window_gone", "No matching application window is available");
    }
    return [...candidates].sort((left, right) => right.zIndex - left.zIndex)[0];
  }

  async observeStateForTarget(target) {
    const snapshot = await this.observe(
      { pid: target.pid, window_id: target.windowId },
      false,
    );
    await this.presentSnapshot(snapshot, "full");
    return this.findStateBySnapshot(snapshot.snapshotId);
  }

  async requestAccess(args) {
    const permissions = ensureHostOK(
      await this.host.call("permissions.check", { prompt: false }),
    );
    return toolResult({
      platform: "darwin",
      requested_capabilities: args.capabilities ?? [],
      accessibility: permissions.accessibility,
      screen_recording: permissions.screenRecording,
      screen_recording_probe: permissions.screenRecordingProbe,
      side_effects: {
        permission_prompted: false,
      },
      guard: {
        stopped: this.stopped,
        stop_reason: this.stopReason,
      },
    });
  }

  async stop({ reason = null }) {
    if (!this.stopped) {
      this.stopped = true;
      this.stopReason = reason;
    }
    const released = await this.actions.run(() => this.releaseHeldPointer());
    this.states.clear("stopped");
    this.frames.clear("stopped");
    return toolResult({
      stopped: true,
      reason: this.stopReason,
      released_left_mouse: released,
    });
  }

  async releaseHeldPointer() {
    if (!this.pointerHold) return false;
    const held = this.pointerHold;
    this.pointerHold = null;
    try {
      const result = await this.dispatchPoint(
        held,
        { return_state: "none" },
        { kind: "mouse_up" },
      );
      return result.isError !== true;
    } catch {
      return false;
    }
  }

  async wait({ duration }) {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new DomainError("invalid_duration", "duration must be a non-negative finite number");
    }
    const bounded = Math.min(duration, 30);
    await delay(bounded * 1000);
    return toolResult({
      waited_seconds: bounded,
      clamped: bounded !== duration,
    });
  }
}

function normalizeCrop(region, maxWidth, maxHeight) {
  let [x, y, width, height] = region;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new DomainError("invalid_zoom", "Zoom region must contain finite positive dimensions");
  }
  x = Math.max(0, Math.min(x, maxWidth - 1));
  y = Math.max(0, Math.min(y, maxHeight - 1));
  width = Math.max(1, Math.min(width, maxWidth - x));
  height = Math.max(1, Math.min(height, maxHeight - y));
  return [x, y, width, height];
}

async function imageMetadata(file) {
  const output = await runProcess("/usr/bin/sips", [
    "-g",
    "pixelWidth",
    "-g",
    "pixelHeight",
    file,
  ]);
  const width = Number(/pixelWidth:\s*(\d+)/u.exec(output)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/u.exec(output)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("Could not read cropped image dimensions");
  }
  const bytes = await readFile(file);
  const info = await stat(file);
  return {
    width,
    height,
    byteLength: info.size,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

function utf16Slice(value, location, length) {
  const units = [];
  for (let index = 0; index < value.length; index += 1) {
    units.push(value.charCodeAt(index));
  }
  if (location + length > units.length) {
    throw new DomainError("invalid_text_range", "text_range exceeds the current element value");
  }
  return String.fromCharCode(...units.slice(location, location + length));
}

export { DomainError, RegistryError };
