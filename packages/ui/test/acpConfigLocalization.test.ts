import assert from "node:assert/strict";
import test from "node:test";
import type { AcpConfigOption } from "@zcode/shared";
import {
  acpConfigChoiceLabel,
  acpConfigDescription,
  acpConfigGroupLabel,
  acpConfigOptionLabel,
} from "../src/v4/composer/acpConfigLocalization.ts";

const option: AcpConfigOption = {
  id: "mode",
  name: "Mode",
  category: "mode",
  type: "select",
  currentValue: "agent",
  description: "Approval and sandboxing preset for the session",
  options: [
    {
      value: "agent",
      name: "Approve for me",
      description: "Only ask for actions detected as potentially unsafe",
    },
    { value: "future", name: "Future preset", description: "Agent supplied description" },
  ],
};

test("Chinese ACP display translates known Codex choices without changing Agent values", () => {
  assert.equal(acpConfigOptionLabel("zh-CN", "codex", option), "权限模式");
  assert.equal(
    acpConfigDescription("zh-CN", "codex", option, option.description),
    "设置会话的授权与沙盒策略",
  );
  assert.equal(acpConfigChoiceLabel("zh-CN", "codex", option, option.options[0]), "自动审核");
  assert.equal(option.options[0]?.value, "agent");
  assert.equal(acpConfigChoiceLabel("zh-CN", "codex", option, option.options[1]), "Future preset");
  assert.equal(
    acpConfigDescription("zh-CN", "codex", option, option.options[1]?.description),
    "Agent supplied description",
  );
  assert.equal(acpConfigChoiceLabel("en-US", "codex", option, option.options[0]), "Approve for me");
});

test("Claude permission labels do not reuse Codex meaning for the same config ID", () => {
  const claude: AcpConfigOption = {
    ...option,
    currentValue: "default",
    options: [
      { value: "default", name: "Manual", description: "Always ask before making changes" },
      { value: "auto", name: "Auto", description: "Claude handles permission decisions" },
    ],
  };
  assert.equal(acpConfigChoiceLabel("zh-CN", "claude", claude, claude.options[0]), "手动确认");
  assert.equal(acpConfigChoiceLabel("zh-CN", "claude", claude, claude.options[1]), "自动判断");
  assert.equal(acpConfigChoiceLabel("zh-CN", "codex", claude, claude.options[1]), "Auto");
});

test("Chinese Claude custom model explanations keep Agent model IDs and unknown wording", () => {
  const model: AcpConfigOption = {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "default",
    options: [
      { value: "opus", name: "claude-opus-5", description: "Custom Opus model" },
      { value: "fable", name: "claude-opus-5", description: "Custom Fable model" },
      { value: "sonnet", name: "claude-opus-5", description: "Custom Sonnet model" },
      { value: "haiku", name: "claude-opus-5", description: "Custom Haiku model" },
      { value: "future", name: "claude-future", description: "Custom Future model" },
    ],
  };
  assert.deepEqual(
    model.options
      .slice(0, 4)
      .map((choice) => acpConfigDescription("zh-CN", "claude", model, choice.description)),
    ["自定义 Opus 模型", "自定义 Fable 模型", "自定义 Sonnet 模型", "自定义 Haiku 模型"],
  );
  assert.equal(acpConfigChoiceLabel("zh-CN", "claude", model, model.options[0]), "claude-opus-5");
  assert.equal(model.options[0]?.value, "opus");
  assert.equal(
    acpConfigDescription("zh-CN", "claude", model, model.options[4]?.description),
    "Custom Future model",
  );
  assert.equal(
    acpConfigDescription("en-US", "claude", model, model.options[0]?.description),
    "Custom Opus model",
  );
  assert.equal(
    acpConfigDescription("zh-CN", "codex", model, model.options[0]?.description),
    "Custom Opus model",
  );
  assert.equal(acpConfigGroupLabel("zh-CN", "Other"), "其他");
  assert.equal(acpConfigGroupLabel("en-US", "Other"), "Other");
});

test("unknown ACP metadata matching JavaScript object property names stays unchanged", () => {
  const unknown: AcpConfigOption = {
    ...option,
    id: "constructor",
    name: "Agent control",
    options: [{ value: "toString", name: "Agent choice", description: "constructor" }],
  };
  assert.equal(acpConfigOptionLabel("zh-CN", "codex", unknown), "Agent control");
  assert.equal(acpConfigChoiceLabel("zh-CN", "codex", option, unknown.options[0]), "Agent choice");
  assert.equal(acpConfigDescription("zh-CN", "claude", unknown, "constructor"), "constructor");
});
