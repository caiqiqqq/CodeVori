import { StyleSheet, useColorScheme } from "react-native";

// 原生壳无法直接使用 Web CSS 变量；这里集中对应连接页的语义色及输入字号。
export function useConnectionStyles() {
  const dark = useColorScheme() === "dark";
  const colors = dark
    ? {
        background: "#1b1b1b",
        foreground: "#f5f5f5",
        subtle: "#a3a3a3",
        input: "#2b2b2b",
        border: "#525252",
        error: "#ffaaa6",
      }
    : {
        background: "#f7f7f7",
        foreground: "#171717",
        subtle: "#525252",
        input: "#ffffff",
        border: "#d4d4d4",
        error: "#b42318",
      };
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    panel: { backgroundColor: colors.background },
    keyboard: { flex: 1 },
    content: { flexGrow: 1, justifyContent: "center", gap: 12, padding: 24 },
    title: { color: colors.foreground, fontSize: 24, fontWeight: "600" },
    label: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
    subtitle: { color: colors.subtle, fontSize: 14, lineHeight: 22 },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.input,
      color: colors.foreground,
      paddingHorizontal: 12,
      fontSize: 16,
    },
    error: { color: colors.error, fontSize: 14, lineHeight: 20 },
    primaryButton: {
      minHeight: 48,
      borderRadius: 8,
      backgroundColor: colors.foreground,
      justifyContent: "center",
      alignItems: "center",
      padding: 12,
    },
    primaryText: { color: colors.background, fontSize: 14, fontWeight: "600" },
    secondaryButton: {
      minHeight: 48,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: "center",
      alignItems: "center",
      padding: 12,
    },
    secondaryText: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
    camera: { width: "100%", aspectRatio: 1, minHeight: 240, borderRadius: 12, overflow: "hidden" },
  });
}
