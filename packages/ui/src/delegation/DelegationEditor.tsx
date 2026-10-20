import { useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import {
  acpAgentDefinition,
  getDelegationAgentReference,
  uuidv7,
  type DelegationCreate,
  type DelegationParent,
  type DelegationFollowUp,
  type WorkTaskExecution,
} from "@zcode/shared";
import { useDelegationTargets } from "@/hooks/useAgentDelegation.js";
import { useWorkTaskPromptAssets } from "@/hooks/useWorkTaskPromptAssets.js";
import { useWorkTaskEditorSave } from "@/hooks/useWorkTaskEditorSave.js";
import type { LexicalChatInputHandle } from "@/LexicalChatInput.js";
import { WorkTaskPromptField } from "@/work-tasks/WorkTaskPromptField.js";
import { Input } from "@/components/ui/input.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function DelegationEditor({
  parent,
  previousId,
  busy: externalBusy,
  onClose,
  onCreate,
  onFollowUp,
}: {
  parent: DelegationParent;
  previousId?: string;
  busy: boolean;
  onClose(): void;
  onCreate(input: Omit<DelegationCreate, keyof DelegationParent>): Promise<boolean>;
  onFollowUp(input: Omit<DelegationFollowUp, keyof DelegationParent>): Promise<boolean>;
}) {
  const scope = useMemo(() => ({ workspacePath: parent.workspacePath }), [parent.workspacePath]);
  const targets = useDelegationTargets(parent.workspacePath, parent.workspaceIdentity, !previousId);
  const [agent, setAgent] = useState<string | null>(null);
  const selected =
    agent === null
      ? targets[0]
      : targets.find((target) => getDelegationAgentReference(target) === agent);
  const [intent, setIntent] = useState<"edit" | "analysis">("edit");
  const [background, setBackground] = useState("");
  const [constraints, setConstraints] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [task, setTask] = useState("");
  const [requestId] = useState(uuidv7);
  const submission = useWorkTaskEditorSave(externalBusy);
  const assets = useWorkTaskPromptAssets(scope, null, submission.busy);
  const inputApiRef = useRef<LexicalChatInputHandle | null>(null);
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `delegation.${key}` });
  const submit = () =>
    submission.submit(async (signal) => {
      if (!inputApiRef.current || (!previousId && !selected)) return;
      const execution: WorkTaskExecution =
        selected?.kind === "api"
          ? selected.execution
          : {
              kind: "acp",
              agent: selected?.kind === "acp" ? selected.agent : "codex",
              config: [],
            };
      const draft = await assets.prepareDraft(
        task.trim().slice(0, 80),
        execution,
        inputApiRef.current,
        signal,
      );
      const ok = previousId
        ? await onFollowUp({
            id: previousId,
            requestId,
            task: draft.prompt,
            attachments: draft.attachments,
            workspaceFiles: draft.workspaceFiles,
          })
        : await onCreate({
            requestId,
            title: draft.title,
            task: draft.prompt,
            execution,
            intent,
            background,
            constraints,
            expectedResult,
            dependsOn: [],
            attachments: draft.attachments,
            workspaceFiles: draft.workspaceFiles,
          });
      if (ok) onClose();
    });
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      data-testid="delegation-editor"
    >
      {!previousId ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={t("agent")}
              value={selected ? getDelegationAgentReference(selected) : ""}
              onChange={(e) => setAgent(e.target.value)}
              className="h-8 min-w-0 max-w-full rounded-lg border border-input-border bg-input px-2 text-ui-sm"
            >
              <option value="" disabled>
                {t("agent")}
              </option>
              {targets.map((item) => (
                <option
                  key={getDelegationAgentReference(item)}
                  value={getDelegationAgentReference(item)}
                >
                  {item.kind === "acp"
                    ? acpAgentDefinition(item.agent).name
                    : `${item.execution.modelSelection.modelId} (${item.providerName}) · API`}
                </option>
              ))}
            </select>
            <select
              aria-label={t("intent")}
              value={intent}
              onChange={(e) => setIntent(e.target.value as "edit" | "analysis")}
              className="h-8 min-w-0 rounded-lg border border-input-border bg-input px-2 text-ui-sm"
            >
              <option value="edit">{t("edit")}</option>
              <option value="analysis">{t("analysis")}</option>
            </select>
          </div>
          <Input
            aria-label={t("background")}
            placeholder={t("background")}
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            disabled={submission.busy}
          />
          <Input
            aria-label={t("constraints")}
            placeholder={t("constraints")}
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
            disabled={submission.busy}
          />
          <Input
            aria-label={t("expectedResult")}
            placeholder={t("expectedResult")}
            value={expectedResult}
            onChange={(e) => setExpectedResult(e.target.value)}
            disabled={submission.busy}
          />
        </>
      ) : null}
      <WorkTaskPromptField
        scope={scope}
        task={null}
        busy={submission.busy}
        assets={assets}
        inputApiRef={inputApiRef}
        onChange={setTask}
      />
      {submission.error ? (
        <p className="break-words text-destructive" role="alert">
          {submission.error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={submission.busy}
        >
          {t("close")}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={submission.busy || !task.trim() || (!previousId && !selected)}
        >
          <Send className="size-3.5" />
          {t("send")}
        </Button>
      </div>
    </form>
  );
}
