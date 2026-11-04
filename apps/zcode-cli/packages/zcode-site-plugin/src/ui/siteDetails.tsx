import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronLeft, Copy, Globe, LoaderCircle, X } from "lucide-react";
import { formatClock, formatTime } from "./i18n.ts";
import {
  deploymentPhase,
  formatBytes,
  siteHost,
  stageViews,
  type Deployment,
  type LogEntry,
  type Site,
  type StageState,
} from "./model.ts";
import { useView, Loading, Alert, Cell, StatusLabel } from "./parts.tsx";
import type { ViewState } from "./parts.tsx";

export function DeploymentDetail({ state, site }: { state: ViewState; site: Site }) {
  const { t, locale, timeZone, actions } = useView();
  const deployment = state.deployment;
  if (!deployment) return <Loading />;
  const phase = deploymentPhase(deployment);
  const done = deployment.status === "success" || deployment.status === "failed";
  return (
    <div className="stack-4">
      <button
        type="button"
        className="btn ghost sm back"
        onClick={() => actions.navigate({ page: "site", siteId: site.id, tab: "deployments" })}
      >
        <ChevronLeft />
        {t("sites.deployment.back")}
      </button>
      <header className="stack-1">
        <p className="subtle sm">{t("sites.deployment.details")}</p>
        <div className="row gap-2 wrap-row">
          <h2 className="deployment-title">{formatTime(deployment.createdAt, locale, timeZone)}</h2>
          {deployment.isCurrent && <span className="tag">{t("sites.deployment.current")}</span>}
        </div>
      </header>
      <dl className="grid-cells">
        <Cell label={t("sites.deployment.status")}>
          <StatusLabel phase={phase} />
        </Cell>
        <Cell label={t("sites.deployment.size")}>{formatBytes(deployment.artifactSize)}</Cell>
        <Cell label={t("sites.deployment.finishedAt")}>
          {deployment.finishedAt ? formatTime(deployment.finishedAt, locale, timeZone) : "—"}
        </Cell>
      </dl>
      {deployment.failure && (
        <Alert
          title={t("sites.status.failed")}
          lines={[
            t("sites.site.failedAt", {
              stage: t(`sites.stage.${deployment.failure.stage}`),
              message: deployment.failure.message,
            }),
          ]}
        />
      )}
      <section className="card logs-card">
        <header className="logs-head">
          <div className="row between">
            <h3>{t("sites.deployment.logs")}</h3>
            <button
              type="button"
              className="icon-btn sm"
              disabled={state.logs.length === 0}
              aria-label={t("sites.deployment.copyLogs")}
              title={t("sites.deployment.copyLogs")}
              onClick={() =>
                actions.copy(
                  state.logs
                    .map((entry) => `${entry.ts} [${entry.stage}] ${entry.level} ${entry.message}`)
                    .join("\n"),
                  "sites.deployment.logsCopied",
                )
              }
            >
              <Copy />
            </button>
          </div>
          <Steps deployment={deployment} logs={state.logs} />
        </header>
        <LogViewer entries={state.logs} />
        <footer className="logs-foot">
          {!(done && state.logsDone) && <span className="pulse" aria-hidden="true" />}
          <span>
            {t(done && state.logsDone ? "sites.deployment.logsEnd" : "sites.deployment.logsLive")}
          </span>
        </footer>
      </section>
    </div>
  );
}

function Steps({ deployment, logs }: { deployment: Deployment; logs: LogEntry[] }) {
  const { t } = useView();
  return (
    <ol className="steps">
      {stageViews(deployment, logs).map((view) => (
        <li key={view.stage} className={`step ${view.state}`}>
          <span className="step-bar" />
          <span className="step-label">
            <StepIcon state={view.state} />
            <span className="truncate">{t(`sites.stage.${view.stage}`)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function StepIcon({ state }: { state: StageState }) {
  if (state === "done") return <Check className="step-icon" />;
  if (state === "failed") return <X className="step-icon" />;
  if (state === "active") return <LoaderCircle className="step-icon spin" />;
  return <span className="step-dot" />;
}

/** 日志贴底跟随新内容；用户往上翻就停下，点「回到最新」或滚回底部后恢复。 */
function LogViewer({ entries }: { entries: LogEntry[] }) {
  const { t, locale, timeZone } = useView();
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && follow) element.scrollTop = element.scrollHeight;
  }, [entries.length, follow]);
  return (
    <div className="logs-wrap">
      <div
        ref={ref}
        className="logs"
        role="log"
        onScroll={(event) => {
          const element = event.currentTarget;
          setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 24);
        }}
      >
        {entries.length === 0 ? (
          <p className="logs-empty">{t("sites.deployment.noLogs")}</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.offset} className={`log ${entry.level}`}>
              <span className="log-time">{formatClock(entry.ts, locale, timeZone)}</span>
              <span className="log-message">{entry.message}</span>
            </div>
          ))
        )}
      </div>
      {!follow && (
        <button type="button" className="btn outline sm jump" onClick={() => setFollow(true)}>
          {t("sites.deployment.follow")}
        </button>
      )}
    </div>
  );
}

export function RenameDialog({
  site,
  rename,
}: {
  site: Site;
  rename: NonNullable<ViewState["rename"]>;
}) {
  const { t, actions } = useView();
  const [draft, setDraft] = useState(site.name);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && actions.cancelRename();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [actions]);
  return (
    <div
      className="overlay"
      onMouseDown={(event) => event.target === event.currentTarget && actions.cancelRename()}
    >
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-title"
        onSubmit={(event) => {
          event.preventDefault();
          actions.saveRename(draft);
        }}
      >
        <div className="stack-1">
          <h2 id="rename-title">{t("sites.site.rename")}</h2>
          <p className="subtle sm">{t("sites.site.renameHint")}</p>
        </div>
        <div className="stack-2">
          <label htmlFor="rename" className="field-label">
            {t("sites.site.name")}
          </label>
          <input
            id="rename"
            className="input"
            autoFocus
            maxLength={100}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          {rename.error ? (
            <p className="danger sm">{t(rename.error)}</p>
          ) : (
            <p className="row gap-1 subtle sm">
              <Globe className="inline-icon" />
              <span className="truncate">{siteHost(site)}</span>
            </p>
          )}
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn ghost lg" onClick={actions.cancelRename}>
            {t("sites.cancel")}
          </button>
          <button
            type="submit"
            className="btn primary lg"
            disabled={rename.saving || !draft.trim()}
          >
            {rename.saving && <LoaderCircle className="spin" />}
            {t("sites.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
