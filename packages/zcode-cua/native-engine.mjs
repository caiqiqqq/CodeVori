import { createSessionCursor } from "./native-session-cursor.mjs";
import { randomUUID } from "node:crypto";
import { toolError, toolResult } from "./vendor/open-zcode-computer-use/src/results.mjs";
import { dispatchNativeAction } from "./native-input.mjs";
import { sameBounds, validBounds, fail, appMatches, assertOutcome } from "./native-guards.mjs";
import { ACTIONS, validateToolRequest } from "./runtime-contract.mjs";

const MAX_STATES = 16;
const TTL = 30_000;
// 原生句柄只能留在单个 helper 内；跨会话、刷新后或动作后的旧状态均不能再次授权输入。
export class NativeEngine {
  constructor({
    native,
    platform = process.platform,
    now = Date.now,
    withRunLoop = (run) => run(),
  }) {
    this.session = randomUUID();
    this.cursor = createSessionCursor(native, this.session);
    this.native = this.cursor.native;
    this.platform = platform;
    this.now = now;
    this.withRunLoop = withRunLoop;
    this.states = new Map();
    this.stopped = false;
  }

  permissions() {
    if (this.platform === "win32") {
      const interactive = this.native.isInteractiveSession?.() === true;
      return {
        accessibility: interactive,
        screenRecording: interactive && this.native.isScreenCaptureSupported?.() === true,
        interactive,
      };
    }
    return {
      accessibility: this.native.isTrusted() === true,
      screenRecording: this.native.screenCaptureStatus() === "granted",
    };
  }

  assertPermission(app) {
    if (this.platform === "win32") {
      if (this.native.isInteractiveSession?.() !== true)
        fail("permission_denied", "Computer control requires an interactive Windows desktop.");
      if (this.native.isTargetElevated?.(app.pid) !== false)
        fail(
          "permission_denied",
          "Windows UIPI blocks this elevated or unverified target. Use an application running at the same integrity level.",
        );
    } else if (!this.native.isTrusted())
      fail("permission_denied", "Grant Accessibility permission to CodeVori in System Settings.");
  }

  async resolveApp(ref, launch = false) {
    let apps = await this.native.listApplications();
    let matches = apps.filter((app) => appMatches(app, ref));
    if (!matches.length && launch && ref.pid === undefined) {
      if (this.platform === "darwin" && this.native.openApplicationInBackgroundAsync) {
        const pid = await this.native.openApplicationInBackgroundAsync(
          ref.bundle_id ?? null,
          ref.name ?? null,
        );
        const app = typeof pid === "number" ? await this.native.applicationInfo(pid) : null;
        apps = app ? [app] : await this.native.listApplications();
      } else if (
        this.platform === "win32" &&
        this.native.listInstalledApplicationsAsync &&
        this.native.launchApplicationAsync
      ) {
        const installed = (await this.native.listInstalledApplicationsAsync()).filter((app) =>
          ref.name
            ? app.name?.toLowerCase() === ref.name.toLowerCase()
            : app.target_path === ref.bundle_id,
        );
        if (installed.length !== 1)
          fail(
            "app_not_found",
            "No unique installed application matches; call list_apps and use its exact identity.",
          );
        const selected = installed[0];
        if (/uninstall/i.test(selected.target_path ?? ""))
          fail("app_not_found", "Refusing to launch an uninstaller.");
        const pid = await this.native.launchApplicationAsync(
          selected.aumid ?? null,
          selected.target_path ?? null,
        );
        const app =
          Number.isSafeInteger(pid) && pid > 0 ? await this.native.applicationInfo(pid) : null;
        apps = app ? [app] : await this.native.listApplications();
      }
      matches = apps.filter((app) => appMatches(app, ref));
    }
    if (matches.length !== 1)
      fail(
        matches.length ? "app_ambiguous" : "app_not_found",
        "Resolve an exact application using list_apps before retrying.",
      );
    const app = matches[0];
    if (!Number.isSafeInteger(app.pid) || app.pid <= 0 || !app.bundle_id)
      fail("element_unavailable", "Native application identity is incomplete.");
    this.assertPermission(app);
    return app;
  }

  release(state) {
    if (state.epoch) this.native.releaseCaptureEpoch?.(state.app.pid, state.epoch);
    this.states.delete(state.id);
  }

  async verify(state) {
    if (!state || this.now() - state.created >= TTL)
      fail("stale_state", "Observe this application again; the state has expired or was consumed.");
    const app = await this.native.applicationInfo(state.app.pid);
    if (!appMatches(app, { pid: state.app.pid, bundle_id: state.app.bundle_id }))
      fail("stale_state", "The application identity changed.");
    this.assertPermission(app);
    const windows = await this.native.listWindows(app.pid);
    const win = windows?.find((candidate) => candidate.window_id === state.window.window_id);
    if (!win || !sameBounds(win.bounds, state.window.bounds))
      fail("stale_state", "The observed window moved, resized or closed. Observe again.");
    return win;
  }

  async observe(ref, screenshot = false) {
    const app = await this.resolveApp(ref, true);
    // 捕获新的 AX epoch 前先撤销旧 authority，防止 native 复用 handle 后旧 index 指向另一元素。
    for (const state of this.states.values()) if (state.app.pid === app.pid) this.release(state);
    const requestedWindow = ref.window_id ?? app.window_id;
    if (
      this.platform === "win32" &&
      /[\\/]ApplicationFrameHost\.exe$/i.test(app.bundle_id) &&
      !Number.isSafeInteger(requestedWindow)
    )
      fail(
        "element_unavailable",
        "A shared Windows application host requires an exact window_id from list_windows.",
      );
    const snap =
      this.native.captureAppAsync && this.platform === "darwin"
        ? await this.native.captureAppAsync(app.pid, app.bundle_id, requestedWindow)
        : await this.native.captureApp(app.pid, requestedWindow);
    const epoch = snap?.capture_epoch;
    let accepted = false;
    try {
      if (
        !snap ||
        !appMatches(snap.app, { pid: app.pid, bundle_id: app.bundle_id }) ||
        !Number.isSafeInteger(snap.window?.window_id) ||
        snap.window.window_id <= 0 ||
        !validBounds(snap.window.bounds) ||
        (requestedWindow !== undefined && snap.window.window_id !== requestedWindow)
      )
        fail(
          "element_unavailable",
          "Native capture did not prove the requested application window.",
        );
      const elements = [];
      const flatten = (nodes, depth = 0) => {
        if (depth > 64) return;
        for (const node of nodes ?? []) {
          if (elements.length >= 4096) return;
          if (node.ref && (node.ownerPid === undefined || node.ownerPid === app.pid))
            elements.push(node);
          flatten(node.children, depth + 1);
        }
      };
      flatten(snap.elements);
      const state = {
        id: randomUUID(),
        created: this.now(),
        app: { pid: app.pid, bundle_id: app.bundle_id, name: app.name },
        window: {
          window_id: snap.window.window_id,
          title: snap.window.title,
          bounds: [...snap.window.bounds],
        },
        elements,
        epoch,
      };
      await this.verify(state);
      let image;
      if (screenshot) {
        const raw =
          this.platform === "win32"
            ? await this.native.captureWindowPngVerifiedAsync(
                state.window.window_id,
                app.pid,
                app.bundle_id,
                state.window.bounds,
              )
            : await this.native.captureWindowImageVerifiedAsync(
                state.window.window_id,
                app.pid,
                app.bundle_id,
              );
        if (!raw || raw.ok === false || !validBounds(raw.bounds))
          fail(
            "capture_unavailable",
            "Verified window capture is unavailable; no coordinate authority was issued.",
          );
        const bytes =
          typeof raw.data === "string"
            ? Buffer.from(raw.data, "base64")
            : Buffer.from(raw.data ?? []);
        if (
          bytes.length < 24 ||
          bytes.length > 32 * 1024 * 1024 ||
          bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
        )
          fail("capture_unavailable", "Native capture did not return a valid bounded PNG.");
        const width = bytes.readUInt32BE(16),
          height = bytes.readUInt32BE(20);
        if (
          !width ||
          !height ||
          width > 16384 ||
          height > 16384 ||
          !sameBounds(raw.bounds, state.window.bounds)
        )
          fail("capture_unavailable", "Window image geometry changed during capture.");
        state.frame = { frame_id: randomUUID(), width, height };
        state.captureBounds = [...raw.bounds];
        image = { type: "image", data: bytes.toString("base64"), mimeType: "image/png" };
        await this.verify(state);
      }
      if (epoch && this.native.ackCaptureEpoch?.(app.pid, epoch) !== true)
        fail("stale_state", "The native capture epoch could not be acknowledged.");
      this.states.set(state.id, state);
      accepted = true;
      if (this.states.size > MAX_STATES) this.release(this.states.values().next().value);
      const payload = {
        state_id: state.id,
        app: state.app,
        window: state.window,
        elements: elements.map((node, index) => ({
          index,
          role: node.role,
          name: node.title ?? node.description ?? "",
          value: /secure|password/i.test(node.role) ? undefined : node.value,
          enabled: node.enabled,
          focused: node.focused,
          editable: node.editable,
          bounds: node.bounds,
          actions: node.actions ?? [],
        })),
        ...(state.frame ? { image_ref: state.frame } : {}),
      };
      return {
        content: [...(image ? [image] : []), { type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    } finally {
      if (!accepted && epoch) this.native.releaseCaptureEpoch?.(app.pid, epoch);
    }
  }

  async target(target, ref) {
    let state;
    if (target?.type === "element") state = this.states.get(target.state_id);
    else if (target?.type === "coordinate")
      state = [...this.states.values()].find((entry) => entry.frame?.frame_id === target.frame_id);
    else if (ref)
      state = [...this.states.values()]
        .reverse()
        .find(
          (entry) =>
            appMatches(entry.app, ref) &&
            (ref.window_id === undefined || entry.window.window_id === ref.window_id),
        );
    await this.verify(state);
    if (
      ref &&
      (!appMatches(state.app, ref) ||
        (ref.window_id !== undefined && ref.window_id !== state.window.window_id))
    )
      fail("stale_state", "Target and app_ref belong to different applications or windows.");
    if (target?.type === "element") {
      const node = state.elements[target.index];
      if (!node) fail("element_unavailable", "The element index is not part of this state.");
      const live = await this.native.readElement(node.ref);
      if (
        !live ||
        live.ref !== node.ref ||
        live.ownerPid !== state.app.pid ||
        live.role !== node.role ||
        // capture 会将 description 提升为展示 title，readElement 保留原始字段；比较规范化名称。
        (live.title ?? live.description ?? "") !== (node.title ?? node.description ?? "") ||
        (live.description ?? null) !== (node.description ?? null) ||
        (live.value ?? null) !== (node.value ?? null) ||
        live.enabled === false ||
        !sameBounds(live.bounds, node.bounds)
      )
        fail("stale_state", "The native element changed or no longer belongs to this application.");
      return { state, node: live };
    }
    if (target?.type === "coordinate") {
      if (!state.frame || target.x >= state.frame.width || target.y >= state.frame.height)
        fail("invalid_arguments", "Coordinate is outside the issued window raster.");
      const [x, y, w, h] = state.captureBounds;
      return {
        state,
        point: [x + (target.x * w) / state.frame.width, y + (target.y * h) / state.frame.height],
      };
    }
    return { state };
  }

  async activate(state) {
    const { pid, bundle_id } = state.app;
    assertOutcome(await this.native.activateWindow(pid, bundle_id, state.window.window_id));
    const win = await this.verify(state);
    if (win.focused !== true)
      fail("stale_state", "The exact target window did not become focused; no input was sent.");
  }

  async action(name, args) {
    return dispatchNativeAction(this, name, args);
  }

  async callTool(name, supplied = {}, cursorContext = {}) {
    const args = { ...supplied };
    // 仅服务内部兼容旧 facade 的翻译，MCP 不再发布这些别名。
    const clicks = {
      double_click: ["left", 2],
      triple_click: ["left", 3],
      right_click: ["right", 1],
      middle_click: ["middle", 1],
    };
    if (clicks[name]) {
      [args.mouse_button, args.click_count] = clicks[name];
      name = "left_click";
    }
    if (name === "hold_key") {
      args.hold_seconds = args.duration;
      delete args.duration;
      name = "key";
    }
    try {
      if (!["stop_computer_control", "request_access"].includes(name))
        this.cursor.bind(cursorContext);
      const invalid = validateToolRequest(name, args);
      if (invalid) fail("invalid_arguments", invalid);
      if (this.stopped && !["stop_computer_control", "request_access"].includes(name))
        fail("computer_control_stopped", "Computer control was stopped for this session.");
      if (name === "stop_computer_control") {
        this.stopped = true;
        await this.close();
        return toolResult({ stopped: true, reason: args.reason ?? null });
      }
      if (name === "request_access")
        return toolResult({
          platform: this.platform,
          ...this.permissions(),
          stopped: this.stopped,
        });
      if (name === "list_apps")
        return toolResult((await this.native.listApplications()).slice(0, 128));
      if (name === "list_windows") {
        const app = await this.resolveApp(args.app_ref);
        return toolResult(
          (await this.native.listWindows(app.pid)).map((win) => ({
            ...win,
            pid: app.pid,
            bundle_id: app.bundle_id,
          })),
        );
      }
      if (name === "get_app_state")
        return await this.observe(args.app_ref, args.include_screenshot === true);
      if (ACTIONS.has(name)) return await this.action(name, args);
      fail("unknown_tool", "Unknown native computer control tool.");
    } catch (error) {
      return toolError(error, {
        code: error.code ?? "native_error",
        action_sent: error.delivery === "possibly_sent",
        request_delivery_state: error.delivery ?? "not_sent",
      });
    }
  }

  async close() {
    this.cursor.close();
    await this.native.cancelInputHoldsForSession?.(this.session);
    for (const state of this.states.values()) this.release(state);
  }
}
