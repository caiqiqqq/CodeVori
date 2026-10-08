import type { ReactNode } from "react";
import { LockKeyhole, UnlockKeyhole } from "lucide-react";
import type { ForgeItemDetail } from "@zcode/shared";
import type { useRepositoryItem } from "@/hooks/useRepositoryItem.js";
import {
  RepositoryAuthor,
  RepositoryError,
  RepositoryExternalButton,
  RepositoryLabels,
  RepositoryLoading,
  RepositoryTime,
  useRepositoryMessages,
} from "./RepositoryParts.js";

function Attribute({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="min-w-0 border-b border-border py-4 first:pt-0 last:border-0"
    >
      <h3 className="mb-2 text-ui-sm font-medium">{title}</h3>
      <div className="min-w-0 text-ui-sm text-foreground-subtle [overflow-wrap:anywhere]">
        {children}
      </div>
    </section>
  );
}

export function RepositoryItemAttributes({
  item,
  detail,
  withExtras,
  onOpen,
}: {
  item: ForgeItemDetail;
  detail: ReturnType<typeof useRepositoryItem>;
  withExtras: boolean;
  onOpen: (url: string) => void;
}) {
  const t = useRepositoryMessages();
  const metadata = item.metadata;
  const duration = (seconds: number, allowZero = false) => {
    if (!seconds) return allowZero ? t("minutes", { count: 0 }) : t("notSet");
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return [
      hours ? t("hours", { count: hours }) : "",
      minutes ? t("minutes", { count: minutes }) : "",
      !hours && !minutes ? t("seconds", { count: Math.round(seconds) }) : "",
    ]
      .filter(Boolean)
      .join(" ");
  };
  return (
    <aside
      data-testid="repository-attributes"
      aria-label={t("attributes")}
      className="min-w-0 border-t border-border pt-5 @3xl:border-l @3xl:border-t-0 @3xl:pl-6 @3xl:pt-0"
    >
      {metadata ? (
        <Attribute title={t("assignees")}>
          {metadata.assignees.length ? (
            <div className="flex flex-col gap-2">
              {metadata.assignees.map((author) => (
                <RepositoryAuthor key={author.username} author={author} />
              ))}
            </div>
          ) : (
            t("unassigned")
          )}
        </Attribute>
      ) : null}
      <Attribute title={t("labels")}>
        {item.labels.length ? <RepositoryLabels labels={item.labels} /> : t("noLabels")}
        {metadata?.errors?.labels ? (
          <RepositoryError error={metadata.errors.labels} retry={detail.refresh} />
        ) : null}
      </Attribute>
      {metadata ? (
        <>
          <Attribute title={t("milestone")}>
            {metadata.milestone ? (
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 break-words">{metadata.milestone.title}</span>
                <RepositoryExternalButton
                  url={metadata.milestone.url}
                  label={t("openMilestone")}
                  onOpen={onOpen}
                />
              </div>
            ) : (
              t("notSet")
            )}
          </Attribute>
          {metadata.dueDate !== undefined ? (
            <Attribute title={t("dueDate")}>
              {metadata.dueDate ? (
                <RepositoryTime value={metadata.dueDate} dateOnly />
              ) : (
                t("notSet")
              )}
            </Attribute>
          ) : null}
          {metadata.timeStats !== undefined ? (
            <Attribute title={t("timeTracking")}>
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2">
                <dt>{t("timeEstimate")}</dt>
                <dd>{duration(metadata.timeStats?.estimateSeconds ?? 0)}</dd>
                <dt>{t("timeSpent")}</dt>
                <dd>
                  {metadata.timeStats
                    ? duration(metadata.timeStats.spentSeconds, true)
                    : t("notSet")}
                </dd>
              </dl>
            </Attribute>
          ) : null}
          {metadata.confidential !== undefined && metadata.confidential !== null ? (
            <Attribute title={t("visibility")}>
              <span className="inline-flex items-center gap-2">
                {metadata.confidential ? (
                  <LockKeyhole className="size-3.5" />
                ) : (
                  <UnlockKeyhole className="size-3.5" />
                )}
                {t(metadata.confidential ? "confidential" : "notConfidential")}
              </span>
            </Attribute>
          ) : null}
          {metadata.participants !== undefined || withExtras ? (
            <Attribute title={t("participants")} testId="repository-participants">
              {metadata.errors?.participants ? (
                <RepositoryError error={metadata.errors.participants} retry={detail.refresh} />
              ) : detail.extrasError ? (
                <RepositoryError error={detail.extrasError} retry={detail.refresh} />
              ) : detail.extrasLoading ? (
                <RepositoryLoading />
              ) : metadata.participants?.length ? (
                <div className="flex flex-col gap-2">
                  {metadata.participants.map((author) => (
                    <RepositoryAuthor key={author.username} author={author} />
                  ))}
                </div>
              ) : (
                t("noParticipants")
              )}
              {metadata.participantsHasMore ? <p className="mt-2">{t("moreOnWeb")}</p> : null}
            </Attribute>
          ) : null}
        </>
      ) : null}
      <Attribute title={t("createdAt")}>
        {item.createdAt ? <RepositoryTime value={item.createdAt} /> : t("notSet")}
      </Attribute>
      <Attribute title={t("updatedAt")}>
        {item.updatedAt ? <RepositoryTime value={item.updatedAt} /> : t("notSet")}
      </Attribute>
    </aside>
  );
}
