import type { CSSProperties } from "react";
import type { AppUsageHeatmapCell } from "@zcode/shared";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { cn } from "@/components/lib/utils.js";

const HEATMAP_LEVEL_STYLES = [
  "var(--color-usage-heatmap-0)",
  "var(--color-usage-heatmap-1)",
  "var(--color-usage-heatmap-2)",
  "var(--color-usage-heatmap-3)",
  "var(--color-usage-heatmap-4)",
];

export type TokenActivityMode = "daily" | "weekly" | "cumulative";

export interface HeatmapDisplayCell {
  key: string;
  tooltipTitle?: string;
  level: AppUsageHeatmapCell["level"];
  hasUsage: boolean;
  columnHover: boolean;
}

export interface HeatmapDisplayColumn {
  key: string;
  monthDate: string;
  tooltipTitle: string | null;
  cells: HeatmapDisplayCell[];
}

function getHeatmapCellStyle(level: number): CSSProperties {
  return {
    backgroundColor: HEATMAP_LEVEL_STYLES[level] ?? HEATMAP_LEVEL_STYLES[0],
  };
}

export function HeatmapColumn({
  column,
  mode,
}: {
  column: HeatmapDisplayColumn;
  mode: TokenActivityMode;
}) {
  const node = (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1",
        mode !== "daily" && "group/usage-heatmap-column",
      )}
    >
      {column.cells.map((cell) => (
        <HeatmapCell key={cell.key} cell={cell} />
      ))}
    </div>
  );

  if (!column.tooltipTitle) {
    return node;
  }

  // 密集周列会落入 Radix 的浮层 hover 通道，导致提示仍保留上一列。
  // 活动提示只有文本，关闭该通道并让浮层穿透鼠标，确保命中当前列。
  return (
    <ControlHintTooltip
      title={column.tooltipTitle}
      disableHoverableContent
      className="usage-heatmap-tooltip pointer-events-none"
    >
      {node}
    </ControlHintTooltip>
  );
}

function HeatmapCell({ cell }: { cell: HeatmapDisplayCell }) {
  const node = (
    <div
      data-usage-heatmap-cell={cell.key}
      className={cn(
        "aspect-square w-full min-w-0 rounded-sm border transition-transform hover:scale-110 hover:border-border-hover",
        cell.hasUsage ? "border-border" : "border-transparent",
        cell.columnHover && "group-hover/usage-heatmap-column:border-border-hover",
      )}
      style={getHeatmapCellStyle(cell.level)}
    />
  );

  if (cell.tooltipTitle) {
    // 每日格子同样不能被上一格的浮层或 hover 通道遮挡（issue #125）。
    return (
      <ControlHintTooltip
        title={cell.tooltipTitle}
        disableHoverableContent
        className="usage-heatmap-tooltip pointer-events-none"
      >
        {node}
      </ControlHintTooltip>
    );
  }

  return node;
}
