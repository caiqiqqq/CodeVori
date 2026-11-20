import { useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import type { AgentSquad, AgentSquadSave, AgentProfileSave } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog.js";
import { useAgentSquads } from "@/hooks/useAgentSquads.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { AgentSquadEditor } from "./AgentSquadEditor.js";
import { AgentProfileEditor } from "./AgentProfileEditor.js";
import { squadDraft, squadRoleDraft } from "./agentSquadDraft.js";

type Props = {
  workspacePath: string | null;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
};
export function AgentSquadsSection(props: Props) {
  const resolution = useWorkspaceServicesResolution(
    props.workspacePath,
    props.remoteSessionId,
    props.workspaceIdentity,
    props.remoteTarget,
  );
  // Host/工作区切换必须重建草稿，避免把旧连接中的配置提交到新目标。
  const key = JSON.stringify([
    props.workspaceIdentity?.trim() || props.workspacePath,
    props.workspacePath,
    resolution.remoteSessionId,
    resolution.rpcReady,
    resolution.isRemoteTarget,
    Boolean(props.remoteTarget),
  ]);
  return <SquadsContent key={key} {...props} />;
}
function SquadsContent({ workspacePath, workspaceIdentity, remoteSessionId, remoteTarget }: Props) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `squads.${key}` });
  const squads = useAgentSquads(
    workspacePath,
    workspaceIdentity,
    true,
    true,
    remoteSessionId,
    remoteTarget,
  );
  const [draft, setDraft] = useState<AgentSquadSave | null>(null);
  const [profileDraft, setProfileDraft] = useState<{
    draft: AgentProfileSave;
    memberId?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<AgentSquad | null>(null);
  const blocked = squads.busy || squads.loading || !squads.available;
  const createProfile = (memberId?: string) => {
    const target = squads.targets[0];
    if (!target) return;
    const role = squadRoleDraft(target, "", "");
    setProfileDraft({
      memberId,
      draft: {
        id: role.id,
        expectedRevision: 0,
        name: "",
        description: "",
        instructions: "",
        execution: role.execution,
      },
    });
  };
  return (
    <section data-testid="squads-settings" className="mt-3 min-w-0 space-y-4">
      <p className="text-ui-caption text-foreground-subtle">{t("intro")}</p>
      {squads.error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-ui-base text-destructive"
        >
          {squads.error}
          <Button variant="outline" onClick={() => void squads.refresh()}>
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {!squads.available ? (
        <p className="text-ui-caption text-foreground-subtle">{t("unavailable")}</p>
      ) : null}
      {draft ? (
        <AgentSquadEditor
          draft={draft}
          profiles={squads.profiles}
          onCreateProfile={createProfile}
          busy={blocked || !!profileDraft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => {
            void squads.save(draft).then((saved) => {
              if (saved) setDraft(null);
            });
          }}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-ui-caption text-foreground-subtle">{t("usage")}</span>
            <Button
              disabled={blocked || !squads.profiles.length || !!profileDraft}
              onClick={() => {
                const leader = squads.profiles[0];
                if (!leader) return;
                const member = squads.profiles[1];
                setDraft({
                  id: crypto.randomUUID(),
                  expectedRevision: 0,
                  name: "",
                  description: "",
                  instructions: "",
                  leader: {
                    id: crypto.randomUUID(),
                    agentId: leader.id,
                    role: t("defaultLeaderRole"),
                  },
                  members: [
                    {
                      id: crypto.randomUUID(),
                      agentId: member?.id ?? "",
                      role: member?.instructions.slice(0, 4000) ?? "",
                    },
                  ],
                });
              }}
            >
              <Plus className="size-4" />
              {t("create")}
            </Button>
          </div>
          {!squads.loading && squads.available && !squads.profiles.length ? (
            <div className="space-y-2">
              <p className="text-ui-caption text-foreground-subtle">{t("noProfiles")}</p>
              <Button
                variant="outline"
                disabled={blocked || !squads.targets.length || !!profileDraft}
                onClick={() => createProfile()}
              >
                <Plus className="size-4" />
                {intl.formatMessage({ id: "agentProfiles.create" })}
              </Button>
              {!squads.targets.length ? (
                <p className="text-ui-caption text-foreground-subtle">
                  {intl.formatMessage({ id: "agentProfiles.noTargets" })}
                </p>
              ) : null}
            </div>
          ) : null}
          {squads.squads.length ? (
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-card-border bg-card">
              <div
                className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_auto] gap-3 px-4 py-2 text-ui-caption text-foreground-subtle sm:grid"
                aria-hidden="true"
              >
                <span>{t("name")}</span>
                <span>{t("leader")}</span>
                <span>{t("members")}</span>
                <span className="w-16" />
              </div>
              {squads.squads.map((squad) => (
                <div
                  key={squad.id}
                  data-testid="squad-row"
                  className="grid min-w-0 gap-3 p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-ui-base font-medium">
                      <Users className="size-4 shrink-0" />
                      <span className="break-words">{squad.name}</span>
                    </div>
                    {squad.description ? (
                      <p className="mt-1 break-words text-ui-caption text-foreground-subtle">
                        {squad.description}
                      </p>
                    ) : null}
                  </div>
                  <p className="break-words text-ui-base">
                    <span className="text-foreground-subtle sm:hidden">{t("leader")}: </span>
                    {squad.leader.name}
                  </p>
                  <p className="break-words text-ui-caption text-foreground-subtle">
                    <span className="sm:hidden">{t("members")}: </span>
                    {squad.members.map((member) => member.name).join(" · ")}
                  </p>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("edit")}
                      className="text-foreground-subtle"
                      disabled={blocked}
                      onClick={() => setDraft(squadDraft(squad))}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("delete")}
                      className="text-foreground-subtle"
                      disabled={blocked}
                      onClick={() => setDeleting(squad)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-ui-caption text-foreground-subtle">
              {squads.loading ? t("loading") : t("empty")}
            </p>
          )}
        </>
      )}
      {profileDraft ? (
        <AgentProfileEditor
          draft={profileDraft.draft}
          workspacePath={workspacePath}
          targets={squads.targets}
          busy={blocked}
          onChange={(next) =>
            setProfileDraft((previous) => (previous ? { ...previous, draft: next } : null))
          }
          onCancel={() => setProfileDraft(null)}
          onSave={() => {
            const memberId = profileDraft.memberId;
            void squads.saveProfile(profileDraft.draft).then((saved) => {
              if (!saved) return;
              setDraft((previous) => {
                if (!previous || !memberId) return previous;
                const assign = (member: AgentSquadSave["leader"]) =>
                  member.id === memberId
                    ? {
                        ...member,
                        agentId: saved.id,
                        role: member.role || saved.instructions.slice(0, 4000),
                      }
                    : member;
                return {
                  ...previous,
                  leader: assign(previous.leader),
                  members: previous.members.map(assign),
                };
              });
              setProfileDraft(null);
            });
          }}
        />
      ) : null}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !squads.busy) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteHint")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={squads.busy}>
              {intl.formatMessage({ id: "common.cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={squads.busy}
              onClick={(event) => {
                event.preventDefault();
                if (deleting)
                  void squads
                    .remove({ id: deleting.id, expectedRevision: deleting.revision })
                    .then((saved) => {
                      if (saved) setDeleting(null);
                    });
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
