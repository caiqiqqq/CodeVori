import { useEffect, useState } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function DesktopLanQrCode({ value }: { readonly value: string }) {
  const { intl } = useZCodeIntl();
  const [image, setImage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    // 仅在设置打开时本地生成，不能把含 Token 的链接提交给外部二维码服务。
    void import("qrcode")
      .then((qr) => qr.toDataURL(value, { width: 240, margin: 4, errorCorrectionLevel: "M" }))
      .then((dataUrl) => {
        if (live) setImage(dataUrl);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [value]);
  return (
    <div className="space-y-2">
      {image ? (
        <img
          src={image}
          alt={intl.formatMessage({ id: "settings.desktopLan.qr" })}
          width={240}
          height={240}
          className="h-auto max-w-full"
          data-testid="desktop-lan-qr"
        />
      ) : (
        <p className="text-ui-sm text-foreground-subtle" role="status">
          {intl.formatMessage({
            id: failed ? "settings.desktopLan.qrFailed" : "settings.desktopLan.qrLoading",
          })}
        </p>
      )}
    </div>
  );
}
