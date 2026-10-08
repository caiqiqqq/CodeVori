import type { ForgeComment } from "@zcode/shared";
import { RepositoryLabels, useRepositoryMessages } from "./RepositoryParts.js";

export function RepositoryLabelActivity({
  activity,
}: {
  activity: NonNullable<ForgeComment["labelActivity"]>;
}) {
  const t = useRepositoryMessages();
  // 资源事件中的标签名是字面文本，不能复用 Markdown 解析而触发链接或 HTML。
  const labels = activity.labels.map(
    (label, index) =>
      label ?? {
        key: `deleted:${index}`,
        name: t("deletedLabel"),
        color: null,
      },
  );
  return (
    <div
      data-testid="repository-label-activity"
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-sm text-foreground-subtle"
    >
      <span>{t(activity.action === "add" ? "labelsAdded" : "labelsRemoved")}</span>
      <RepositoryLabels labels={labels} />
    </div>
  );
}
