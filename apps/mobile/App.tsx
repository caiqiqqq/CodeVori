import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { buildAuthenticatedUrl, isSameOrigin, type MobileConnection } from "./src/connection";
import { clearConnection, loadConnection } from "./src/connectionStore";

import { FloatingConnectionButton } from "./src/FloatingConnectionButton";
import { PairingScreen } from "./src/PairingScreen";
import { useConnectionStyles } from "./src/connectionStyles";

export default function App() {
  const [connection, setConnection] = useState<MobileConnection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void loadConnection()
      .then((saved) => {
        if (mounted) setConnection(saved);
      })
      .catch(() => {
        if (mounted) setError("读取本机连接失败，请重新输入地址。");
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (isLoading) return <StateScreen title="正在读取连接配置" />;
  if (!connection) {
    return <PairingScreen initialError={error} onConnected={setConnection} />;
  }
  return (
    <RemoteScreen
      connection={connection}
      onDisconnect={async () => {
        await clearConnection();
        setConnection(null);
      }}
    />
  );
}

function RemoteScreen({
  connection,
  onDisconnect,
}: {
  readonly connection: MobileConnection;
  readonly onDisconnect: () => Promise<void>;
}) {
  const [failed, setFailed] = useState(false);
  const [webGeneration, setWebGeneration] = useState(0);
  const web = useRef<WebView>(null);
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") {
        // 前台恢复只唤醒断线恢复器，不无条件刷新仍健康的会话。
        web.current?.injectJavaScript('window.dispatchEvent(new Event("zcode:resume"));true;');
      }
      previous = next;
    });
    return () => subscription.remove();
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const disconnectPending = useRef(false);
  const connectionStyles = useConnectionStyles();
  const source = useMemo(() => ({ uri: buildAuthenticatedUrl(connection) }), [connection]);

  const openSettings = () => {
    setDisconnectError(null);
    setSettingsOpen(true);
  };
  const closeSettings = () => {
    if (!disconnectPending.current) setSettingsOpen(false);
  };
  const disconnect = async () => {
    // 清除成功前保留原连接；同步门禁避免连续点击重复删除 SecureStore。
    if (disconnectPending.current) return;
    disconnectPending.current = true;
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      await onDisconnect();
    } catch {
      setDisconnectError("清除连接失败，请重试。");
      setDisconnecting(false);
      disconnectPending.current = false;
    }
  };

  return (
    <SafeAreaView style={styles.webSafeArea}>
      <StatusBar style="light" />
      {failed ? (
        <StateScreen
          title="无法连接桌面端"
          actionLabel="重新加载"
          onAction={() => setFailed(false)}
          secondaryLabel="更换连接"
          onSecondary={openSettings}
        />
      ) : (
        <View style={styles.remoteContent}>
          <WebView
            key={webGeneration}
            ref={web}
            onContentProcessDidTerminate={() => setWebGeneration((value) => value + 1)}
            source={source}
            originWhitelist={["http://*", "https://*"]}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            setSupportMultipleWindows={false}
            onError={() => setFailed(true)}
            onHttpError={(event) => {
              if (event.nativeEvent.statusCode >= 400) setFailed(true);
            }}
            onShouldStartLoadWithRequest={(request: WebViewNavigation) => {
              if (isSameOrigin(request.url, connection.origin)) return true;
              if (request.url.startsWith("https://"))
                void Linking.openURL(request.url).catch(() => undefined);
              return false;
            }}
            style={styles.webView}
          />
          <FloatingConnectionButton onPress={openSettings} />
        </View>
      )}
      {/* 连接栏不再挤占网页高度；弹层独立挂载，打开/取消时保留 WebView 和会话。 */}
      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={closeSettings}>
        <View style={styles.modalBackdrop}>
          <View
            testID="connection-settings"
            accessibilityViewIsModal
            style={[connectionStyles.panel, styles.connectionCard]}
          >
            <Text style={connectionStyles.title}>连接设置</Text>
            <Text style={connectionStyles.subtitle}>当前电脑</Text>
            <Text selectable style={connectionStyles.label}>
              {new URL(connection.origin).host}
            </Text>
            <Text style={connectionStyles.subtitle}>
              更换连接只会清除手机保存的地址和 Token，不影响桌面端会话。
            </Text>
            {disconnectError ? (
              <Text accessibilityRole="alert" style={connectionStyles.error}>
                {disconnectError}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={disconnecting}
              style={connectionStyles.primaryButton}
              onPress={closeSettings}
            >
              <Text style={connectionStyles.primaryText}>继续使用</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={disconnecting}
              style={connectionStyles.secondaryButton}
              onPress={() => void disconnect()}
            >
              <Text style={connectionStyles.secondaryText}>
                {disconnecting ? "正在更换…" : "更换连接"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function StateScreen({
  title,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  readonly title: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly secondaryLabel?: string;
  readonly onSecondary?: () => void;
}) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.centered}>
        <Text style={styles.title}>{title}</Text>
        {actionLabel && onAction ? (
          <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={onAction}>
            <Text style={styles.primaryButtonText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
        {secondaryLabel && onSecondary ? (
          <Pressable
            accessibilityRole="button"
            style={styles.secondaryButton}
            onPress={onSecondary}
          >
            <Text style={styles.secondaryButtonText}>{secondaryLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0c0e0f" },
  webSafeArea: { flex: 1, backgroundColor: "#0c0e0f" },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 24,
  },
  title: { color: "#f5f7f8", fontSize: 24, fontWeight: "700" },
  primaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#f5f7f8",
    paddingHorizontal: 20,
  },
  primaryButtonText: { color: "#101213", fontSize: 15, fontWeight: "700" },
  secondaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    paddingHorizontal: 20,
  },
  secondaryButtonText: { color: "#e5e9ec", fontSize: 15, fontWeight: "700" },
  remoteContent: { flex: 1 },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 24,
  },
  connectionCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 12,
    padding: 20,
    gap: 12,
  },
  webView: { flex: 1, backgroundColor: "#0c0e0f" },
});
