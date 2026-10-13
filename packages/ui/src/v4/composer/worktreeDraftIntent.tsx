import { createContext, useContext } from "react";
import type { AcpAgent, GitCreateWorktreeResult } from "@zcode/shared";
import type { V4ComposerDraft } from "./composerDraftStore.js";

export interface WorktreeDraftSelection {
  workspaceKey: string;
  draftFocusVersion: number;
  sourceBranchName: string;
}

export interface WorktreeAutoSendRequest {
  requestId: number;
  workspacePath: string;
  draftFocusVersion: number;
  text: string;
  agent: AcpAgent | null;
  trigger: "button" | "shortcut";
}

export interface WorktreeDraftIntent {
  selected: boolean;
  select: (selected: boolean, sourceBranchName?: string) => void;
  createWorktree: () => Promise<GitCreateWorktreeResult>;
  autoSend: WorktreeAutoSendRequest | null;
  openCreatedWorktree: (
    path: string,
    draft: V4ComposerDraft,
    agent: AcpAgent | null,
    trigger: WorktreeAutoSendRequest["trigger"],
  ) => void;
  consumeAutoSend: (requestId: number) => void;
}

export const WorktreeDraftIntentContext = createContext<WorktreeDraftIntent | null>(null);

export function useWorktreeDraftIntent(): WorktreeDraftIntent | null {
  return useContext(WorktreeDraftIntentContext);
}

export function isWorktreeDraftSelectionActive(
  selection: WorktreeDraftSelection | null,
  workspaceKey: string,
  draftFocusVersion: number,
  sessionId: string | null,
): boolean {
  return (
    sessionId === null &&
    selection?.workspaceKey === workspaceKey &&
    selection.draftFocusVersion === draftFocusVersion
  );
}

export function isWorktreeAutoSendTarget(
  request: WorktreeAutoSendRequest | null,
  workspacePath: string,
  workspaceIdentity: string | undefined,
  sessionId: string | null,
): boolean {
  return (
    request !== null &&
    sessionId === null &&
    !workspaceIdentity?.trim() &&
    request.workspacePath === workspacePath
  );
}

export function hasUntransferableWorktreeContext(context: {
  attachments: number;
  contexts: number;
  mentions: number;
}): boolean {
  return context.attachments > 0 || context.contexts > 0 || context.mentions > 0;
}

export function shouldInheritWorktreeAutoSendDraft(
  request: WorktreeAutoSendRequest | null,
  workspacePath: string,
  workspaceIdentity: string | undefined,
  sessionId: string | null,
  agent: AcpAgent | null,
  isNewAcpDraft: boolean,
): boolean {
  // ACP 独立 scope 只继承准确目标的一次性工作树草稿，不能让历史会话读 root。
  return Boolean(
    isNewAcpDraft &&
    agent &&
    request?.agent === agent &&
    isWorktreeAutoSendTarget(request, workspacePath, workspaceIdentity, sessionId),
  );
}
