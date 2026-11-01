import { toolResult } from "./vendor/open-zcode-computer-use/src/results.mjs";
import { fail, assertOutcome, validBounds, sameBounds, appMatches } from "./native-guards.mjs";

export async function dispatchNativeAction(engine, name, args) {
  const { state, node, point } = await engine.target(args.target ?? args.from_target, args.app_ref);
  let destination;
  if (name === "left_click_drag") {
    destination = await engine.target(args.to, args.app_ref);
    if (destination.state !== state)
      fail("invalid_arguments", "Drag targets must belong to the same window and state.");
  }
  const center = (n) => {
    if (!validBounds(n?.bounds))
      fail("element_unavailable", "The element has no actionable bounds.");
    return [n.bounds[0] + n.bounds[2] / 2, n.bounds[1] + n.bounds[3] / 2];
  };
  const position = () => point ?? center(node);
  const { pid } = state.app;
  const windowId = state.window.window_id;
  let sent = false;
  const dispatch = async (run, check = () => {}) => {
    await engine.verify(state);
    check();
    sent = true;
    assertOutcome(await run());
  };
  const foregroundGuard = () => {
    // 官方前台快捷键走系统事件；按 PID 投递可能仅返回接受回执，菜单快捷键并未生效。
    // 在最后一次同步核对之后立即发送；焦点或 no-focus 策略变化时不转向其他路径重试。
    const app = engine.native.applicationInfo(pid);
    const window = engine.native.listWindows(pid)?.find((win) => win.window_id === windowId);
    if (
      !appMatches(app, state.app) ||
      app.active !== true ||
      window?.focused !== true ||
      !sameBounds(window.bounds, state.window.bounds) ||
      engine.native.isFocusStealPrevented?.() !== false
    )
      fail("stale_state", "Foreground ownership changed; no keyboard input was sent.");
  };
  const key = (text, duration) =>
    dispatch(() => {
      return duration === undefined
        ? engine.native.pressKeyGlobal(text)
        : engine.native.holdKeyGlobalAsync(text, duration, engine.session);
    }, foregroundGuard);
  // 一次 observation 只授权一次动作；原生失败也不自动切换路径重试，以免重复输入。
  engine.states.delete(state.id);
  try {
    if (name === "set_value" || name === "select_text" || name === "perform_action") {
      if (!node)
        fail(
          "action_unavailable",
          "This semantic action requires an accessibility element target.",
        );
      if (name === "set_value") await dispatch(() => engine.native.setValue(node.ref, args.value));
      if (name === "select_text")
        await dispatch(() =>
          engine.native.selectText(
            node.ref,
            ...(args.text_range ?? [0, typeof node.value === "string" ? node.value.length : 0]),
          ),
        );
      if (name === "perform_action") {
        if (!node.actions?.includes(args.action))
          fail("invalid_arguments", "The element did not advertise this action.");
        await dispatch(() => engine.native.performAction(node.ref, args.action));
      }
    } else if (name === "left_click") {
      const button = args.mouse_button ?? "left",
        count = args.click_count ?? 1;
      if (
        node &&
        args.strategy !== "event" &&
        button === "left" &&
        count === 1 &&
        !args.modifiers &&
        node.actions?.includes("AXPress")
      ) {
        await dispatch(() => engine.native.performAction(node.ref, "AXPress"));
      } else {
        if (args.strategy === "a11y")
          fail("action_unavailable", "This element has no applicable accessibility click action.");
        const [x, y] = position();
        await engine.activate(state);
        await dispatch(
          () =>
            engine.native.clickAtPoint(x, y, button, count, args.modifiers ?? "", pid, windowId),
          foregroundGuard,
        );
      }
    } else if (name === "scroll") {
      if (node && args.strategy !== "event" && engine.native.scrollElement)
        await dispatch(() =>
          engine.native.scrollElement(node.ref, args.scroll_direction, args.scroll_amount),
        );
      else {
        if (args.strategy === "a11y")
          fail("action_unavailable", "Native semantic scrolling is unavailable.");
        const [x, y] = position();
        await engine.activate(state);
        await dispatch(
          () =>
            engine.native.scrollAt(x, y, args.scroll_amount, args.scroll_direction, pid, windowId),
          foregroundGuard,
        );
      }
    } else if (name === "left_click_drag") {
      const [x, y] = position(),
        [endX, endY] = destination.point ?? center(destination.node);
      await engine.activate(state);
      await dispatch(
        () => engine.native.drag(x, y, endX, endY, "left", args.modifiers ?? "", pid, windowId),
        foregroundGuard,
      );
    } else if (name === "type" || name === "key" || name === "paste") {
      if (point) fail("action_unavailable", "Use an editable element target for text input.");
      if (args.strategy === "a11y")
        fail(
          "action_unavailable",
          "Use set_value for semantic replacement; type/key send verified native input.",
        );
      await engine.activate(state);
      if (node) await dispatch(() => engine.native.setFocused(node.ref));
      if (name === "type")
        await dispatch(() => engine.native.typeTextGlobal(args.text), foregroundGuard);
      else if (name === "key") {
        const repeat = args.repeat ?? 1;
        if (args.hold_seconds !== undefined)
          await key(args.text, Math.round(args.hold_seconds * 1000));
        else for (let i = 0; i < repeat; i++) await key(args.text);
      } else {
        if (
          !engine.native.pasteboardBeginProvidedPaste ||
          !engine.native.pasteboardAwaitProvidedRead ||
          !engine.native.pasteboardFinishProvidedPaste
        )
          fail(
            "action_unavailable",
            "Native clipboard-preserving paste is unavailable; use type or set_value.",
          );
        const paste = engine.native.pasteboardBeginProvidedPaste(args.text, "text");
        if (!paste?.ok)
          fail("action_unavailable", "Native pasteboard admission failed; no paste was sent.");
        try {
          engine.native.pasteboardMarkProvidedPasteDispatched?.(paste.token);
          await key(engine.platform === "darwin" ? "cmd+v" : "ctrl+v");
          assertOutcome(
            await engine.withRunLoop(() => engine.native.pasteboardAwaitProvidedRead(paste.token)),
          );
        } finally {
          engine.native.pasteboardFinishProvidedPaste(paste.token);
        }
      }
    } else fail("action_unavailable", "This native operation is unavailable.");
    const receipt = {
      action_sent: sent,
      dispatch_status: sent ? "sent" : "not_sent",
      retry_action: false,
    };
    if (args.return_state && args.return_state !== "none") {
      const result = await engine.observe({ ...state.app, window_id: windowId });
      result.structuredContent.action_receipt = receipt;
      return result;
    }
    return toolResult({ action_receipt: receipt });
  } catch (error) {
    if (sent) error.delivery = "possibly_sent";
    throw error;
  } finally {
    if (state.epoch) engine.native.releaseCaptureEpoch?.(pid, state.epoch);
  }
}
