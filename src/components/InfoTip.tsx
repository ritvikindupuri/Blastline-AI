import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Tiny hoverable info icon with a tooltip. Use anywhere a number, label, or
 * control could use a one-line explanation.
 *
 * <Label>Risk score <InfoTip>Composite 0–100 score: critical x25 + high x10 + medium x3 / services audited.</InfoTip></Label>
 */
export function InfoTip({
  children,
  side = "top",
  className,
  iconClassName,
}: {
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  iconClassName?: string;
}) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="More info"
          className={cn(
            "inline-flex items-center justify-center align-middle text-muted-foreground hover:text-primary transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-sm",
            className,
          )}
        >
          <Info className={cn("h-3.5 w-3.5", iconClassName)} />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs text-xs leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}