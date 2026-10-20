/* oxlint-disable eslint(max-lines) -- session workbench group 先把纯模型、localStorage sanitize 和 Zustand 装配收口在一处，避免新功能初版跨文件追状态；后续扩展测试稳定后再拆分。 */
// v4 session workbench groups。
// 这里是 renderer-local 壳子状态：只管 session 到 pane/group 的归属与本地持久化，
// 不下沉到协议、agent、main process 或 web-remote replayable 状态。
import { create } from "zustand";
import { acpAgentSchema, type AcpAgent, type ZCodeTaskClientMode } from "@zcode/shared";
import {
  INITIAL_PANE_LAYOUT,
  MAX_WORKBENCH_PANES,
  V4_PRIMARY_PANE_ID,
  canAddPane,
  clampSplitRatio,
  closePane,
  countPanes,
  focusPane,
  leafPaneIds,
  paneWorkspaceKey,
  setSplitNodeRatio,
  splitPaneAtSide,
  effectiveFocusedPaneId,
  type PaneBinding,
  type PaneCloseReason,
  type PaneLayoutSnapshot,
  type PaneLayoutNode,
  type PaneSplitSide,
  type PaneWorkspaceScope,
} from "@/v4/paneLayoutTree.js";

const WORKBENCH_GROUP_STORAGE_KEY = "zcode-v4-session-workbench-groups:v1";

interface WorkbenchBindingBase {
  readonly workspaceScope: PaneWorkspaceScope;
  /** subagent 行内侧开的 child session 只读，不渲染 composer/input。 */
  readonly readOnly?: boolean;
  /** 从持久化恢复、尚未经当前 scope sessions-index 验证。只存在于内存态。 */
  readonly restoredUnvalidated?: boolean;
}
export interface WorkbenchSessionBinding extends WorkbenchBindingBase {
  readonly sessionId: string;
  readonly kind?: "native" | "acp";
  readonly agent?: AcpAgent;
}

export interface WorkbenchGroup {
  readonly id: string;
  /** 主面板关闭后为 null；剩余 pane 保留原 id 和 binding，不被提升或复制。 */
  readonly primaryBinding: WorkbenchSessionBinding | null;
  readonly root: PaneLayoutNode;
  readonly panes: Readonly<Record<string, WorkbenchSessionBinding>>;
  readonly focusedPaneId: string;
  readonly updatedAt: number;
}

interface WorkbenchGroupSnapshot {
  readonly activeGroupId: string | null;
  readonly groups: Readonly<Record<string, WorkbenchGroup>>;
  readonly sessionIndex: Readonly<Record<string, string>>;
}

interface WorkbenchGroupStore extends WorkbenchGroupSnapshot {
  configureClientMode: (clientMode: ZCodeTaskClientMode) => void;
  openSessionFromSidebar: (binding: WorkbenchSessionBinding) => void;
  splitSessionIntoGroup: (
    anchorPaneId: string,
    side: PaneSplitSide,
    binding: WorkbenchSessionBinding,
    fallbackPrimaryBinding?: WorkbenchSessionBinding,
  ) => void;
  promotePaneLayoutToGroup: (
    primaryBinding: WorkbenchSessionBinding | null,
    layout: PaneLayoutSnapshot,
  ) => boolean;
  focusPane: (groupId: string, paneId: string) => void;
  closePane: (groupId: string, paneId: string, reason?: PaneCloseReason) => void;
  confirmRestoredPaneSession: (groupId: string, paneId: string) => void;
  bindPaneSession: (groupId: string, paneId: string, sessionId: string) => void;
  setSplitRatio: (groupId: string, splitId: string, ratio: number) => void;
  isSessionGrouped: (scope: PaneWorkspaceScope, sessionId: string | null | undefined) => boolean;
  getActiveContext: () => WorkbenchSessionBinding | null;
  deactivateActiveGroup: () => void;
  resetWorkbenchGroups: () => void;
}

const INITIAL_WORKBENCH_GROUP_STATE: WorkbenchGroupSnapshot = {
  activeGroupId: null,
  groups: {},
  sessionIndex: {},
};

let workbenchGroupClientMode: ZCodeTaskClientMode = "desktop-continuous";
let desktopGroupsHydrated = false;

function workbenchGroupsEnabled(): boolean {
  return workbenchGroupClientMode !== "web-remote-replayable";
}

export function buildWorkbenchSessionKey(
  scope: PaneWorkspaceScope,
  sessionId: string,
  kind: "native" | "acp" = "native",
): string {
  return `${paneWorkspaceKey(scope)}::${kind === "acp" ? "acp::" : ""}${sessionId}`;
}

function bindingSessionKey(binding: WorkbenchSessionBinding): string {
  return buildWorkbenchSessionKey(binding.workspaceScope, binding.sessionId, binding.kind);
}

function sameSessionBinding(a: WorkbenchSessionBinding, b: WorkbenchSessionBinding): boolean {
  return bindingSessionKey(a) === bindingSessionKey(b);
}

function paneBinding(binding: WorkbenchSessionBinding): PaneBinding {
  return {
    workspaceScope: binding.workspaceScope,
    sessionId: binding.sessionId,
    ...(binding.kind === "acp" ? { kind: "acp" as const, agent: binding.agent } : {}),
    ...(binding.readOnly ? { readOnly: true } : {}),
    ...(binding.restoredUnvalidated ? { restoredUnvalidated: true } : {}),
  };
}

function workbenchBinding(binding: PaneBinding): WorkbenchSessionBinding | null {
  return typeof binding.sessionId === "string"
    ? {
        workspaceScope: binding.workspaceScope,
        sessionId: binding.sessionId,
        ...(binding.kind === "acp" ? { kind: "acp" as const, agent: binding.agent } : {}),
        ...(binding.readOnly ? { readOnly: true } : {}),
        ...(binding.restoredUnvalidated ? { restoredUnvalidated: true } : {}),
      }
    : null;
}

function groupSessionBindings(group: WorkbenchGroup): WorkbenchSessionBinding[] {
  return group.primaryBinding
    ? [group.primaryBinding, ...Object.values(group.panes)]
    : Object.values(group.panes);
}

function groupContainsBinding(group: WorkbenchGroup, binding: WorkbenchSessionBinding): boolean {
  const key = bindingSessionKey(binding);
  return groupSessionBindings(group).some((candidate) => bindingSessionKey(candidate) === key);
}

export function selectWorkbenchGroupPaneBinding(
  group: WorkbenchGroup,
  paneId: string,
): WorkbenchSessionBinding | null {
  if (paneId === V4_PRIMARY_PANE_ID) {
    return group.primaryBinding;
  }
  return group.panes[paneId] ?? null;
}

export function selectWorkbenchGroupActiveBinding(
  group: WorkbenchGroup,
): WorkbenchSessionBinding | null {
  return selectWorkbenchGroupPaneBinding(group, group.focusedPaneId);
}

function findWorkbenchGroupPaneId(
  group: WorkbenchGroup,
  binding: WorkbenchSessionBinding,
): string | null {
  if (group.primaryBinding && sameSessionBinding(group.primaryBinding, binding)) {
    return V4_PRIMARY_PANE_ID;
  }
  for (const [paneId, candidate] of Object.entries(group.panes)) {
    if (sameSessionBinding(candidate, binding)) {
      return paneId;
    }
  }
  return null;
}

function allocateGroupId(groups: Readonly<Record<string, WorkbenchGroup>>): string {
  let max = 0;
  for (const id of Object.keys(groups)) {
    const match = /^group-(\d+)$/.exec(id);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `group-${max + 1}`;
}

function createWorkbenchGroupFromSessions(
  primary: WorkbenchSessionBinding,
  added: WorkbenchSessionBinding,
  side: PaneSplitSide,
  options: { readonly id?: string; readonly updatedAt?: number } = {},
): WorkbenchGroup {
  const split = splitPaneAtSide(INITIAL_PANE_LAYOUT, V4_PRIMARY_PANE_ID, side, paneBinding(added));
  const panes: Record<string, WorkbenchSessionBinding> = {};
  for (const [paneId, binding] of Object.entries(split.panes)) {
    const converted = workbenchBinding(binding);
    if (converted) {
      panes[paneId] = converted;
    }
  }
  return {
    id: options.id ?? "group-1",
    primaryBinding: primary,
    root: split.root,
    panes,
    focusedPaneId: split.focusedPaneId,
    updatedAt: options.updatedAt ?? Date.now(),
  };
}

function createWorkbenchGroupFromPaneLayout(
  primary: WorkbenchSessionBinding | null,
  layout: PaneLayoutSnapshot,
  options: { readonly id?: string; readonly updatedAt?: number } = {},
): WorkbenchGroup | null {
  const leafIds = leafPaneIds(layout.root);
  const hasPrimary = leafIds.includes(V4_PRIMARY_PANE_ID);
  if (leafIds.length < 2 || (hasPrimary && !primary)) {
    return null;
  }

  const panes: Record<string, WorkbenchSessionBinding> = {};
  for (const paneId of leafIds) {
    if (paneId === V4_PRIMARY_PANE_ID) {
      continue;
    }
    const binding = layout.panes[paneId];
    const converted = binding ? workbenchBinding(binding) : null;
    if (!converted) {
      return null;
    }
    panes[paneId] = converted;
  }

  return {
    id: options.id ?? "group-1",
    primaryBinding: hasPrimary ? primary : null,
    root: layout.root,
    panes,
    focusedPaneId: effectiveFocusedPaneId(layout),
    updatedAt: options.updatedAt ?? Date.now(),
  };
}

function focusWorkbenchGroupPane(
  group: WorkbenchGroup,
  paneId: string,
  updatedAt = Date.now(),
): WorkbenchGroup {
  const focused = focusPane(group, paneId);
  return focused === group ? group : { ...group, focusedPaneId: focused.focusedPaneId, updatedAt };
}

function splitWorkbenchGroupPane(
  group: WorkbenchGroup,
  anchorPaneId: string,
  side: PaneSplitSide,
  binding: WorkbenchSessionBinding,
  updatedAt = Date.now(),
): WorkbenchGroup {
  if (groupContainsBinding(group, binding) || !canAddPane(group)) {
    return group;
  }
  const next = splitPaneAtSide(group, anchorPaneId, side, paneBinding(binding));
  if (next === group) {
    return group;
  }
  const panes: Record<string, WorkbenchSessionBinding> = {};
  for (const [paneId, candidate] of Object.entries(next.panes)) {
    const converted = workbenchBinding(candidate);
    if (converted) {
      panes[paneId] = converted;
    }
  }
  return {
    ...group,
    root: next.root,
    panes,
    focusedPaneId: next.focusedPaneId,
    updatedAt,
  };
}

export function closeWorkbenchGroupPane(
  group: WorkbenchGroup,
  paneId: string,
  reason: PaneCloseReason = "dismiss",
  updatedAt = Date.now(),
): WorkbenchGroup | null {
  if (!leafPaneIds(group.root).includes(paneId)) return group;
  if (countPanes(group) === 1) return reason === "session-removed" ? null : group;
  const next = closePane(group, paneId, reason);
  if (next === group) {
    return group;
  }
  const panes: Record<string, WorkbenchSessionBinding> = {};
  for (const [nextPaneId, binding] of Object.entries(next.panes)) {
    const converted = workbenchBinding(binding);
    if (converted) {
      panes[nextPaneId] = converted;
    }
  }
  // 修复原因：解散组会使存活 ACP 失去显式绑定，并重新显示 shell 的空白主草稿。
  return {
    ...group,
    primaryBinding: paneId === V4_PRIMARY_PANE_ID ? null : group.primaryBinding,
    root: next.root,
    panes,
    focusedPaneId: next.focusedPaneId,
    updatedAt,
  };
}

function confirmRestoredWorkbenchGroupPane(group: WorkbenchGroup, paneId: string): WorkbenchGroup {
  if (paneId === V4_PRIMARY_PANE_ID) {
    if (!group.primaryBinding?.restoredUnvalidated) {
      return group;
    }
    const { restoredUnvalidated: _restored, ...primaryBinding } = group.primaryBinding;
    return { ...group, primaryBinding };
  }
  const binding = group.panes[paneId];
  if (!binding?.restoredUnvalidated) {
    return group;
  }
  const { restoredUnvalidated: _restored, ...confirmed } = binding;
  return {
    ...group,
    panes: { ...group.panes, [paneId]: confirmed },
  };
}

function rebuildSessionIndex(
  groups: Readonly<Record<string, WorkbenchGroup>>,
): Record<string, string> {
  const index: Record<string, string> = {};
  for (const group of Object.values(groups)) {
    for (const binding of groupSessionBindings(group)) {
      index[bindingSessionKey(binding)] = group.id;
    }
  }
  return index;
}

function replaceGroup(
  state: WorkbenchGroupSnapshot,
  group: WorkbenchGroup,
): WorkbenchGroupSnapshot {
  const groups = { ...state.groups, [group.id]: group };
  return {
    activeGroupId: group.id,
    groups,
    sessionIndex: rebuildSessionIndex(groups),
  };
}

function removeGroup(state: WorkbenchGroupSnapshot, groupId: string): WorkbenchGroupSnapshot {
  const groups = { ...state.groups };
  delete groups[groupId];
  return {
    activeGroupId: state.activeGroupId === groupId ? null : state.activeGroupId,
    groups,
    sessionIndex: rebuildSessionIndex(groups),
  };
}

function splitSessionIntoSnapshot(
  state: WorkbenchGroupSnapshot,
  anchorPaneId: string,
  side: PaneSplitSide,
  binding: WorkbenchSessionBinding,
  fallbackPrimaryBinding?: WorkbenchSessionBinding,
): WorkbenchGroupSnapshot {
  const sessionKey = bindingSessionKey(binding);
  if (state.sessionIndex[sessionKey]) {
    return state;
  }

  const activeGroup = state.activeGroupId ? state.groups[state.activeGroupId] : undefined;
  if (activeGroup) {
    const nextGroup = splitWorkbenchGroupPane(activeGroup, anchorPaneId, side, binding);
    return nextGroup === activeGroup ? state : replaceGroup(state, nextGroup);
  }

  if (
    !fallbackPrimaryBinding ||
    sameSessionBinding(fallbackPrimaryBinding, binding) ||
    state.sessionIndex[bindingSessionKey(fallbackPrimaryBinding)]
  ) {
    return state;
  }

  const group = createWorkbenchGroupFromSessions(fallbackPrimaryBinding, binding, side, {
    id: allocateGroupId(state.groups),
  });
  return replaceGroup(state, group);
}

function promotePaneLayoutToGroupSnapshot(
  state: WorkbenchGroupSnapshot,
  primaryBinding: WorkbenchSessionBinding | null,
  layout: PaneLayoutSnapshot,
): WorkbenchGroupSnapshot {
  const group = createWorkbenchGroupFromPaneLayout(primaryBinding, layout, {
    id: allocateGroupId(state.groups),
  });
  if (!group) {
    return state;
  }

  const sessionKeys = groupSessionBindings(group).map(bindingSessionKey);
  if (
    new Set(sessionKeys).size !== sessionKeys.length ||
    sessionKeys.some((key) => Boolean(state.sessionIndex[key]))
  ) {
    return state;
  }

  return replaceGroup(state, group);
}

function focusSessionInSnapshot(
  state: WorkbenchGroupSnapshot,
  binding: WorkbenchSessionBinding,
): WorkbenchGroupSnapshot {
  const groupId = state.sessionIndex[bindingSessionKey(binding)];
  if (!groupId) {
    return state.activeGroupId === null ? state : { ...state, activeGroupId: null };
  }
  const group = state.groups[groupId];
  if (!group) {
    return { ...state, activeGroupId: null };
  }
  const paneId = findWorkbenchGroupPaneId(group, binding);
  if (!paneId) {
    return state;
  }
  const focused = focusWorkbenchGroupPane(group, paneId);
  return replaceGroup(
    {
      ...state,
      activeGroupId: groupId,
    },
    focused,
  );
}

function bindPaneSessionInSnapshot(
  state: WorkbenchGroupSnapshot,
  groupId: string,
  paneId: string,
  sessionId: string,
): WorkbenchGroupSnapshot {
  const group = state.groups[groupId];
  const binding = group ? selectWorkbenchGroupPaneBinding(group, paneId) : null;
  if (!group || !binding || binding.kind === "acp" || binding.sessionId === sessionId) {
    return state;
  }

  const nextBinding: WorkbenchSessionBinding = {
    workspaceScope: binding.workspaceScope,
    sessionId,
    ...(binding.readOnly ? { readOnly: true } : {}),
  };
  const nextKey = bindingSessionKey(nextBinding);
  const existingGroupId = state.sessionIndex[nextKey];
  if (existingGroupId && existingGroupId !== groupId) {
    return state;
  }
  if (existingGroupId === groupId && !sameSessionBinding(binding, nextBinding)) {
    return state;
  }

  const nextGroup: WorkbenchGroup =
    paneId === V4_PRIMARY_PANE_ID
      ? { ...group, primaryBinding: nextBinding, updatedAt: Date.now() }
      : {
          ...group,
          panes: { ...group.panes, [paneId]: nextBinding },
          updatedAt: Date.now(),
        };
  return replaceGroup(state, nextGroup);
}

function safeStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizePaneLayoutNode(value: unknown): PaneLayoutNode | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  if (value.type === "leaf") {
    return typeof value.paneId === "string" ? { type: "leaf", paneId: value.paneId } : null;
  }
  if (value.type !== "split") {
    return null;
  }
  const first = sanitizePaneLayoutNode(value.first);
  const second = sanitizePaneLayoutNode(value.second);
  if (
    !first ||
    !second ||
    typeof value.id !== "string" ||
    (value.direction !== "row" && value.direction !== "column")
  ) {
    return null;
  }
  return {
    type: "split",
    id: value.id,
    direction: value.direction,
    ratio: clampSplitRatio(typeof value.ratio === "number" ? value.ratio : Number.NaN),
    first,
    second,
  };
}

function sanitizeWorkspaceScope(value: unknown): PaneWorkspaceScope | null {
  if (!isRecord(value) || typeof value.workspacePath !== "string") {
    return null;
  }
  return {
    workspacePath: value.workspacePath,
    workspaceIdentity:
      typeof value.workspaceIdentity === "string" ? value.workspaceIdentity : undefined,
    remoteSessionId: typeof value.remoteSessionId === "string" ? value.remoteSessionId : undefined,
  };
}

function sanitizeBinding(value: unknown): WorkbenchSessionBinding | null {
  if (!isRecord(value) || typeof value.sessionId !== "string") {
    return null;
  }
  if (value.readOnly === true) {
    // 迁移说明：历史 readOnly binding 只由“在分屏打开 subagent”产生。子会话详情已迁到
    // 右侧 tabs，恢复时丢弃包含该 binding 的旧 group，避免升级后继续占用 4-pane workbench；
    // 普通 session binding 没有 readOnly 标记，不受影响。
    return null;
  }
  const workspaceScope = sanitizeWorkspaceScope(value.workspaceScope);
  const acpAgent = value.kind === "acp" ? acpAgentSchema.safeParse(value.agent) : null;
  if (value.kind === "acp" && !acpAgent?.success) return null;
  return workspaceScope
    ? {
        workspaceScope,
        sessionId: value.sessionId,
        ...(acpAgent?.success ? { kind: "acp" as const, agent: acpAgent.data } : {}),
        // group 恢复过去绕过了 paneLayout 的 sessions-index 守卫，已删除
        // session 会永久留下空 pane；恢复 binding 必须显式进入待验证态。
        restoredUnvalidated: true,
      }
    : null;
}

function sanitizeWorkbenchGroup(value: unknown): WorkbenchGroup | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }
  const root = sanitizePaneLayoutNode(value.root);
  if (!root) {
    return null;
  }

  const leafIds = leafPaneIds(root);
  const uniqueLeafIds = new Set(leafIds);
  if (uniqueLeafIds.size !== leafIds.length || leafIds.length > MAX_WORKBENCH_PANES) {
    return null;
  }
  const hasPrimary = uniqueLeafIds.has(V4_PRIMARY_PANE_ID);
  const primaryBinding = hasPrimary ? sanitizeBinding(value.primaryBinding) : null;
  if ((hasPrimary && !primaryBinding) || (!hasPrimary && value.primaryBinding != null)) {
    return null;
  }

  const rawPanes = isRecord(value.panes) ? value.panes : {};
  const panes: Record<string, WorkbenchSessionBinding> = {};
  for (const paneId of leafIds) {
    if (paneId === V4_PRIMARY_PANE_ID) {
      continue;
    }
    const binding = sanitizeBinding(rawPanes[paneId]);
    if (!binding) {
      return null;
    }
    panes[paneId] = binding;
  }

  const focusedPaneId = effectiveFocusedPaneId({
    root,
    panes,
    focusedPaneId: typeof value.focusedPaneId === "string" ? value.focusedPaneId : "",
  });
  const group: WorkbenchGroup = {
    id: value.id,
    primaryBinding,
    root,
    panes,
    focusedPaneId,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
  return group;
}

function sanitizePersistedWorkbenchGroups(value: unknown): WorkbenchGroupSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const rawGroups = isRecord(value.groups) ? Object.values(value.groups) : [];
  const groups: Record<string, WorkbenchGroup> = {};
  const sessionIndex: Record<string, string> = {};
  for (const rawGroup of rawGroups) {
    const group = sanitizeWorkbenchGroup(rawGroup);
    if (!group || groups[group.id]) {
      continue;
    }
    const keys = groupSessionBindings(group).map(bindingSessionKey);
    if (keys.some((key) => sessionIndex[key])) {
      continue;
    }
    groups[group.id] = group;
    for (const key of keys) {
      sessionIndex[key] = group.id;
    }
  }
  if (Object.keys(groups).length === 0) {
    return null;
  }
  const activeGroupId =
    typeof value.activeGroupId === "string" && groups[value.activeGroupId]
      ? value.activeGroupId
      : null;
  return { activeGroupId, groups, sessionIndex };
}

function persistWorkbenchGroups(snapshot: WorkbenchGroupSnapshot): void {
  if (!workbenchGroupsEnabled()) {
    return;
  }
  const storage = safeStorage();
  if (!storage) {
    return;
  }
  try {
    const groups = Object.fromEntries(
      Object.entries(snapshot.groups).map(([groupId, group]) => {
        const { restoredUnvalidated: _primaryRestored, ...persistedPrimary } =
          group.primaryBinding ?? {};
        const primaryBinding = group.primaryBinding ? persistedPrimary : null;
        const panes = Object.fromEntries(
          Object.entries(group.panes).map(([paneId, binding]) => {
            const { restoredUnvalidated: _restored, ...persisted } = binding;
            return [paneId, persisted];
          }),
        );
        return [groupId, { ...group, primaryBinding, panes }];
      }),
    );
    storage.setItem(
      WORKBENCH_GROUP_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeGroupId: snapshot.activeGroupId,
        // restoredUnvalidated 是本次 hydration 的内存状态，不能写回成为持久 schema。
        groups,
        sessionIndex: snapshot.sessionIndex,
      }),
    );
  } catch {
    // localStorage 配额/权限失败不影响 renderer 内存态。
  }
}

function readPersistedWorkbenchGroups(): WorkbenchGroupSnapshot | null {
  if (!workbenchGroupsEnabled()) {
    return null;
  }
  const storage = safeStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(WORKBENCH_GROUP_STORAGE_KEY);
    return raw ? sanitizePersistedWorkbenchGroups(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export const useWorkbenchGroupStore = create<WorkbenchGroupStore>()((set, get) => ({
  ...INITIAL_WORKBENCH_GROUP_STATE,

  configureClientMode: (clientMode) => {
    if (clientMode === "web-remote-replayable") {
      // 过去 remote 只在聊天区隐藏 activeGroup，store 仍会在模块加载时
      // 恢复并由 sidebar/new-task 消费，还会把隐藏状态继续写回。先切换 gate 再清
      // 内存，确保清理动作本身也不会触碰 remote 的 localStorage。
      workbenchGroupClientMode = clientMode;
      desktopGroupsHydrated = false;
      set(INITIAL_WORKBENCH_GROUP_STATE);
      return;
    }

    workbenchGroupClientMode = clientMode;
    if (desktopGroupsHydrated) {
      return;
    }
    desktopGroupsHydrated = true;
    const restored = readPersistedWorkbenchGroups();
    if (restored) {
      set(restored);
    }
  },

  openSessionFromSidebar: (binding) => {
    if (!workbenchGroupsEnabled()) {
      return;
    }
    set((state) => focusSessionInSnapshot(state, binding));
  },

  splitSessionIntoGroup: (anchorPaneId, side, binding, fallbackPrimaryBinding) => {
    if (!workbenchGroupsEnabled()) {
      return;
    }
    set((state) =>
      splitSessionIntoSnapshot(state, anchorPaneId, side, binding, fallbackPrimaryBinding),
    );
  },

  promotePaneLayoutToGroup: (primaryBinding, layout) => {
    if (!workbenchGroupsEnabled()) {
      return false;
    }
    const current = get();
    const next = promotePaneLayoutToGroupSnapshot(current, primaryBinding, layout);
    if (next === current) {
      return false;
    }
    set(next);
    return true;
  },

  focusPane: (groupId, paneId) => {
    if (!workbenchGroupsEnabled()) {
      return;
    }
    set((state) => {
      const group = state.groups[groupId];
      if (!group) {
        return state;
      }
      const focused = focusWorkbenchGroupPane(group, paneId);
      return focused === group && state.activeGroupId === groupId
        ? state
        : replaceGroup({ ...state, activeGroupId: groupId }, focused);
    });
  },

  closePane: (groupId, paneId, reason) => {
    if (!workbenchGroupsEnabled()) {
      return;
    }
    set((state) => {
      const group = state.groups[groupId];
      if (!group) {
        return state;
      }
      const nextGroup = closeWorkbenchGroupPane(group, paneId, reason);
      if (!nextGroup) {
        return removeGroup(state, groupId);
      }
      return nextGroup === group ? state : replaceGroup(state, nextGroup);
    });
  },

  confirmRestoredPaneSession: (groupId, paneId) => {
    if (!workbenchGroupsEnabled()) {
      return;
    }
    set((state) => {
      const group = state.groups[groupId];
      if (!group) {
        return state;
      }
      const confirmed = confirmRestoredWorkbenchGroupPane(group, paneId);
      return confirmed === group ? state : replaceGroup(state, confirmed);
    });
  },

  bindPaneSession: (groupId, paneId, sessionId) => {
    if (!workbenchGroupsEnabled()) {
      return;
    }
    set((state) => bindPaneSessionInSnapshot(state, groupId, paneId, sessionId));
  },

  setSplitRatio: (groupId, splitId, ratio) => {
    if (!workbenchGroupsEnabled()) {
      return;
    }
    set((state) => {
      const group = state.groups[groupId];
      if (!group) {
        return state;
      }
      const nextLayout = setSplitNodeRatio(group, splitId, ratio);
      if (nextLayout.root === group.root) {
        return state;
      }
      // promote 后可见布局的唯一 owner 是 group；占比更新只替换 root，
      // workspaceIdentity/remoteSessionId binding 与 sessionIndex 必须原样保留。
      return replaceGroup(state, {
        ...group,
        root: nextLayout.root,
        updatedAt: Date.now(),
      });
    });
  },

  isSessionGrouped: (scope, sessionId) => {
    if (!workbenchGroupsEnabled() || !sessionId) {
      return false;
    }
    return Boolean(get().sessionIndex[buildWorkbenchSessionKey(scope, sessionId)]);
  },

  getActiveContext: () => {
    if (!workbenchGroupsEnabled()) {
      return null;
    }
    const state = get();
    const group = state.activeGroupId ? state.groups[state.activeGroupId] : undefined;
    return group ? selectWorkbenchGroupActiveBinding(group) : null;
  },

  deactivateActiveGroup: () => {
    if (!workbenchGroupsEnabled()) {
      return;
    }
    set((state) => (state.activeGroupId === null ? state : { ...state, activeGroupId: null }));
  },

  resetWorkbenchGroups: () => {
    set(INITIAL_WORKBENCH_GROUP_STATE);
  },
}));

useWorkbenchGroupStore.subscribe((state) => {
  if (workbenchGroupsEnabled()) {
    persistWorkbenchGroups(state);
  }
});
