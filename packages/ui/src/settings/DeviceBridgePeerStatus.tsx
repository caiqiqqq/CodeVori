import type { DeviceBridgePeer } from "@zcode/shared";
import { Badge } from "@/components/ui/badge.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const neutral = "border-border bg-surface text-foreground-subtle";
const success = "border-success/20 bg-success/10 text-success";
const warning = "border-warning/20 bg-warning/10 text-foreground";

export function DeviceBridgePeerStatus({
  peer,
  networkReady,
}: {
  peer: DeviceBridgePeer;
  networkReady: boolean;
}) {
  const { intl } = useZCodeIntl();
  const t = (name: string) => intl.formatMessage({ id: `settings.devices.${name}` });
  const online = networkReady && peer.online;
  // 网络失效或断开时，旧检查结果不能继续显示为可用；有连接也不代表已完成检查。
  const toolStatus = !online
    ? "toolsUnavailable"
    : !peer.connected
      ? "notConnected"
      : !peer.checkedAt || peer.toolCount === undefined
        ? "toolsUnchecked"
        : peer.toolCount > 0
          ? "toolsReady"
          : "toolsEmpty";
  const waiting = toolStatus === "toolsUnchecked" || toolStatus === "toolsEmpty";
  return (
    <div
      className="flex max-w-full flex-wrap items-center gap-2"
      role="group"
      aria-label={t("peerStatus")}
      data-testid={`device-bridge-peer-status-${peer.nodeId}`}
    >
      <Badge
        variant="outline"
        className={`h-auto min-h-5 text-ui-sm ${online ? success : neutral}`}
        data-testid="device-bridge-peer-network-status"
      >
        <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
        {t(!networkReady ? "networkDisconnected" : peer.online ? "online" : "offline")}
      </Badge>
      <Badge
        variant="outline"
        className={`h-auto min-h-5 text-ui-sm ${toolStatus === "toolsReady" ? success : waiting ? warning : neutral}`}
        data-testid="device-bridge-peer-tool-status"
      >
        <span
          className={`size-1.5 shrink-0 rounded-full ${waiting ? "bg-warning" : "bg-current"}`}
          aria-hidden="true"
        />
        {t(toolStatus)}
      </Badge>
    </div>
  );
}
