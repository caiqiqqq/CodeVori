import type { BotConfig } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useBotNotificationTest } from "@/hooks/useBotNotificationTest.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";

export function TaskNotificationsCard({
  bot,
  weixinRecipientReady,
  onPatchBot,
}: {
  bot: BotConfig;
  weixinRecipientReady: boolean;
  onPatchBot: (patch: Partial<BotConfig>) => void;
}) {
  const { intl } = useZCodeIntl();
  const { testing, ok, sendTest } = useBotNotificationTest(bot.id);
  const supported = ["weixin", "feishu", "lark", "telegram", "webhook"].includes(bot.provider);
  const ready =
    supported &&
    bot.enabled &&
    (bot.provider === "weixin"
      ? weixinRecipientReady
      : bot.provider === "webhook"
        ? Boolean(bot.webhookUrl)
        : Boolean(bot.providerUserId));
  const label = intl.formatMessage({ id: "bots.taskNotifications" });
  return (
    <SettingsRow
      label={label}
      description={intl.formatMessage({
        id: ready ? "bots.taskNotifications.description" : "bots.taskNotifications.bindRequired",
      })}
      control={
        <Switch
          aria-label={label}
          checked={bot.taskNotifications ?? false}
          disabled={!ready}
          onCheckedChange={(taskNotifications) => onPatchBot({ taskNotifications })}
        />
      }
      detail={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!ready || testing}
            onClick={() => void sendTest()}
          >
            {intl.formatMessage({
              id: testing ? "bots.taskNotifications.testing" : "bots.taskNotifications.test",
            })}
          </Button>
          <span role="status" className="text-ui-caption text-foreground-subtle">
            {ok === undefined
              ? null
              : intl.formatMessage({
                  id: ok
                    ? "bots.taskNotifications.testSuccess"
                    : "bots.taskNotifications.testFailure",
                })}
          </span>
        </div>
      }
    />
  );
}
