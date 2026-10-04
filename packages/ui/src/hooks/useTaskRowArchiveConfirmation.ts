import { useEffect, useState, type MouseEvent, type RefObject } from "react";

/** 会话行只持有临时确认态；归档事实仍由调用方的 scoped Host 命令保存。 */
export function useTaskRowArchiveConfirmation({
  itemRef,
  disabled,
  onConfirm,
}: {
  itemRef: RefObject<HTMLLIElement | null>;
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (itemRef.current?.contains(document.activeElement)) itemRef.current.focus();
      setConfirming(false);
    }
    function cancelOnOutsidePress(event: PointerEvent) {
      if (event.target instanceof Node && !itemRef.current?.contains(event.target)) {
        setConfirming(false);
      }
    }
    window.addEventListener("keydown", cancelOnEscape, true);
    window.addEventListener("pointerdown", cancelOnOutsidePress, true);
    return () => {
      window.removeEventListener("keydown", cancelOnEscape, true);
      window.removeEventListener("pointerdown", cancelOnOutsidePress, true);
    };
  }, [confirming, itemRef]);

  return {
    confirming,
    cancel: () => setConfirming(false),
    onClick(event: MouseEvent<HTMLButtonElement>) {
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;
      if (confirming) {
        // 修复原因：保持同一按钮可避免确认态切换丢焦点；提交前再把键盘焦点
        // 交回行，避免 busy 禁用按钮后不触发 blur，残留行内 focusActions 状态。
        if (event.currentTarget === document.activeElement) itemRef.current?.focus();
        setConfirming(false);
        onConfirm();
      } else {
        setConfirming(true);
      }
    },
  };
}
