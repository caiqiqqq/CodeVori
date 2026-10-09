import type { QuickMessage } from "@zcode/shared";
import { MessageSquareText } from "lucide-react";
import type { IntlInstance } from "@/i18n/IntlProvider.js";
import type { MentionPanelSection } from "@/mentions/components/MentionPanel.js";

export function quickMessageMenuSection(
  quickMessages: QuickMessage[],
  intl: IntlInstance,
): MentionPanelSection {
  return {
    id: "quickMessages",
    title: intl.formatMessage({ id: "settings.quickMessages.title" }),
    emptyText: intl.formatMessage({ id: "settings.quickMessages.menuEmpty" }),
    options: quickMessages.map((message) => ({
      id: `quick-message:${message.id}`,
      label: message.title,
      description: message.content,
      content: (
        <>
          <MessageSquareText className="size-4 shrink-0" />
          <span className="truncate text-ui-base font-medium">{message.title}</span>
        </>
      ),
    })),
  };
}
