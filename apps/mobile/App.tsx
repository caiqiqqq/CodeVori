import { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { WebView, type WebViewNavigation } from "react-native-webview";
import {
  buildAuthenticatedUrl,
  isSameOrigin,
  parseConnectionInput,
  type MobileConnection,
} from "./src/connection";
import { clearConnection, loadConnection, saveConnection } from "./src/connectionStore";

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

function PairingScreen({
  initialError,
  onConnected,
}: {
  readonly initialError: string | null;
  readonly onConnected: (connection: MobileConnection) => void;
}) {
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState(initialError);

  const connect = async () => {
    const result = parseConnectionInput(address, token);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    try {
      await saveConnection(result.connection);
      setError(null);
      onConnected(result.connection);
    } catch {
      setError("连接配置保存失败，请检查系统安全存储权限。");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <Text style={styles.title}>ZCode LAN Mobile</Text>
        <Text style={styles.subtitle}>连接同一局域网内运行的 ZCode Web 服务。</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.1.23:3030"
          placeholderTextColor="#78828c"
          style={styles.input}
          value={address}
          onChangeText={setAddress}
        />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Web 服务 Token"
          placeholderTextColor="#78828c"
          secureTextEntry
          style={styles.input}
          value={token}
          onChangeText={setToken}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.primaryButton} onPress={() => void connect()}>
          <Text style={styles.primaryButtonText}>连接桌面端</Text>
        </Pressable>
        <Text style={styles.hint}>
          仅允许局域网 HTTP 地址或 HTTPS 地址；手机与电脑需处于可互访网络。
        </Text>
      </View>
    </SafeAreaView>
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
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const url = useMemo(() => buildAuthenticatedUrl(connection), [connection]);

  const disconnect = () => {
    Alert.alert("更换连接？", "这只会清除手机保存的地址和 Token，不影响桌面端会话。", [
      { text: "取消", style: "cancel" },
      {
        text: "更换连接",
        style: "destructive",
        onPress: () => {
          void onDisconnect().catch(() => setDisconnectError("清除连接失败，请重试。"));
        },
      },
    ]);
  };

  if (failed) {
    return (
      <StateScreen
        title="无法连接桌面端"
        actionLabel="重新加载"
        onAction={() => setFailed(false)}
        secondaryLabel="更换连接"
        onSecondary={disconnect}
      />
    );
  }

  return (
    <SafeAreaView style={styles.webSafeArea}>
      <StatusBar style="light" />
      <View style={styles.toolbar}>
        <Text style={styles.toolbarLabel} numberOfLines={1}>
          {new URL(connection.origin).host}
        </Text>
        {disconnectError ? <Text style={styles.error}>{disconnectError}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="更换连接"
          onPress={disconnect}
          style={styles.toolbarButton}
        >
          <Text style={styles.toolbarButtonText}>更换连接</Text>
        </Pressable>
      </View>
      <WebView
        source={{ uri: url }}
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
          <Pressable style={styles.primaryButton} onPress={onAction}>
            <Text style={styles.primaryButtonText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
        {secondaryLabel && onSecondary ? (
          <Pressable style={styles.secondaryButton} onPress={onSecondary}>
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
  container: { flex: 1, justifyContent: "center", gap: 14, paddingHorizontal: 24 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingHorizontal: 24,
  },
  title: { color: "#f5f7f8", fontSize: 24, fontWeight: "700" },
  subtitle: { color: "#a7afb8", fontSize: 15, lineHeight: 22 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 12,
    backgroundColor: "#151718",
    color: "#f5f7f8",
    paddingHorizontal: 14,
    fontSize: 16,
  },
  error: { color: "#ffaaa6", fontSize: 13, lineHeight: 19 },
  hint: { color: "#78828c", fontSize: 12, lineHeight: 18 },
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
  toolbar: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    gap: 8,
  },
  toolbarLabel: { flex: 1, color: "#a7afb8", fontSize: 13 },
  toolbarButton: { paddingHorizontal: 10, paddingVertical: 8 },
  toolbarButtonText: { color: "#e5e9ec", fontSize: 13 },
  webView: { flex: 1, backgroundColor: "#0c0e0f" },
});
