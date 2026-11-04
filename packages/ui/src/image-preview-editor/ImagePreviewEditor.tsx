import { useEffect, useState } from "react";
import { readBoundedImageBlob } from "@/lib/imagePreviewData.js";
import { ImagePreviewSurface } from "./ImagePreviewSurface.js";
import type { ImagePreviewSurfaceProps } from "./contract.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** 通过既有有界读取生成同源 Blob，避免跨域原图污染 canvas 导出。 */
export function ImagePreviewEditor(props: ImagePreviewSurfaceProps) {
  const { intl } = useZCodeIntl();
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState<{ source: string; url: string; error?: boolean } | null>(null);
  useEffect(() => {
    setImage(null);
    let disposed = false;
    let url: string | undefined;
    void readBoundedImageBlob(props.src).then(
      (blob) => {
        if (disposed) return;
        url = URL.createObjectURL(blob);
        setImage({ source: props.src, url });
      },
      () => {
        if (!disposed) setImage({ source: props.src, url: "", error: true });
      },
    );
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [props.src, attempt]);
  if (!image || image.source !== props.src)
    return <p role="status">{intl.formatMessage({ id: "common.loading" })}</p>;
  if (image.error)
    return (
      <div className="absolute inset-0 flex items-center justify-center gap-2">
        <p role="alert">{intl.formatMessage({ id: "imageEditor.saveFailed" })}</p>
        <Button onClick={() => setAttempt((value) => value + 1)}>
          {intl.formatMessage({ id: "common.retry" })}
        </Button>
      </div>
    );
  return <ImagePreviewSurface key={image.url} {...props} src={image.url} />;
}
