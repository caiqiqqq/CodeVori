import { createContext, useContext, useEffect, type ReactNode } from "react";

export interface ImageReferenceTarget {
  workspaceKey: string;
  scopeId: string;
}

const ImageReferenceContext = createContext<ImageReferenceTarget | null>(null);
const IMAGE_REFERENCE_EVENT = "zcode:add-image-to-composer";
export const IMAGE_REFERENCE_MAX_BYTES = 20 * 1024 * 1024;

export function ImageReferenceTargetProvider({
  target,
  children,
}: {
  target: ImageReferenceTarget | null;
  children: ReactNode;
}) {
  return <ImageReferenceContext.Provider value={target}>{children}</ImageReferenceContext.Provider>;
}

export function useImageReferenceTarget() {
  return useContext(ImageReferenceContext);
}

interface ImageReferenceDetail extends ImageReferenceTarget {
  file: File;
}

export function dispatchImageReference(target: ImageReferenceTarget, file: File): boolean {
  const event = new CustomEvent<ImageReferenceDetail>(IMAGE_REFERENCE_EVENT, {
    cancelable: true,
    detail: { ...target, file },
  });
  // 只把已由精确目标接收的命令视为成功；无监听者和迟到结果都不排队或改投其他会话。
  return !window.dispatchEvent(event);
}

export function useImageReferenceReceiver({
  target,
  enabled,
  receive,
}: {
  target: ImageReferenceTarget;
  enabled: boolean;
  receive: (file: File) => boolean;
}) {
  const { workspaceKey, scopeId } = target;
  useEffect(() => {
    if (!enabled) return;
    const handle = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.defaultPrevented) return;
      const detail = event.detail as ImageReferenceDetail;
      if (detail.workspaceKey !== workspaceKey || detail.scopeId !== scopeId) return;
      if (
        !(detail.file instanceof File) ||
        !detail.file.type.startsWith("image/") ||
        detail.file.size > IMAGE_REFERENCE_MAX_BYTES
      )
        return;
      if (receive(detail.file)) event.preventDefault();
    };
    window.addEventListener(IMAGE_REFERENCE_EVENT, handle);
    return () => window.removeEventListener(IMAGE_REFERENCE_EVENT, handle);
  }, [enabled, receive, scopeId, workspaceKey]);
}
