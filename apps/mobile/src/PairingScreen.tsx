import { useRef, useState } from "react";
import { PRODUCT_NAME } from "@zcode/shared/product-brand";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { parsePairingInput, type MobileConnection } from "./connection";
import { saveConnection } from "./connectionStore";
import { useConnectionStyles } from "./connectionStyles";
import { QrScannerScreen } from "./QrScannerScreen";

export function PairingScreen({
  initialError,
  onConnected,
}: {
  readonly initialError: string | null;
  readonly onConnected: (connection: MobileConnection) => void;
}) {
  const styles = useConnectionStyles();
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState(initialError);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  const connect = async () => {
    // 原生点击回调可能在 React 提交 disabled 前连续触发，保存须同步占位。
    if (submitting.current) return;
    const result = parsePairingInput(address, token);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      await saveConnection(result.connection);
      setError(null);
      onConnected(result.connection);
    } catch {
      setError("连接配置保存失败，请重试。输入的地址和 Token 已保留。");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  if (scanning)
    return (
      <QrScannerScreen
        onCancel={() => setScanning(false)}
        onScanned={(connection) => {
          setAddress(connection.origin);
          setToken(connection.token);
          setError(null);
          setScanning(false);
        }}
      />
    );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>连接 {PRODUCT_NAME}</Text>
          <Text style={styles.subtitle}>
            在电脑 {PRODUCT_NAME}「设置 → 局域网手机访问」开启访问，输入连接地址或扫描其中的二维码。
          </Text>
          <Text style={styles.label}>连接地址或完整链接</Text>
          <TextInput
            accessibilityLabel="连接地址或完整链接"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.23:3030"
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            editable={!saving}
          />
          <Text style={styles.label}>访问 Token</Text>
          <TextInput
            accessibilityLabel="访问 Token"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="粘贴完整链接时可留空"
            secureTextEntry
            style={styles.input}
            value={token}
            onChangeText={setToken}
            editable={!saving}
          />
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            style={styles.primaryButton}
            onPress={() => void connect()}
          >
            <Text style={styles.primaryText}>{saving ? "正在保存连接…" : "连接桌面端"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            style={styles.secondaryButton}
            onPress={() => setScanning(true)}
          >
            <Text style={styles.secondaryText}>扫描二维码</Text>
          </Pressable>
          <Text style={styles.subtitle}>
            扫码后会填入地址与 Token，确认后再连接。手机与电脑需处于同一可互访局域网。
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
