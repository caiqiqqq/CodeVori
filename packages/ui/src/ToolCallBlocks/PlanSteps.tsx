import { ArrowRightIcon, CircleCheckIcon, CircleIcon } from "lucide-react";
import type { ZCodePlanStep } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";

const textClasses: Record<ZCodePlanStep["status"], string> = {
  pending: "text-foreground-subtle",
  in_progress: "text-foreground",
  completed: "text-foreground-subtlest line-through",
};

function StatusIcon({ status }: { status: ZCodePlanStep["status"] }) {
  if (status === "completed") return <CircleCheckIcon className="size-3.5 shrink-0 text-success" />;
  if (status === "in_progress")
    return <ArrowRightIcon className="size-3.5 shrink-0 text-foreground" />;
  return <CircleIcon className="size-3.5 shrink-0 text-foreground-subtlest" />;
}

/** Shared step visuals for API Todo tools and reported ACP plans. */
export function PlanSteps({
  steps,
}: {
  steps: readonly Pick<ZCodePlanStep, "id" | "title" | "status">[];
}) {
  return steps.map((step) => (
    <div
      key={step.id}
      className="flex min-w-0 items-center gap-2 py-1"
      data-plan-step-status={step.status}
    >
      <StatusIcon status={step.status} />
      <span className={cn("min-w-0 break-words text-ui-base", textClasses[step.status])}>
        {step.title}
      </span>
    </div>
  ));
}
