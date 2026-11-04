import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// 只调用原生光标模型和数学自测，不派发鼠标/键盘输入；显示效果需有活动桌面另验。
test(
  "official native cursor groups have independent palettes and lifecycle",
  {
    skip:
      process.env.ZCODE_CUA_REAL_NATIVE_TEST !== "1" ||
      process.platform !== "darwin" ||
      process.arch !== "arm64",
  },
  () => {
    const native = createRequire(import.meta.url)("../native-bin/darwin-arm64/ax_native.node");
    // 原生采用有限色板，任意 sid 可能同色；固定已知映射，验证会话各自保留色板状态。
    const a = "fixture-a",
      b = "fixture-b";
    try {
      native.ghostSetMultiCursorEnabled(true);
      native.ghostSetEnabled(true);
      native.ghostMove(20, 30, a);
      native.ghostMove(40, 50, b);
      const groups = native.ghostState().groups;
      assert.equal(groups[a].multi, true);
      assert.equal(groups[b].multi, true);
      assert.notEqual(groups[a].fillHex, groups[b].fillHex);
      native.ghostRemoveSession(a);
      assert.equal(native.ghostState().groups[a], undefined);
      assert.equal(native.ghostState().groups[b].shown, true);
      assert.equal(native.ghostMotionSelftest().arrived, true);
      assert.equal(native.ghostGeometrySelftest().leftScreen, 1);
      assert.equal(native.ghostPaletteSelftest().sanitize["cjk-keep"], "点击搜索按钮");
    } finally {
      native.ghostRemoveSession(a);
      native.ghostRemoveSession(b);
    }
  },
);
