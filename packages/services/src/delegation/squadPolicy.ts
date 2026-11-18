import type { WorkTaskExecution } from "@zcode/shared";

/** 小队角色使用保存的完整配置，不能被调用者或父会话模型继承改写。 */
export function sameSquadExecution(left: WorkTaskExecution, right: WorkTaskExecution) {
  return JSON.stringify(left) === JSON.stringify(right);
}
