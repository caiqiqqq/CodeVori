import { logger } from "@/logger.js";
import type { AcpAgent } from "@zcode/shared";
import {
  V4_PRIMARY_PANE_ID,
  canAddPane,
  effectiveFocusedPaneId,
  findPaneIdForSession,
  paneBindingMatchesSession,
  paneWorkspaceKey,
  usePaneLayoutStore,
  type PaneSplitSide,
  type PaneWorkspaceScope,
} from "@/v4/paneLayoutStore.js";
import {
  buildWorkbenchSessionKey,
  selectWorkbenchGroupActiveBinding,
  useWorkbenchGroupStore,
  type WorkbenchSessionBinding,
} from "@/v4/workbenchGroupStore.js";

export interface WorkbenchSessionTarget extends PaneWorkspaceScope {
  readonly sessionId: string;
  readonly kind?: "native" | "acp";
  readonly agent?: AcpAgent;
}

interface WorkbenchSplitPlacementOptions {
  readonly mode: "context-menu" | "drag";
  readonly side: PaneSplitSide;
  readonly anchorPaneId?: string;
}

type SplitKind =
  | "blocked"
  | "focus-group"
  | "focus-pane"
  | "split-group"
  | "split-draft"
  | "create-group"
  | "promote-and-split";

interface SplitResolution {
  readonly kind: SplitKind;
  readonly binding: WorkbenchSessionBinding;
  readonly anchorPaneId: string;
  readonly side: PaneSplitSide;
  readonly paneId?: string;
  readonly primaryBinding?: WorkbenchSessionBinding;
}

function targetBinding(target: WorkbenchSessionTarget): WorkbenchSessionBinding {
  const { sessionId, kind, agent: _agent, ...workspaceScope } = target;
  return kind === "acp"
    ? { workspaceScope, sessionId, kind, agent: target.agent }
    : { workspaceScope, sessionId };
}

function draftPrimaryOwnsLayout(shellBinding: WorkbenchSessionBinding | null): boolean {
  const layout = usePaneLayoutStore.getState();
  if (Object.keys(layout.panes).length === 0) {
    return false;
  }
  return (
    !shellBinding ||
    Object.values(layout.panes).some((binding) =>
      paneBindingMatchesSession(
        binding,
        shellBinding.workspaceScope,
        shellBinding.sessionId,
        shellBinding.kind,
      ),
    )
  );
}

function resolveSplit(
  shellBinding: WorkbenchSessionBinding | null,
  target: WorkbenchSessionTarget,
  options: WorkbenchSplitPlacementOptions,
): SplitResolution {
  const groups = useWorkbenchGroupStore.getState();
  const layout = usePaneLayoutStore.getState();
  const activeGroup = groups.activeGroupId ? groups.groups[groups.activeGroupId] : undefined;
  const focusedPaneId = activeGroup?.focusedPaneId ?? effectiveFocusedPaneId(layout);
  const focusedPane =
    !activeGroup && focusedPaneId !== V4_PRIMARY_PANE_ID ? layout.panes[focusedPaneId] : undefined;
  const focusedBinding = activeGroup
    ? selectWorkbenchGroupActiveBinding(activeGroup)
    : focusedPane?.sessionId
      ? targetBinding({
          workspacePath: focusedPane.workspaceScope.workspacePath,
          ...(focusedPane.workspaceScope.workspaceIdentity
            ? { workspaceIdentity: focusedPane.workspaceScope.workspaceIdentity }
            : {}),
          ...(focusedPane.workspaceScope.remoteSessionId
            ? { remoteSessionId: focusedPane.workspaceScope.remoteSessionId }
            : {}),
          sessionId: focusedPane.sessionId,
          ...(focusedPane.kind === "acp" ? { kind: "acp" as const, agent: focusedPane.agent } : {}),
        })
      : shellBinding;
  const binding = targetBinding(target);
  const base = {
    anchorPaneId: options.anchorPaneId ?? focusedPaneId,
    binding,
    side: options.side,
  };

  if (paneBindingMatchesSession(focusedBinding, target, target.sessionId, target.kind)) {
    return { kind: "blocked", ...base };
  }
  if (groups.sessionIndex[buildWorkbenchSessionKey(target, target.sessionId, target.kind)]) {
    return { kind: "focus-group", ...base };
  }
  const paneId = findPaneIdForSession(layout, target, target.sessionId, target.kind);
  if (paneId) {
    return { kind: "focus-pane", paneId, ...base };
  }
  if (!canAddPane(activeGroup ?? layout)) {
    return { kind: "blocked", ...base };
  }
  if (activeGroup) {
    return { kind: "split-group", ...base };
  }
  if (draftPrimaryOwnsLayout(shellBinding) || !shellBinding) {
    return { kind: "split-draft", ...base };
  }
  return Object.keys(layout.panes).length > 0
    ? { kind: "promote-and-split", primaryBinding: shellBinding, ...base }
    : {
        kind: "create-group",
        anchorPaneId: V4_PRIMARY_PANE_ID,
        primaryBinding: shellBinding,
        binding,
        side: options.side,
      };
}

function resolutionAllowed(
  resolution: SplitResolution,
  mode: WorkbenchSplitPlacementOptions["mode"],
): boolean {
  return (
    resolution.kind !== "blocked" &&
    (mode === "context-menu" || !resolution.kind.startsWith("focus"))
  );
}

export function canPlaceWorkbenchSessionInSplit(
  shellBinding: WorkbenchSessionBinding | null,
  target: WorkbenchSessionTarget,
  options: WorkbenchSplitPlacementOptions,
): boolean {
  return resolutionAllowed(resolveSplit(shellBinding, target, options), options.mode);
}

export function placeWorkbenchSessionInSplit(
  shellBinding: WorkbenchSessionBinding | null,
  target: WorkbenchSessionTarget,
  options: WorkbenchSplitPlacementOptions,
): boolean {
  const resolution = resolveSplit(shellBinding, target, options);
  if (!resolutionAllowed(resolution, options.mode)) {
    return false;
  }
  const groups = useWorkbenchGroupStore.getState();
  const layout = usePaneLayoutStore.getState();
  if (resolution.kind === "focus-group") {
    groups.openSessionFromSidebar(resolution.binding);
  } else if (resolution.kind === "focus-pane" && resolution.paneId) {
    layout.focusPane(resolution.paneId);
    groups.openSessionFromSidebar(resolution.binding);
  } else if (resolution.kind === "split-group") {
    groups.splitSessionIntoGroup(resolution.anchorPaneId, resolution.side, resolution.binding);
  } else if (resolution.kind === "split-draft") {
    layout.splitPaneWithBinding(resolution.anchorPaneId, resolution.side, {
      workspaceScope: resolution.binding.workspaceScope,
      sessionId: resolution.binding.sessionId,
      ...(resolution.binding.kind === "acp"
        ? { kind: "acp" as const, agent: resolution.binding.agent }
        : {}),
    });
    logger.debug("[v4-workbench] session split beside primary draft", {
      sessionId: resolution.binding.sessionId,
      workspaceKey: paneWorkspaceKey(resolution.binding.workspaceScope),
    });
    return false;
  } else if (resolution.primaryBinding) {
    if (resolution.kind === "promote-and-split") {
      if (!groups.promotePaneLayoutToGroup(resolution.primaryBinding, layout)) {
        return false;
      }
      layout.resetToPrimaryPane();
      useWorkbenchGroupStore
        .getState()
        .splitSessionIntoGroup(resolution.anchorPaneId, resolution.side, resolution.binding);
    } else {
      groups.splitSessionIntoGroup(
        resolution.anchorPaneId,
        resolution.side,
        resolution.binding,
        resolution.primaryBinding,
      );
    }
  }
  return true;
}

export function selectWorkbenchSession(
  shellBinding: WorkbenchSessionBinding | null,
  target: WorkbenchSessionTarget,
): void {
  const groups = useWorkbenchGroupStore.getState();
  const layout = usePaneLayoutStore.getState();
  const binding = targetBinding(target);
  if (
    !groups.activeGroupId &&
    !groups.sessionIndex[buildWorkbenchSessionKey(target, target.sessionId, target.kind)] &&
    draftPrimaryOwnsLayout(shellBinding)
  ) {
    const existingPaneId = findPaneIdForSession(layout, target, target.sessionId, target.kind);
    const paneId = existingPaneId ?? effectiveFocusedPaneId(layout);
    if (existingPaneId) {
      layout.focusPane(existingPaneId);
    } else if (paneId !== V4_PRIMARY_PANE_ID && layout.panes[paneId]) {
      const previousSessionId = layout.panes[paneId]?.sessionId ?? null;
      // shell activeTaskId 先切换会把新 session 灌进 primary draft；
      // 必须先原子替换 focused secondary 的完整 binding。
      layout.replacePaneBinding(paneId, {
        workspaceScope: binding.workspaceScope,
        sessionId: binding.sessionId,
        ...(binding.kind === "acp" ? { kind: "acp" as const, agent: binding.agent } : {}),
      });
      logger.debug("[v4-workbench] draft split focused pane replaced", {
        paneId,
        previousSessionId,
        sessionId: binding.sessionId,
        workspaceKey: paneWorkspaceKey(binding.workspaceScope),
      });
    }
  }
  groups.openSessionFromSidebar(binding);
}
