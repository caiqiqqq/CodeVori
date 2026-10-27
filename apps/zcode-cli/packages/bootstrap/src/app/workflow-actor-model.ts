// ============================================================
// workflow actor 的模型面（run 选择 / journal pin → AgentRuntime 模型配置）
// ============================================================
//
// persona 的模型档位（`model?: "main" | "lite"`）已退场。宿主在 provider 重构后没有 lite 模型来源，
// "lite" 与 "main" 早已同路——继承父会话当前模型。
//
// 具体 persona.model 优先；其余三个来源按优先级排：
// 本 run 的 `subagentModel`（`CreateWorkflow` / `AmendWorkflow` 的 `subagent_model`）> resume pin（journal 里上一次实际跑的模型）> 父会话当前模型。
// 与 workflow-actor-tools.ts 是同一个接缝上的姊妹模块：一个给出工具面，一个给出模型面，
// 都由 driver 侧的 runtime 工厂在造 AgentRuntime 时展开。

import type { ModelSelection } from "@zcode/shared/model-selection";
import { parseProviderQualifiedModelSelection } from "./provider-registry-selection.js";
import { parseModelPickerValue } from "@zcode/shared/model-selection";

export function parseWorkflowActorModel(value: string): ModelSelection {
  const parsed = parseModelPickerValue(value);
  if (!parsed || !value.includes("/")) throw new WorkflowActorPinnedModelError(value);
  return parsed;
}

/** 解析模型面需要的宿主侧事实。 */
interface WorkflowActorModelHost {
  actorSelection?: ModelSelection | undefined;
  /**
   * 父会话**当前**的模型选择（`runtime.getSessionModelSelection()`）。只在没有 run 级选择时
   * 有用：与 pin 比对（判断「钉住的模型是否就是现在的主模型」，从而决定 pin 分支要不要真的
   * 覆盖）。父会话尚无选择时缺席。
   */
  parentSelection?: ModelSelection | undefined;
  /**
   * 本 run 自己的子代理模型（`CreateWorkflow` / `AmendWorkflow` 的 `subagent_model`，从 journal
   * 的 `run-launched` 事件读回）。**整条选择**，含 reasoning
   * 档位——用户说「子代理跑 GLM-5.3-Flash$high」时那个档位是选择的一部分，不能在这里掉。
   *
   * 位置：具体 actor 选择之后。它是用户对这一次 run 的显式表态；在场时 pin 与父模型都只是它本来要替换的
   * 缺省（见下面的函数注释）。主代理不受它影响——它只描述子代理。
   */
  runSelection?: ModelSelection | undefined;
}

/** AgentRuntimeConfig 的模型面切片。 */
interface WorkflowActorModelPolicy {
  /**
   * 展开进 AgentRuntimeConfig 的覆盖项。**空对象即「不覆盖」**：child runtime 的基线本就是
   * 父会话的模型选择（script-workflow-child-runtime.ts），所以没有 run 选择也没有 pin 时什么
   * 都不写，就是继承父模型。
   */
  configOverrides: {
    modelSelection?: ModelSelection;
  };
}

/**
 * 钉住的模型无法构造时抛出。带上 pin 本身：排查的人需要知道 journal 里钉的是哪个模型，
 * 而不是从一条「模型引用非法」的通用消息里猜。
 */
export class WorkflowActorPinnedModelError extends Error {
  readonly pinnedModel: string;

  constructor(pinnedModel: string, cause?: unknown) {
    super(`Cannot construct the model pinned for this subagent: ${pinnedModel}`);
    this.name = "WorkflowActorPinnedModelError";
    this.pinnedModel = pinnedModel;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** 具体 actor 选择 > run 默认 > 恢复 pin > 父会话；选择不影响其他 actor 或主会话。 */
export function workflowActorModelPolicy(
  host: WorkflowActorModelHost,
  pinnedModel?: string,
): WorkflowActorModelPolicy {
  // 具体 actor 声明压过 run 默认，避免逐角色选型被整批默认模型覆盖。
  if (host.actorSelection !== undefined) {
    return { configOverrides: { modelSelection: host.actorSelection } };
  }
  // run 选择在场：整条覆盖，pin 连解析都不解析——它只是本 run 要替换掉的那个缺省。
  if (host.runSelection !== undefined) {
    return { configOverrides: { modelSelection: host.runSelection } };
  }
  if (pinnedModel === undefined) return { configOverrides: {} };
  const pinned = parsePinnedModel(pinnedModel);
  // 钉的就是父会话现在的模型：交给 child runtime 的基线自己表达。「不覆盖」是**更强**的
  // 表达——基线连 reasoning 选项一起继承，而按身份覆盖会把选项换成一个少了 options 的等价物。
  if (host.parentSelection !== undefined && sameModelIdentity(pinned, host.parentSelection)) {
    return { configOverrides: {} };
  }
  // 父会话在两次运行之间换了主模型。仍然钉住 pin——静默换模型正是 pin 要防的事；要换，
  // 走 AmendWorkflow 的 subagent_model（上面那一支）。
  // reasoning 选项在这条路径上不重算：pin 守的是**模型身份**（providerId/modelId），journal 里也只记这两段。
  return { configOverrides: { modelSelection: pinned } };
}

/** pin 比对只看身份两段：journal 只记 `providerId/modelId`，options 不是身份的一部分。 */
function sameModelIdentity(a: ModelSelection, b: ModelSelection): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId;
}

/**
 * 解析 journal 里的 pin。**不带默认 provider**：pin 是本机写出的 `providerId/modelId`，
 * 缺了 provider 段就说明这条记录不是这个格式写的（或被改过），此时拿父会话的 provider 去补
 * 等于猜出一个新身份——正是 pin 要防的事。宁可大声失败。
 */
function parsePinnedModel(pinnedModel: string): ModelSelection {
  const parsed = parseProviderQualifiedModelSelection(pinnedModel);
  if (parsed === undefined) throw new WorkflowActorPinnedModelError(pinnedModel);
  return parsed;
}
