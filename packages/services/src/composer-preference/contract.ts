import type { Event } from "@zcode/rpc";
import {
  ServiceChannels,
  type ComposerPreference,
  type ComposerPreferenceScope,
  type ComposerPreferenceUpdate,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/** 目标 Host 持久化偏好；草稿与会话执行状态分别保留自己的所有者。 */
export interface IComposerPreferenceService {
  get(scope: ComposerPreferenceScope): Promise<ComposerPreference>;
  update(input: ComposerPreferenceUpdate): Promise<ComposerPreference>;
  onDynamicChanged(scope: ComposerPreferenceScope): Event<ComposerPreference>;
}
export const IComposerPreferenceService = createServiceDescriptor<IComposerPreferenceService>(
  ServiceChannels.ComposerPreference,
);
