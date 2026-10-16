import { useState } from "react";
import { View } from "react-native";

// 替代原生摄像头边界；连接页、扫码消费和持久化逻辑均执行真实实现。
export function useCameraPermissions() {
  const [permission, setPermission] = useState(window.__mobile.permission);
  return [
    permission,
    async () => {
      window.__mobile.permissionRequests++;
      setPermission(window.__mobile.nextPermission);
      return window.__mobile.nextPermission;
    },
  ];
}

export function CameraView({ onBarcodeScanned, onMountError, barcodeScannerSettings, ...props }) {
  window.__mobile.scan = (data) => onBarcodeScanned?.({ data });
  window.__mobile.cameraError = onMountError;
  window.__mobile.scanTypes = barcodeScannerSettings.barcodeTypes;
  return <View {...props} testID="camera" />;
}
