import { useState, type ComponentProps } from "react";
import { PlusIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { ResizableHandle } from "@/components/ui/resizable.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SidePaneFrame({
  className = "rounded-xl border border-border",
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      {...props}
      data-workspace-side-frame="true"
      className={cn("h-full overflow-hidden bg-background", className)}
    />
  );
}

export function SidePaneResizeHandle({
  className,
  ...props
}: ComponentProps<typeof ResizableHandle>) {
  return (
    <ResizableHandle
      {...props}
      data-workspace-side-pane-resize-handle="true"
      className={cn(
        "aria-[orientation=vertical]:w-1 aria-[orientation=vertical]:translate-x-0 aria-[orientation=vertical]:my-0 aria-[orientation=vertical]:h-full",
        "hover:bg-transparent data-[separator=hover]:bg-transparent data-[separator=active]:bg-transparent focus-visible:bg-transparent",
        "aria-[orientation=vertical]:[mask-image:none] aria-[orientation=vertical]:[-webkit-mask-image:none]",
        "after:pointer-events-none after:absolute after:rounded-full after:bg-foreground-subtlest/50 after:opacity-0 after:transition-opacity after:content-[''] after:inset-y-[var(--workspace-panel-radius,var(--radius-xl))] after:w-0.5",
        "hover:after:opacity-100 data-[separator=hover]:after:opacity-100 data-[separator=active]:after:opacity-100 focus-visible:after:opacity-100",
        className,
      )}
    />
  );
}

export function SidePaneAddTabMenu({
  items,
}: {
  items: { id: string; label: string; icon: LucideIcon; onOpen(): void }[];
}) {
  const { intl } = useZCodeIntl();
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-md"
          className="shrink-0"
          data-side-pane-add-trigger
          data-side-pane-add-tab-trigger=""
          aria-label={intl.formatMessage({ id: "sidePane.addTab" })}
        >
          <PlusIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {items.map(({ id, label, icon: Icon, onOpen }) => (
          <DropdownMenuItem key={id} data-side-pane-add-item={id} onSelect={onOpen}>
            <Icon className="size-4" />
            <span>{label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
