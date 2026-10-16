import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { parsePairingLink, type MobileConnection } from "./connection";
import { useConnectionStyles } from "./connectionStyles";

export function QrScannerScreen({
  onScanned,
  onCancel,
}: {
  readonly onScanned: (connection: MobileConnection) => void;
  readonly onCancel: () => void;
}) {
  const styles = useConnectionStyles();
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const consumed = useRef(false);
  const live = useRef(true);
  const foreground = useRef(active);
  useEffect(() => {
    live.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      foreground.current = state === "active";
      setActive(foreground.current);
    });
    return () => {
      live.current = false;
      subscription.remove();
    };
  }, []);

  const authorize = async () => {
    try {
      if (permission?.canAskAgain === false) await Linking.openSettings();
      else await requestPermission();
    } catch {
      if (live.current) setPermissionError("无法打开相机权限，请返回后手动输入连接地址。");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>扫描连接二维码</Text>
        <Text style={styles.subtitle}>
          对准电脑「局域网手机访问」中的二维码。识别后返回连接页确认。
        </Text>
        {!permission ? (
          <Text style={styles.subtitle}>正在检查相机权限…</Text>
        ) : !permission.granted ? (
          <>
            <Text style={styles.subtitle}>扫码需要相机权限，也可以返回手动输入地址。</Text>
            <Pressable
              accessibilityRole="button"
              style={styles.primaryButton}
              onPress={() => void authorize()}
            >
              <Text style={styles.primaryText}>
                {permission.canAskAgain ? "允许使用相机" : "前往系统设置"}
              </Text>
            </Pressable>
          </>
        ) : cameraError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {cameraError}
          </Text>
        ) : active ? (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onMountError={() =>
              setCameraError("相机无法启动，请返回手动输入地址，或重新打开扫码。")
            }
            onBarcodeScanned={
              scanError
                ? undefined
                : ({ data }) => {
                    // 相机一帧可重复派发扫码事件；同步消费标记避免重复填入及处理卸载后的旧事件。
                    if (!live.current || !foreground.current || consumed.current) return;
                    consumed.current = true;
                    const result = parsePairingLink(data);
                    if (result.ok) onScanned(result.connection);
                    else setScanError(result.reason);
                  }
            }
          />
        ) : (
          <Text style={styles.subtitle}>回到 App 后继续扫描。</Text>
        )}
        {scanError ? (
          <>
            <Text accessibilityRole="alert" style={styles.error}>
              {scanError}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.secondaryButton}
              onPress={() => {
                consumed.current = false;
                setScanError(null);
              }}
            >
              <Text style={styles.secondaryText}>重新扫描</Text>
            </Pressable>
          </>
        ) : null}
        {permissionError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {permissionError}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => {
            live.current = false;
            onCancel();
          }}
        >
          <Text style={styles.secondaryText}>返回手动输入</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
