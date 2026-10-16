import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";

const SIZE = 44;
const MARGIN = 8;
type Point = { x: number; y: number };

export function FloatingConnectionButton({ onPress }: { readonly onPress: () => void }) {
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [position, setPosition] = useState<Point | null>(null);
  const dragStart = useRef<Point>({ x: 0, y: 0 });
  const dragging = useRef(false);
  const clamp = (point: Point): Point => ({
    x: Math.max(MARGIN, Math.min(point.x, bounds.width - SIZE - MARGIN)),
    y: Math.max(MARGIN, Math.min(point.y, bounds.height - SIZE - MARGIN)),
  });
  const visible = clamp(position ?? { x: bounds.width - SIZE - MARGIN, y: bounds.height * 0.45 });
  const current = useRef({ bounds, visible });
  current.current = { bounds, visible };
  const responder = useMemo(
    () =>
      PanResponder.create({
        // 轻点交给 Pressable；超过触摸阈值才接管，避免拖动后误开连接设置。
        onMoveShouldSetPanResponder: (_, gesture) => Math.hypot(gesture.dx, gesture.dy) > 6,
        onPanResponderGrant: () => {
          dragging.current = true;
          dragStart.current = current.current.visible;
        },
        onPanResponderMove: (_, gesture) => {
          const { width, height } = current.current.bounds;
          setPosition({
            x: Math.max(MARGIN, Math.min(dragStart.current.x + gesture.dx, width - SIZE - MARGIN)),
            y: Math.max(MARGIN, Math.min(dragStart.current.y + gesture.dy, height - SIZE - MARGIN)),
          });
        },
        onPanResponderRelease: () => {
          // 保留拖动标记至下一次按下；本次 release 不得触发点击。
          dragging.current = true;
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  return (
    <View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent: { layout } }) =>
        setBounds({ width: layout.width, height: layout.height })
      }
    >
      <View {...responder.panHandlers} style={[styles.button, { left: visible.x, top: visible.y }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="连接设置"
          accessibilityHint="轻点查看连接，拖动调整位置"
          onPressIn={() => {
            dragging.current = false;
          }}
          onPress={() => {
            if (!dragging.current) onPress();
          }}
          style={styles.hitArea}
        >
          <Text style={styles.text}>⋮</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: "rgba(32,34,36,0.85)",
  },
  hitArea: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  text: { color: "#f5f7f8", fontSize: 28, lineHeight: 32 },
});
