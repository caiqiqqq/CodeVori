import { useState } from "react";
import { Pencil, Plus, Trash2, Bot } from "lucide-react";
import type { AgentProfileSave, AgentProfile } from "@zcode/shared";
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
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { AgentProfileEditor } from "./AgentProfileEditor.js";
import { squadRoleDraft, squadTargetLabel } from "./agentSquadDraft.js";

type Props = {
  workspacePath: string | null;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: unknown;
};
export function AgentProfilesSection(props: Props) {
  const resolution = useWorkspaceServicesResolution(
    props.workspacePath,
    props.remoteSessionId,
    props.workspaceIdentity,
    props.remoteTarget,
  );
  return (
    <ProfilesContent
      key={JSON.stringify([
        props.workspaceIdentity?.trim() || props.workspacePath,
        props.workspacePath,
        resolution.remoteSessionId,
        resolution.rpcReady,
        resolution.isRemoteTarget,
        Boolean(props.remoteTarget),
      ])}
      {...props}
    />
  );
}
function ProfilesContent({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  remoteTarget,
}: Props) {
  const catalog = useAgentSquads(
    workspacePath,
    workspaceIdentity,
    true,
    true,
    remoteSessionId,
    remoteTarget,
  );
  const [draft, setDraft] = useState<AgentProfileSave | null>(null);
  const [deleting, setDeleting] = useState<AgentProfile | null>(null);
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `agentProfiles.${key}` });
  const blocked = catalog.loading || catalog.busy || !catalog.profilesAvailable;
  return (
    <section data-testid="agent-profiles-settings" className="mt-3 min-w-0 space-y-4">
      <p className="text-ui-caption text-foreground-subtle">{t("intro")}</p>
      {catalog.error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-ui-base text-destructive"
        >
          {catalog.error}
          <Button variant="outline" onClick={() => void catalog.refresh()}>
            {intl.formatMessage({ id: "squads.retry" })}
          </Button>
        </div>
      ) : null}
      {!catalog.profilesAvailable ? (
        <p className="text-ui-caption text-foreground-subtle">{t("unavailable")}</p>
      ) : null}
      {draft ? (
        <AgentProfileEditor
          draft={draft}
          targets={catalog.targets}
          busy={blocked}
          workspacePath={workspacePath}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => {
            void catalog.saveProfile(draft).then((saved) => {
              if (saved) setDraft(null);
            });
          }}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-ui-caption text-foreground-subtle">{t("usage")}</span>
            <Button
              disabled={blocked || !catalog.targets.length}
              onClick={() => {
                const target = catalog.targets[0];
                if (!target) return;
                const role = squadRoleDraft(target, "", "");
                setDraft({
                  id: role.id,
                  expectedRevision: 0,
                  name: "",
                  description: "",
                  instructions: "",
                  execution: role.execution,
                });
              }}
            >
              <Plus className="size-4" />
              {t("create")}
            </Button>
          </div>
          {!catalog.loading && catalog.profilesAvailable && !catalog.targets.length ? (
            <p className="text-ui-caption text-foreground-subtle">{t("noTargets")}</p>
          ) : null}
          <div className="divide-y divide-border rounded-xl border border-card-border bg-card">
            {catalog.profiles.map((profile) => {
              const target = catalog.targets.find((target) =>
                target.kind === "acp"
                  ? profile.execution.kind === "acp" && target.agent === profile.execution.agent
                  : profile.execution.kind === "api" &&
                    target.execution.modelSelection.providerId ===
                      profile.execution.modelSelection.providerId &&
                    target.execution.modelSelection.modelId ===
                      profile.execution.modelSelection.modelId,
              );
              return (
                <div
                  key={profile.id}
                  data-testid="agent-profile-row"
                  className="flex min-w-0 items-start justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 break-words text-ui-base font-medium">
                      <Bot className="size-4 shrink-0" />
                      {profile.name}
                    </p>
                    <p className="mt-1 break-words text-ui-caption text-foreground-subtle">
                      {profile.description || profile.instructions}
                    </p>
                    <p className="mt-1 break-words text-ui-caption text-foreground-subtle">
                      {target
                        ? squadTargetLabel(target)
                        : intl.formatMessage({ id: "squads.targetUnavailable" })}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("edit")}
                      disabled={blocked}
                      onClick={() => {
                        const { revision, createdAt: _c, updatedAt: _u, ...fields } = profile;
                        setDraft({ ...structuredClone(fields), expectedRevision: revision });
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("delete")}
                      disabled={blocked}
                      onClick={() => setDeleting(profile)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {!catalog.profiles.length ? (
            <p className="py-10 text-center text-ui-caption text-foreground-subtle">
              {catalog.loading ? t("loading") : t("empty")}
            </p>
          ) : null}
        </>
      )}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteHint")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{intl.formatMessage({ id: "common.cancel" })}</AlertDialogCancel>
            <AlertDialogAction
              disabled={blocked}
              onClick={() => {
                if (deleting)
                  void catalog
                    .removeProfile({ id: deleting.id, expectedRevision: deleting.revision })
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
