import { useCallback } from "react";
import { readBoundedImageBlob } from "@/lib/imagePreviewData.js";
import {
  dispatchImageReference,
  IMAGE_REFERENCE_MAX_BYTES,
  useImageReferenceTarget,
} from "./useImageReference.js";

async function toClipboardPng(blob: Blob): Promise<Blob> {
  if (!blob.type.startsWith("image/")) throw new Error("unsupported-image");
  if (blob.type === "image/png") return blob;
  const imageUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    // 统一走浏览器图片解码，SVG 与 JPEG 等共享同一转换路径。
    image.src = imageUrl;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 16_777_216) throw new Error("image-too-large");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("image-conversion-failed");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("image-conversion-failed"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export function useImagePreviewActions() {
  const target = useImageReferenceTarget();
  const copy = useCallback((source: string) => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      return Promise.reject(new Error("clipboard-unavailable"));
    }
    // 在用户手势内启动 write，把异步读取交给 ClipboardItem，兼容需要激活态的浏览器。
    const png = readBoundedImageBlob(source).then(toClipboardPng);
    return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  }, []);
  const reference = useCallback(
    async (source: string, filename: string) => {
      if (!target) throw new Error("image-reference-target-unavailable");
      const blob = await readBoundedImageBlob(source);
      if (!blob.type.startsWith("image/") || blob.size > IMAGE_REFERENCE_MAX_BYTES) {
        throw new Error("image-reference-too-large-or-unsupported");
      }
      const file = new File([blob], filename, { type: blob.type });
      if (!dispatchImageReference(target, file))
        throw new Error("image-reference-target-unavailable");
    },
    [target],
  );
  return { copy, reference, canReference: target !== null };
}
