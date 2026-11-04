import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "@/components/ui/toast.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  useImageReferenceTarget,
  dispatchImageReference,
  IMAGE_REFERENCE_MAX_BYTES,
} from "@/hooks/useImageReference.js";
import { exportAnnotatedImage } from "@/image-preview-editor/annotations.js";

export function useAnnotatedImageSave({
  imageRef,
  overlayRef,
  filename,
  onSaved,
}: {
  imageRef: RefObject<HTMLImageElement | null>;
  overlayRef: RefObject<SVGSVGElement | null>;
  filename: string;
  onSaved: () => void;
}) {
  const { intl } = useZCodeIntl();
  const composerTarget = useImageReferenceTarget();
  const [saving, setSaving] = useState(false);
  const pending = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const save = async () => {
    if (pending.current || !imageRef.current || !overlayRef.current) return;
    // 导出前捕获精确会话目标，迟到结果不能重新查询当前会话。
    const target = composerTarget;
    if (!target) {
      toast(intl.formatMessage({ id: "imageEditor.noComposer" }));
      return;
    }
    pending.current = true;
    setSaving(true);
    try {
      const file = await exportAnnotatedImage(imageRef.current, overlayRef.current, filename);
      if (!alive.current) return;
      if (file.size > IMAGE_REFERENCE_MAX_BYTES || !dispatchImageReference(target, file))
        throw new Error("Composer rejected the image");
      onSaved();
    } catch (error) {
      if (!alive.current) return;
      logger.warn("[ImagePreviewDialog] 标注图片保存失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      toast(intl.formatMessage({ id: "imageEditor.saveFailed" }));
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
  };
  return { saving, save };
}
